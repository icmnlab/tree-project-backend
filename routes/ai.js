const express = require('express');
const router = express.Router();
const db = require('../config/db');
const rateLimit = require('express-rate-limit');
const { generateGeminiChatResponse } = require('../services/geminiService');
const reportController = require('../controllers/reportController');
const aiReportController = require('../controllers/aiReportController');
const format = require('pg-format');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireRole } = require('../middleware/roleAuth');
const { chatCompletions } = require('../services/llmProviderService');
const { getLlmHealth } = require('../services/llmProviderHealth');

// [NEW] 引入 SQL Query Service
const sqlQueryService = require('../services/sqlQueryService');

// 根據您的 index_1.js，初始化 OpenAI, Anthropic, SiliconFlow
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let anthropic;
if (process.env.Claude_API_KEY) {
    anthropic = new Anthropic({ apiKey: process.env.Claude_API_KEY });
}

let siliconFlowLlm;
if (process.env.SiliconFlow_API_KEY) {
    siliconFlowLlm = new OpenAI({
        apiKey: process.env.SiliconFlow_API_KEY,
        baseURL: 'https://api.siliconflow.cn/v1',
    });
}


// Helper function: 根據模型名稱決定使用 max_tokens 或 max_completion_tokens
// OpenAI o-系列推理模型 (o1, o3, o4) 需要使用 max_completion_tokens
function getTokenLimitParams(modelName, tokenLimit) {
    // o1, o3, o4 系列推理模型需要使用 max_completion_tokens
    if (modelName && (modelName.startsWith('o1') || modelName.startsWith('o3') || modelName.startsWith('o4'))) {
        return { max_completion_tokens: tokenLimit };
    }
    // 其他模型使用傳統的 max_tokens
    return { max_tokens: tokenLimit };
}

// AI 路由速率限制
const aiLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30分鐘
    max: 50, // 增加限制次數
    message: {
        success: false,
        message: 'AI請求過於頻繁，請稍後再試'
    }
});


// ============================================
// [NEW] Chat V2 - Text-to-SQL + 直接 LLM 混合架構
// ============================================
// 
// 這是新版的聊天 API，採用以下策略：
// 1. 意圖分類：判斷使用者是「查資料」還是「問知識」
// 2. 查資料：使用 Text-to-SQL，直接從資料庫取得精確結果
// 3. 問知識：直接讓 LLM 回答（不經過 RAG）
//
// 優點：
// - 省去 RAG 的 Embedding API 費用
// - 查詢速度更快
// - 資料查詢結果更精確
//
// 此路由現在是主要的 /chat 端點
// ============================================

// 訊息長度限制（避免 LLM token 超限和記憶體問題）
const MAX_MESSAGE_LENGTH = 500;

// Excel 匯出設定
const EXCEL_EXPORT_THRESHOLD = 5;  // 超過 5 筆自動生成 Excel
const EXPORT_DIR = path.join(__dirname, '..', 'exports');
const EXPORT_URL_PREFIX = '/api/download/';  // 下載路由前綴（對應 router.get('/download/:filename')）

// 取得完整的下載 URL（包含 domain）
function getFullDownloadUrl(fileName) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    return `${baseUrl}${EXPORT_URL_PREFIX}${fileName}`;
}

// 確保匯出目錄存在
if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

// 定期清理舊的匯出檔案 (1小時以上)
setInterval(() => {
    try {
        const files = fs.readdirSync(EXPORT_DIR);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(EXPORT_DIR, file);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > 60 * 60 * 1000) { // 1 小時
                fs.unlinkSync(filePath);
                console.log(`[Export Cleanup] 已刪除過期檔案: ${file}`);
            }
        });
    } catch (err) {
        console.error('[Export Cleanup] 清理失敗:', err.message);
    }
}, 30 * 60 * 1000); // 每 30 分鐘檢查一次

// ============================================
// [NEW] Chat Sessions API — server-side per-user history
// ============================================
// 將原本前端 SharedPreferences 的對話列表搬到後端，
// 透過 JWT 取得 user_id 來保證跨裝置/同裝置不同帳號互相隔離。

// GET /chat/sessions — 列出當前使用者所有對話 session（最新 50 筆）
/** GET /api/ai/llm-options — 依實際 API 可用性回傳前端模型清單 */
router.get('/llm-options', requireRole('調查管理員'), async (req, res) => {
    try {
        const health = await getLlmHealth(req.query.refresh === '1');
        res.json({
            success: true,
            ...health,
            demoHints: [
                '匯出高雄港樹木 Excel',
                '比較環境部與林業署碳匯政策',
                '列出可查的政策網站',
                'IPCC 森林碳匯方法學摘要',
            ],
        });
    } catch (e) {
        console.error('[LLM Options]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/chat/sessions', requireRole('調查管理員'), async (req, res) => {
    try {
        const userId = String(req.user.user_id);
        const result = await db.query(
            `SELECT
                session_id,
                MIN(created_at) AS created_at,
                MAX(created_at) AS updated_at,
                COUNT(*)::int AS exchange_count,
                (
                    SELECT message FROM chat_logs
                    WHERE user_id = $1 AND session_id = cl.session_id
                    ORDER BY created_at ASC LIMIT 1
                ) AS first_message
             FROM chat_logs cl
             WHERE user_id = $1 AND session_id IS NOT NULL AND session_id <> ''
             GROUP BY session_id
             ORDER BY MAX(created_at) DESC
             LIMIT 50`,
            [userId]
        );
        res.json({ success: true, sessions: result.rows });
    } catch (err) {
        console.error('[Chat Sessions] 列表查詢失敗:', err.message);
        res.status(500).json({ success: false, error: '對話列表取得失敗' });
    }
});

// GET /chat/sessions/:sessionId — 取得單一 session 的完整對話內容
router.get('/chat/sessions/:sessionId', requireRole('調查管理員'), async (req, res) => {
    try {
        const userId = String(req.user.user_id);
        const { sessionId } = req.params;
        const result = await db.query(
            `SELECT id, message, response, model_used, created_at
             FROM chat_logs
             WHERE user_id = $1 AND session_id = $2
             ORDER BY created_at ASC`,
            [userId, sessionId]
        );
        res.json({ success: true, session_id: sessionId, exchanges: result.rows });
    } catch (err) {
        console.error('[Chat Sessions] 對話內容取得失敗:', err.message);
        res.status(500).json({ success: false, error: '對話內容取得失敗' });
    }
});

// DELETE /chat/sessions/:sessionId — 刪除單一 session（僅刪除自己的）
router.delete('/chat/sessions/:sessionId', requireRole('調查管理員'), async (req, res) => {
    try {
        const userId = String(req.user.user_id);
        const { sessionId } = req.params;
        const result = await db.query(
            `DELETE FROM chat_logs WHERE user_id = $1 AND session_id = $2`,
            [userId, sessionId]
        );
        res.json({ success: true, deleted: result.rowCount });
    } catch (err) {
        console.error('[Chat Sessions] 刪除失敗:', err.message);
        res.status(500).json({ success: false, error: '對話刪除失敗' });
    }
});

router.post('/chat', requireRole('調查管理員'), aiLimiter, async (req, res) => {
    try {
        let { message, userId, projectAreas, model_preference = 'gpt-4.1-nano', sessionId } = req.body;

        // [Security] 強制使用 JWT 帶來的 user_id，避免前端偽造或裝置共用 ID 造成跨帳號讀取對話。
        // 保留 req.body.userId 僅作為相容性輸入，會被覆寫。
        if (req.user && req.user.user_id != null) {
            userId = String(req.user.user_id);
        }

        if (!message || typeof message !== 'string' || message.trim() === '') {
            return res.status(400).json({ success: false, error: '請提供有效的訊息內容' });
        }

        // 自動生成 sessionId（如果前端沒有提供）
        if (!sessionId && userId) {
            sessionId = `${userId}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}`;
        }

        // 訊息長度限制
        if (message.length > MAX_MESSAGE_LENGTH) {
            console.log(`[Chat V2] 訊息過長 (${message.length} 字)，已截斷`);
            message = message.substring(0, MAX_MESSAGE_LENGTH) + '...(訊息已截斷)';
        }

        console.log(`[Chat V2] 收到查詢: "${message.substring(0, 50)}..." (session: ${sessionId || 'N/A'})`);
        
        // 處理 projectAreas
        const validProjectAreas = Array.isArray(projectAreas) && projectAreas.length > 0 
            ? projectAreas.filter(a => a && typeof a === 'string' && a.trim() !== '')
            : [];
        if (validProjectAreas.length > 0) {
            console.log(`[Chat V2] 區域過濾: ${validProjectAreas.join(', ')}`);
        }
        // --- PRODUCTION MODEL ENFORCEMENT ---
        // 允許的模型清單 (2025.12 更新):
        // - SiliconFlow 免費額度: DeepSeek-V3, Qwen3 系列, QwQ 推理模型
        // - 付費 API: OpenAI GPT-5 系列, Google Gemini 2.5
        if (process.env.NODE_ENV === 'production') {
            const allowedProdModels = [
                // SiliconFlow 免費額度 (推薦優先使用)
                'deepseek-ai/DeepSeek-V3',
                'deepseek-ai/DeepSeek-R1-0528',
                'Qwen/Qwen3-235B-A22B-Instruct',
                'Qwen/Qwen3-32B-Instruct',
                'Qwen/QwQ-32B',
                // OpenAI GPT-5 系列 (2025 最新)
                'gpt-5-nano', 'gpt-5-mini', 'gpt-5.1',
                // Google Gemini 2.5 系列
                'gemini-2.5-flash', 'gemini-2.5-pro',
            ];
            if (!allowedProdModels.includes(model_preference)) {
                model_preference = 'deepseek-ai/DeepSeek-V3'; // 預設用 DeepSeek
            }
        }

        let aiResponse = '';
        let queryMode = 'knowledge'; // 'data' or 'knowledge'
        let executedSQL = null;
        let queryResults = null;

        // Step 0: 獲取歷史對話上下文（優化版：使用 sqlQueryService 的配置）
        let chatHistory = [];
        if (userId) {
            try {
                const historyQuery = sqlQueryService.getHistoryQuerySQL(userId, sessionId);
                const { rows } = await db.query(historyQuery.text, historyQuery.values);
                // 反轉回正序 (舊 -> 新)
                chatHistory = rows.reverse();
                if (chatHistory.length > 0) {
                    console.log(`[Chat V2] 載入 ${chatHistory.length} 筆歷史對話 (session: ${sessionId || 'all'})`);
                }
            } catch (err) {
                console.warn('[Chat V2] 獲取歷史對話失敗:', err.message);
            }
        }

        // Step 1: 意圖分類 - 判斷是否需要查詢資料庫
        const shouldQuery = sqlQueryService.shouldQueryDatabase(message);
        console.log(`[Chat V2] 意圖分類結果: ${shouldQuery ? '查資料' : '問知識'}`);

        if (shouldQuery) {
            queryMode = 'data';
            
            // Step 2a: 讓 LLM 生成 SQL
            console.log('[Chat V2] 正在生成 SQL...');
            
            // 構建 SQL prompt，包含 projectAreas 過濾資訊
            let sqlPrompt = sqlQueryService.buildSQLGenerationPrompt(message, chatHistory);
            
            // 如果有 projectAreas，加入過濾提示
            if (validProjectAreas.length > 0) {
                // 使用 pg-format 安全處理區域名稱，避免 SQL injection
                const areasCondition = validProjectAreas.map(a => format('%L', a)).join(', ');
                sqlPrompt += `\n\n【重要】使用者已選擇特定區域，SQL 必須加上區域過濾條件：
WHERE project_location IN (${areasCondition})
如果查詢已有 WHERE，請用 AND 連接此條件。`;
            }
            
            let generatedSQL = '';
            try {
                const sqlCompletion = await openai.chat.completions.create({
                    model: 'gpt-4.1-nano', // 用最小模型生成 SQL (最便宜且足夠)
                    messages: [{ role: 'user', content: sqlPrompt }],
                    temperature: 0.1, // 低溫度確保穩定輸出
                    ...getTokenLimitParams('gpt-4.1-nano', 500),
                });
                generatedSQL = sqlCompletion.choices[0].message.content.trim();
            } catch (llmErr) {
                console.error('[Chat V2] SQL 生成失敗:', llmErr.message);
                // Fallback 到知識問答模式
                queryMode = 'knowledge';
            }

            // 檢查 LLM 是否判斷這不是資料查詢
            if (generatedSQL === 'NOT_A_DATA_QUERY') {
                console.log('[Chat V2] LLM 判斷此問題不需要查資料庫');
                queryMode = 'knowledge';
            }

            if (queryMode === 'data' && generatedSQL) {
                console.log(`[Chat V2] 生成的 SQL: ${generatedSQL}`);
                
                // 定義 SQL 修正函數（用於重試）
                const retryWithLLM = async (question, failedSQL, errorMsg) => {
                    const fixPrompt = `你之前生成的 SQL 執行失敗了，請修正。

原始問題: ${question}
失敗的 SQL: ${failedSQL}
錯誤訊息: ${errorMsg}

請分析錯誤原因並生成正確的 SQL。只輸出修正後的 SQL，不要解釋。
常見錯誤修正：
- column "xxx" does not exist → 檢查欄位名稱拼寫
- syntax error → 檢查 SQL 語法
- invalid input syntax → 檢查資料類型轉換`;
                    
                    const fixCompletion = await openai.chat.completions.create({
                        model: 'gpt-4.1-nano',
                        messages: [{ role: 'user', content: fixPrompt }],
                        temperature: 0.1,
                        ...getTokenLimitParams('gpt-4.1-nano', 500),
                    });
                    return fixCompletion.choices[0].message.content.trim();
                };
                
                // Step 2b: 安全驗證並執行 SQL（支援自動重試）
                const queryResult = await sqlQueryService.executeSecureQuery(generatedSQL, {
                    retryWithLLM,
                    originalQuestion: message,
                    maxRetries: 1
                });
                
                if (queryResult.retried) {
                    console.log(`[Chat V2] SQL 已透過重試修正成功`);
                }
                
                if (queryResult.success) {
                    executedSQL = queryResult.executedSQL;
                    queryResults = queryResult.rows;
                    
                    // [NEW] Step 2c-1: 如果結果超過閾值，自動生成 Excel 下載連結
                    // 使用無限制的匯出查詢來獲取完整資料
                    let downloadLink = null;
                    if (queryResult.rowCount >= EXCEL_EXPORT_THRESHOLD) {
                        try {
                            // 使用無限制查詢獲取完整資料用於 Excel 匯出
                            const exportResult = await sqlQueryService.executeSecureQueryForExport(generatedSQL);
                            
                            if (exportResult.success) {
                                const fileId = crypto.randomBytes(8).toString('hex');
                                const fileName = `查詢結果_${fileId}.xlsx`;
                                const filePath = path.join(EXPORT_DIR, fileName);
                                
                                const workbook = new ExcelJS.Workbook();
                                const worksheet = workbook.addWorksheet('查詢結果');
                                
                                // 使用完整的匯出資料
                                const exportData = exportResult.rows;
                                if (exportData.length > 0) {
                                    const columns = Object.keys(exportData[0]).map(key => ({
                                        header: key,
                                        key: key,
                                        width: 15
                                    }));
                                    worksheet.columns = columns;
                                    worksheet.addRows(exportData);
                                    
                                    // 設定標題列樣式
                                    worksheet.getRow(1).font = { bold: true };
                                    worksheet.getRow(1).fill = {
                                        type: 'pattern',
                                        pattern: 'solid',
                                        fgColor: { argb: 'FFE0E0E0' }
                                    };
                                }
                                
                                await workbook.xlsx.writeFile(filePath);
                                downloadLink = getFullDownloadUrl(fileName);
                                console.log(`[Chat V2] 已生成 Excel: ${fileName} (${exportResult.rowCount} 筆完整資料)`);
                            } else {
                                // 匯出查詢失敗，使用原本的有限結果
                                console.warn(`[Chat V2] Excel 匯出查詢失敗，使用限制資料: ${exportResult.error}`);
                            }
                        } catch (excelErr) {
                            console.error('[Chat V2] Excel 生成失敗:', excelErr.message);
                        }
                    }
                    
                    // Step 2c-2: 讓 LLM 解釋結果
                    const explanationPrompt = sqlQueryService.buildResultExplanationPrompt(
                        message, 
                        executedSQL, 
                        queryResults, 
                        queryResult.rowCount,
                        chatHistory
                    );
                    
                    // 如果有下載連結，用 Markdown 格式
                    let explainSystemPrompt = '你是一位專業的樹木與碳匯專家助理。請用繁體中文回答。如果使用者提到「剛才」或「上一個」問題，請參考對話歷史。';
                    const downloadMarkdown = downloadLink ? `[📥 點此下載完整 Excel 檔案](${downloadLink})` : null;
                    if (downloadMarkdown) {
                        explainSystemPrompt += `\n\n【重要】此次查詢結果共 ${queryResult.rowCount} 筆，資料量較大。請在回答最後加上下載連結（使用 Markdown 格式）：\n${downloadMarkdown}`;
                    }
                    
                    try {
                        // 根據模型類型選擇對應的 API
                        if (model_preference.startsWith('gemini-')) {
                            aiResponse = await generateGeminiChatResponse(explanationPrompt, explainSystemPrompt, [], model_preference);
                        } else if (model_preference.startsWith('Qwen/') || model_preference.startsWith('deepseek-ai/')) {
                            const { result: completion } = await chatCompletions({
                                model: model_preference,
                                messages: [
                                    { role: 'system', content: explainSystemPrompt },
                                    { role: 'user', content: explanationPrompt }
                                ],
                                temperature: 0.7,
                                ...getTokenLimitParams(model_preference, 1500),
                            });
                            aiResponse = completion.choices[0].message.content;
                        } else {
                            // OpenAI 模型
                            const completion = await openai.chat.completions.create({
                                model: model_preference,
                                messages: [
                                    { role: 'system', content: explainSystemPrompt },
                                    { role: 'user', content: explanationPrompt }
                                ],
                                temperature: 0.7,
                                ...getTokenLimitParams(model_preference, 1500),
                            });
                            aiResponse = completion.choices[0].message.content;
                        }
                        
                        // 備用：如果 LLM 沒有加入下載連結，手動附加 Markdown 格式
                        if (downloadMarkdown && !aiResponse.includes(downloadLink)) {
                            aiResponse += `\n\n${downloadMarkdown}`;
                        }
                    } catch (explainErr) {
                        console.error('[Chat V2] 結果解釋失敗:', explainErr.message);
                        // 直接回傳原始結果
                        aiResponse = `查詢到 ${queryResult.rowCount} 筆資料：\n${JSON.stringify(queryResults.slice(0, 10), null, 2)}`;
                        if (downloadMarkdown) {
                            aiResponse += `\n\n${downloadMarkdown}`;
                        }
                    }
                } else {
                    console.warn('[Chat V2] SQL 執行失敗:', queryResult.error);
                    // Fallback 到知識問答
                    queryMode = 'knowledge';
                }
            }
        }

        // Step 3: 知識問答模式（不使用 RAG）
        if (queryMode === 'knowledge') {
            console.log('[Chat V2] 使用知識問答模式（直接 LLM）');
            
            const systemPrompt = `你是一位專業的樹木永續發展與碳匯專家。
你擁有豐富的林業、生態學、碳循環相關知識。
請用繁體中文回答使用者的問題，提供專業且易懂的解答。
如果使用者詢問的是特定資料（如特定樹木編號、統計數據），
請告知他們可以使用更具體的查詢方式，例如指定樹木編號或專案名稱。`;

            // 構建包含歷史對話的 messages 陣列
            const messages = [
                { role: 'system', content: systemPrompt }
            ];
            
            // 加入歷史對話
            chatHistory.forEach(h => {
                messages.push({ role: 'user', content: h.message });
                messages.push({ role: 'assistant', content: h.response });
            });
            
            // 加入當前問題
            messages.push({ role: 'user', content: message });

            try {
                // 根據模型類型選擇對應的 API
                if (model_preference.startsWith('gemini-')) {
                    // Gemini 需要特殊處理歷史對話
                    const historyText = chatHistory.map(h => `用戶: ${h.message}\nAI: ${h.response}`).join('\n\n');
                    const messageWithHistory = historyText ? `${historyText}\n\n用戶: ${message}` : message;
                    aiResponse = await generateGeminiChatResponse(messageWithHistory, systemPrompt, [], model_preference);
                } else if (model_preference.startsWith('Qwen/') || model_preference.startsWith('deepseek-ai/')) {
                    const { result: completion } = await chatCompletions({
                        model: model_preference,
                        messages: messages,
                        temperature: 0.7,
                        ...getTokenLimitParams(model_preference, 1500),
                    });
                    aiResponse = completion.choices[0].message.content;
                } else {
                    // OpenAI 模型
                    const completion = await openai.chat.completions.create({
                        model: model_preference,
                        messages: messages,
                        temperature: 0.7,
                        ...getTokenLimitParams(model_preference, 1500),
                    });
                    aiResponse = completion.choices[0].message.content;
                }
            } catch (llmError) {
                console.error('[Chat V2] LLM 回答失敗:', llmError.message);
                aiResponse = '抱歉，處理您的問題時發生錯誤，請稍後再試。';
            }
        }

        // Step 4: 儲存聊天記錄（包含 session_id）
        if (userId) {
            try {
                await db.query(
                    `INSERT INTO chat_logs (user_id, message, response, model_used, project_areas, session_id) 
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [userId, message, aiResponse, model_preference, 
                     validProjectAreas.length > 0 ? JSON.stringify(validProjectAreas) : null,
                     sessionId || null]
                );
            } catch (logErr) {
                console.warn('[Chat V2] 儲存聊天記錄失敗:', logErr.message);
            }
        }

        // Step 5: 準備視覺化資料（可選，用於前端圖表）
        let chartData = null;
        if (queryMode === 'data' && queryResults && queryResults.length > 0) {
            // 檢測是否為分組統計查詢（含 COUNT, SUM, AVG 等聚合）
            const firstRow = queryResults[0];
            const keys = Object.keys(firstRow);
            const hasAggregation = keys.some(k => 
                k.toLowerCase().includes('count') || 
                k.toLowerCase().includes('sum') || 
                k.toLowerCase().includes('avg') ||
                k.toLowerCase().includes('total') ||
                k.toLowerCase().includes('碳') ||
                k.toLowerCase().includes('數量')
            );
            
            if (hasAggregation && queryResults.length <= 20) {
                // 嘗試自動識別標籤欄位和數值欄位
                const labelKey = keys.find(k => 
                    k.toLowerCase().includes('name') || 
                    k.toLowerCase().includes('species') ||
                    k.toLowerCase().includes('location') ||
                    k.toLowerCase().includes('project') ||
                    k.toLowerCase().includes('area') ||
                    k.toLowerCase().includes('type') ||
                    k.toLowerCase().includes('樹種') ||
                    k.toLowerCase().includes('區域') ||
                    k.toLowerCase().includes('類型')
                ) || keys[0];
                
                const valueKey = keys.find(k => 
                    k.toLowerCase().includes('count') || 
                    k.toLowerCase().includes('sum') || 
                    k.toLowerCase().includes('avg') ||
                    k.toLowerCase().includes('total') ||
                    k.toLowerCase().includes('碳') ||
                    k.toLowerCase().includes('數量')
                ) || keys[1];
                
                if (labelKey && valueKey && labelKey !== valueKey) {
                    chartData = {
                        type: queryResults.length <= 6 ? 'pie' : 'bar',
                        labelKey: labelKey,
                        valueKey: valueKey,
                        data: queryResults.map(row => ({
                            label: String(row[labelKey] || '未知'),
                            value: parseFloat(row[valueKey]) || 0
                        })).filter(d => d.value > 0)
                    };
                }
            }
        }

        // Step 5.1: [NEW] 生成智慧建議（兼容性新增）
        let suggestions = [];
        if (queryMode === 'data' && queryResults && queryResults.length > 0) {
            try {
                suggestions = generateSmartSuggestions(queryResults, generatedSQL, message);
            } catch (e) {
                console.log('[Chat V2] 生成建議失敗:', e.message);
            }
        }

        // Step 5.2: [NEW] 異常數據偵測（兼容性新增）
        let anomalies = [];
        if (queryMode === 'data' && queryResults && queryResults.length > 0) {
            try {
                anomalies = detectDataAnomalies(queryResults);
            } catch (e) {
                console.log('[Chat V2] 異常偵測失敗:', e.message);
            }
        }

        // Step 6: 回傳結果
        res.json({
            success: true,
            response: aiResponse,
            queryMode: queryMode,
            // executedSQL 已移除，避免洩漏資料庫結構
            resultCount: queryResults ? queryResults.length : null,
            modelUsed: model_preference,
            sessionId: sessionId, // 回傳 sessionId 讓前端可以追蹤
            chartData: chartData, // 可選的視覺化資料
            suggestions: suggestions.length > 0 ? suggestions : null, // [NEW] 智慧建議
            anomalies: anomalies.length > 0 ? anomalies : null // [NEW] 異常警示
        });

    } catch (error) {
        console.error('[Chat V2] 未預期錯誤:', error);
        res.status(500).json({ success: false, error: '處理請求時發生未預期錯誤' });
    }
});


// New route for direct OpenAI chat requests from frontend
router.post('/ai/direct-chat', requireRole('調查管理員'), aiLimiter, async (req, res) => {
    try {
        const { message, systemPrompt } = req.body;

        if (!message || !systemPrompt) {
            return res.status(400).json({ success: false, message: '請求中缺少 message 或 systemPrompt' });
        }

        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1', 
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ],
            temperature: 0.7,
            ...getTokenLimitParams('gpt-4.1', 1000),
        });

        const aiResponse = completion.choices[0].message.content;
        res.json({
            success: true,
            response: aiResponse,
        });

    } catch (error) {
        console.error('Direct OpenAI chat API 發生錯誤:', error);
        res.status(500).json({ success: false, error: '處理 Direct OpenAI chat 時發生錯誤' });
    }
});


// AI報告相關路由 — 調查管理員以上
router.get('/reports/ai-sustainability', requireRole('調查管理員'), aiLimiter, aiReportController.generateAIReport);
router.get('/reports/ai-sustainability/pdf', requireRole('調查管理員'), aiLimiter, async (req, res) => {
    // 此路由較複雜，暫時保持原樣，待確認 controller 內部邏輯
    try {
        const originalJson = res.json;
        let reportJsonData = null;
        res.json = (data) => {
            reportJsonData = data;
            res.json = originalJson; 
        };
        await aiReportController.generateAIReport(req, res);
        if (reportJsonData && reportJsonData.success) {
            const pdfBuffer = await aiReportController.generateAIReportPDF(reportJsonData.data);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `AI_Sustainability_Report_${timestamp}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(pdfBuffer);
        } else {
            res.json = originalJson;
            res.status(500).json({ success: false, message: '無法獲取 AI 報告數據以生成 PDF' });
        }
    } catch (error) {
        console.error('生成 AI 永續報告 PDF 時發生錯誤:', error);
        res.status(500).json({ success: false, message: '生成 AI 永續報告 PDF 時發生錯誤' });
    }
});

// [Stage 0.3] 已移除 sustainability-policy / carbon-education / carbon-footprint/advice / species-comparison：
//   依賴已刪除的 tree_carbon_data 表，且前端从未呼叫。


// ============================================
// [NEW] Excel 下載路由
// ============================================
// 
// 當 Chat V2 查詢結果超過 EXCEL_EXPORT_THRESHOLD 筆時，
// 會自動生成 Excel 檔案並在回應中附上此下載連結。
// 檔案會在 1 小時後自動清理。
// ============================================

// [稽核#12] 與其他 AI 路由一致限 調查管理員；前端 DownloadService 會帶 JWT header
router.get('/download/:filename', requireRole('調查管理員'), (req, res) => {
    let filename = req.params.filename || '';
    try {
        filename = decodeURIComponent(filename);
    } catch {
        return res.status(400).json({ success: false, message: '無效的檔案名稱編碼' });
    }

    const allowedExt = ['.xlsx', '.pdf'];
    const ext = path.extname(filename).toLowerCase();
    const base = path.basename(filename);
    if (!base || !allowedExt.includes(ext) || base.includes('..') || base !== filename) {
        return res.status(400).json({ success: false, message: '無效的檔案名稱' });
    }
    filename = base;

    const filePath = path.join(EXPORT_DIR, filename);
    
    // 檢查檔案是否存在
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ 
            success: false, 
            message: '檔案不存在或已過期，請重新查詢' 
        });
    }
    
    const contentType = ext === '.pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    
    // 串流傳輸檔案
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
        console.error('[Download] 檔案讀取錯誤:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: '檔案讀取失敗' });
        }
    });
    
    console.log(`[Download] 使用者下載: ${filename}`);
});


// ============================================
// [NEW] 智慧建議生成函數
// ============================================
function generateSmartSuggestions(queryResults, sql, userMessage) {
    const suggestions = [];
    
    if (!queryResults || queryResults.length === 0) return suggestions;
    
    const keys = Object.keys(queryResults[0]);
    const lowerSQL = (sql || '').toLowerCase();
    const lowerMsg = (userMessage || '').toLowerCase();
    
    // 1. 根據查詢類型提供建議
    if (lowerSQL.includes('count') || lowerMsg.includes('數量') || lowerMsg.includes('幾棵')) {
        suggestions.push({
            icon: '📊',
            text: '查看各區域的樹木分布比例',
            query: '各區域樹木數量佔比是多少？'
        });
    }
    
    if (lowerSQL.includes('carbon') || lowerMsg.includes('碳') || lowerMsg.includes('co2')) {
        suggestions.push({
            icon: '🌿',
            text: '分析碳吸存效率最高的樹種',
            query: '哪些樹種的碳吸存量最高？'
        });
        suggestions.push({
            icon: '📈',
            text: '查看碳儲存趨勢',
            query: '各區域的總碳儲存量比較'
        });
    }
    
    if (lowerSQL.includes('species') || lowerMsg.includes('樹種') || lowerMsg.includes('種類')) {
        suggestions.push({
            icon: '🌳',
            text: '查看樹種健康狀況分布',
            query: '各樹種的平均樹高和胸徑是多少？'
        });
    }
    
    if (lowerSQL.includes('dbh') || lowerMsg.includes('胸徑') || lowerMsg.includes('dbh')) {
        suggestions.push({
            icon: '📏',
            text: '分析胸徑與碳儲存的關係',
            query: '胸徑超過50公分的樹木有多少棵？'
        });
    }
    
    if (lowerSQL.includes('height') || lowerMsg.includes('樹高') || lowerMsg.includes('高度')) {
        suggestions.push({
            icon: '🏔️',
            text: '找出最高的樹木',
            query: '樹高超過10公尺的樹木有哪些？'
        });
    }
    
    // 2. 根據結果數量提供建議
    if (queryResults.length > 50) {
        suggestions.push({
            icon: '📋',
            text: '匯出完整數據到 Excel',
            query: '匯出這些數據'
        });
    }
    
    // 3. 根據欄位提供進階分析建議
    if (keys.some(k => k.toLowerCase().includes('location') || k.toLowerCase().includes('area'))) {
        suggestions.push({
            icon: '🗺️',
            text: '查看地理分布統計',
            query: '各區域的樹木統計概況'
        });
    }
    
    // 限制最多 4 個建議
    return suggestions.slice(0, 4);
}

// ============================================
// [NEW] 異常數據偵測函數
// ============================================
function detectDataAnomalies(queryResults) {
    const anomalies = [];
    
    if (!queryResults || queryResults.length === 0) return anomalies;
    
    const firstRow = queryResults[0];
    const keys = Object.keys(firstRow);
    
    // 統計各欄位的空值數量
    const nullCounts = {};
    keys.forEach(key => {
        nullCounts[key] = queryResults.filter(row => 
            row[key] === null || row[key] === undefined || row[key] === ''
        ).length;
    });
    
    // 1. 檢測空值過多的欄位
    keys.forEach(key => {
        const nullPercent = (nullCounts[key] / queryResults.length) * 100;
        if (nullPercent > 20 && nullCounts[key] > 0) {
            anomalies.push({
                type: 'null_values',
                severity: nullPercent > 50 ? 'warning' : 'info',
                icon: '⚠️',
                message: `欄位「${key}」有 ${nullCounts[key]} 筆空值 (${nullPercent.toFixed(1)}%)`
            });
        }
    });
    
    // 2. 檢測數值欄位的極端值
    keys.forEach(key => {
        const numericValues = queryResults
            .map(row => parseFloat(row[key]))
            .filter(v => !isNaN(v) && isFinite(v));
        
        if (numericValues.length < 3) return;
        
        const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
        const std = Math.sqrt(
            numericValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / numericValues.length
        );
        
        // 檢測超過 3 個標準差的極端值
        if (std > 0) {
            const outliers = numericValues.filter(v => Math.abs(v - mean) > 3 * std);
            if (outliers.length > 0) {
                anomalies.push({
                    type: 'outliers',
                    severity: 'info',
                    icon: '📊',
                    message: `欄位「${key}」有 ${outliers.length} 筆極端值 (超過 3 個標準差)`
                });
            }
        }
        
        // 檢測負值（對於某些欄位不應該有負值）
        const negativeKeys = ['carbon', 'height', 'dbh', '碳', '高度', '胸徑', '數量', 'count'];
        if (negativeKeys.some(nk => key.toLowerCase().includes(nk))) {
            const negatives = numericValues.filter(v => v < 0);
            if (negatives.length > 0) {
                anomalies.push({
                    type: 'negative_values',
                    severity: 'warning',
                    icon: '❌',
                    message: `欄位「${key}」有 ${negatives.length} 筆負值，可能是資料錯誤`
                });
            }
        }
    });
    
    // 3. 檢測重複資料（如果有 id 欄位）
    const idKey = keys.find(k => k.toLowerCase() === 'id' || k.toLowerCase().includes('_id'));
    if (idKey) {
        const ids = queryResults.map(row => row[idKey]);
        const uniqueIds = new Set(ids);
        if (uniqueIds.size < ids.length) {
            anomalies.push({
                type: 'duplicates',
                severity: 'info',
                icon: '🔄',
                message: `發現 ${ids.length - uniqueIds.size} 筆重複的 ID`
            });
        }
    }
    
    // 限制最多 5 個異常提醒
    return anomalies.slice(0, 5);
}


module.exports = router;
