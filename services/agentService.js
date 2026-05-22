/**
 * AI Agent Service - 碳匯永續智慧代理
 * 
 * 使用 SiliconFlow API (OpenAI-compatible) 實現 ReAct 風格的 Agent，
 * 具備工具調用能力，專注於碳匯與永續發展領域。
 * 
 * 支援的工具（唯讀，不寫入資料庫）:
 * 1. fetch_allowed_url       - 白名單網址單頁抓取
 * 2. search_public_documents - 政府/IPCC 限定搜尋（可選 Google CSE）
 * 3. export_excel / export_pdf / export_ai_report - 報表匯出
 * 
 * @module services/agentService
 */

const db = require('../config/db');
const OpenAI = require('openai');
const {
    chatCompletions,
    getOpenAIClient,
    getSiliconFlowKeyList,
    mapToOpenAIModel,
} = require('./llmProviderService');
const {
    fetchAllowedUrl,
    fetchAllowedUrls,
    searchPublicDocuments,
    listDemoPolicyUrls,
    listPolicySources,
    listAllowedDomains,
} = require('./agentExternalRetrievalService');
const {
    toolExportExcel,
    toolExportPdf,
    toolExportAiReport,
} = require('./agentExportService');

// ============================================
// SiliconFlow / DeepSeek 客戶端初始化
// ============================================

// 主要: SiliconFlow (免費額度)
let siliconFlowClient = null;
const SF_KEYS = [
    process.env.SiliconFlow_API_KEY,
    process.env.Alt1_SiliconFlow_API_KEY,
    process.env.Alt2_SiliconFlow_API_KEY,
    process.env.Alt3_SiliconFlow_API_KEY,
].filter(Boolean);

if (SF_KEYS.length > 0) {
    siliconFlowClient = new OpenAI({
        apiKey: SF_KEYS[0],
        baseURL: 'https://api.siliconflow.cn/v1',
    });
}

// 輪替 key 索引 (當一個 key 額度用完時切換下一個)
let currentKeyIndex = 0;

function getNextClient() {
    if (SF_KEYS.length === 0) return null;
    currentKeyIndex = (currentKeyIndex + 1) % SF_KEYS.length;
    return new OpenAI({
        apiKey: SF_KEYS[currentKeyIndex],
        baseURL: 'https://api.siliconflow.cn/v1',
    });
}

// ============================================
// Agent 可選模型 (只用 SiliconFlow 免費)
// ============================================

const AGENT_MODELS = {
    /** 預設：OpenAI 性價比最高；SiliconFlow 可用時前端可改選 */
    default: process.env.AGENT_DEFAULT_MODEL || 'gpt-5.4-mini',
    reasoning: 'gpt-5.4-mini',
    fast: 'gpt-5.4-mini',
    deepseek: 'deepseek-ai/DeepSeek-V3',
    strong: 'gpt-5.4',
};

// ============================================
// 速率限制: 每使用者每小時 token 預算
// ============================================

const TOKEN_BUDGET_PER_HOUR = 50000; // 每使用者每小時 50k tokens
const MAX_AGENT_STEPS = 8;           // 最多 8 步工具調用

// ── Token 預算持久化 (PostgreSQL) ──
// 解決 PM2 cluster 模式跨 instance 不共享、restart 後丟失的問題
let _tokenTableReady = false;
async function _ensureTokenTable() {
    if (_tokenTableReady) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS agent_token_usage (
            user_id VARCHAR(255) PRIMARY KEY,
            tokens_used INTEGER DEFAULT 0,
            window_start TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    _tokenTableReady = true;
}

async function checkTokenBudget(userId) {
    await _ensureTokenTable();
    const result = await db.query(
        `SELECT tokens_used, window_start FROM agent_token_usage WHERE user_id = $1`,
        [userId]
    );
    if (result.rows.length === 0) return true;
    const record = result.rows[0];
    const elapsed = Date.now() - new Date(record.window_start).getTime();
    if (elapsed > 3600000) {
        await db.query(
            `UPDATE agent_token_usage SET tokens_used = 0, window_start = NOW() WHERE user_id = $1`,
            [userId]
        );
        return true;
    }
    return record.tokens_used < TOKEN_BUDGET_PER_HOUR;
}

async function addTokenUsage(userId, tokens) {
    await _ensureTokenTable();
    await db.query(`
        INSERT INTO agent_token_usage (user_id, tokens_used, window_start)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            tokens_used = CASE
                WHEN NOW() - agent_token_usage.window_start > INTERVAL '1 hour'
                THEN $2
                ELSE agent_token_usage.tokens_used + $2
            END,
            window_start = CASE
                WHEN NOW() - agent_token_usage.window_start > INTERVAL '1 hour'
                THEN NOW()
                ELSE agent_token_usage.window_start
            END
    `, [userId, tokens]);
}

// ============================================
// Agent 工具定義 (OpenAI function calling format)
// ============================================

const AGENT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'fetch_allowed_url',
            description: '抓取白名單內政府／IPCC 等公開網頁內容（gov.tw、moenv.gov.tw、林業署、ipcc.ch 等）。回傳標題、段落摘要、citation 欄位。用於碳盤查方法學、政策、森林碳匯手冊公開頁。',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: '完整 https 網址' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_demo_policy_urls',
            description: '列出內建之政府碳匯／環境政策入口網址（白名單）。搜尋 API 不可用或需快速 demo 時使用，再搭配 fetch_allowed_url 讀內容。',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_policy_sources',
            description: '依分類列出可檢索的政策／方法學入口（環境、森林、農業、國際 IPCC 等）。可選 category 篩選，再 fetch 內容。',
            parameters: {
                type: 'object',
                properties: {
                    category: { type: 'string', description: '如「森林」「國際」' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_allowed_domains',
            description: '說明 Agent 可抓取的網域白名單規則（gov.tw、IPCC 等）。使用者問「還能查哪些網站」時使用。',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'fetch_allowed_urls',
            description: '一次讀取 2～3 個白名單網址並比較摘要（例如環境部＋林業署）。每個 url 須為完整 https。',
            parameters: {
                type: 'object',
                properties: {
                    urls: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '2～3 個白名單 https 網址',
                    },
                },
                required: ['urls'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_public_documents',
            description: '在政府與 IPCC 相關網域搜尋公開文件（需伺服器設定 Google CSE）。回傳標題與連結列表，之後可用 fetch_allowed_url 讀內文。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '搜尋關鍵字，如「森林碳匯 調查 手冊」' },
                    max_results: { type: 'number', description: '最多幾筆，預設 5' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'export_excel',
            description: '匯出樹木調查資料為 Excel（唯讀匯出，不修改資料庫）。回傳 downloadUrl。',
            parameters: {
                type: 'object',
                properties: {
                    project_area: { type: 'string', description: '專案區位名稱，如台中港' },
                    project_codes: { type: 'string', description: '專案代碼，逗號分隔' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'export_pdf',
            description: '匯出樹木調查資料 PDF 摘要（唯讀匯出）。回傳 downloadUrl。',
            parameters: {
                type: 'object',
                properties: {
                    project_area: { type: 'string' },
                    project_codes: { type: 'string' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'export_ai_report',
            description: '產生 AI 永續分析報告 PDF（依現有調查資料統計＋AI 文字分析，不寫入資料庫）。回傳 downloadUrl 與 preview。',
            parameters: {
                type: 'object',
                properties: {
                    project_areas: { type: 'string', description: '專案區位，逗號分隔' },
                    min_dbh: { type: 'number' },
                    max_dbh: { type: 'number' },
                },
                required: [],
            },
        },
    },
];

async function executeToolCall(toolName, args, ctx) {
    const { userId, userRole } = ctx;
    switch (toolName) {
        case 'fetch_allowed_url':
            return await fetchAllowedUrl(args.url);
        case 'list_demo_policy_urls':
            return await listDemoPolicyUrls();
        case 'list_policy_sources':
            return await listPolicySources({ category: args.category });
        case 'list_allowed_domains':
            return await listAllowedDomains();
        case 'fetch_allowed_urls':
            return await fetchAllowedUrls(args.urls);
        case 'search_public_documents':
            return await searchPublicDocuments({
                query: args.query,
                max_results: args.max_results,
            });
        case 'export_excel':
            return await toolExportExcel({
                userId,
                userRole,
                project_codes: args.project_codes,
                project_area: args.project_area,
            });
        case 'export_pdf':
            return await toolExportPdf({
                userId,
                userRole,
                project_codes: args.project_codes,
                project_area: args.project_area,
            });
        case 'export_ai_report':
            return await toolExportAiReport({
                userId,
                userRole,
                project_areas: args.project_areas,
                min_dbh: args.min_dbh,
                max_dbh: args.max_dbh,
            });
        default:
            return { error: `未知的工具: ${toolName}` };
    }
}

const AGENT_SYSTEM_PROMPT = `你是「碳匯永續智慧助理」，服務台灣港務公司(TIPC)智慧樹木碳匯管理平台。

## 核心規則
1. **不得修改或刪除任何資料庫資料**；僅能使用下列工具。
2. 說明政策、方法學、碳盤查概念時，**必須**先用 search_public_documents 或 fetch_allowed_url 取得公開來源，再回答。
3. 每段引用官方內容時，回覆末尾列出工具回傳的 **citation** 或「依據：標題（URL，擷取日期）」。
4. 不可捏造網址；僅使用工具回傳的 url。
5. 匯出請用 export_excel / export_pdf / export_ai_report，並在回覆中附上 **downloadUrl**（Markdown 連結）。
6. 不回答碳權市場定價；若被問則說明本系統僅協助盤查與報告匯出。

## 可用工具
- **list_policy_sources** / **list_demo_policy_urls** — 分類政策入口（環境部、林業署、農業部、IPCC 等）
- **list_allowed_domains** — 說明可抓取哪些網域（含 .gov.tw）
- **fetch_allowed_url** — 讀取單一白名單網頁
- **fetch_allowed_urls** — 一次讀 2～3 頁並比較（跨部會政策時優先）
- **search_public_documents** — 搜尋政府／IPCC（需 Google CSE，未設定則改 list + fetch）
- **export_excel** / **export_pdf** / **export_ai_report** — 報表下載

## 建議流程
政策／方法學 → list_policy_sources → fetch_allowed_url 或 fetch_allowed_urls → 綜合回答並列 citation  
要檔案 → export 工具  
使用者提供 https://*.gov.tw 連結 → 可直接 fetch_allowed_url  

用繁體中文，語氣專業友善。`;

/**
 * 執行 Agent ReAct Loop
 * 
 * @param {string} message - 使用者訊息
 * @param {string} userId - 使用者 ID
 * @param {Array} chatHistory - 歷史對話
 * @param {Object} options - 選項 { model, maxSteps }
 * @returns {Object} { response, toolCalls, tokensUsed }
 */
async function runAgent(message, userId, chatHistory = [], options = {}) {
    const model = options.model || AGENT_MODELS.default;
    const maxSteps = Math.min(options.maxSteps || MAX_AGENT_STEPS, MAX_AGENT_STEPS);

    // 檢查 token 預算
    if (!(await checkTokenBudget(userId))) {
        return {
            response: '⚠️ 您的 AI Agent 使用額度已達到每小時上限 (50,000 tokens)，請稍後再試。',
            toolCalls: [],
            tokensUsed: 0,
        };
    }

    if (!siliconFlowClient && !getOpenAIClient()) {
        return {
            response: '❌ AI Agent 服務未配置 (SiliconFlow / OpenAI API Key 均未設定)',
            toolCalls: [],
            tokensUsed: 0,
        };
    }

    let activeModel = model;
    let useSiliconFlowFirst = Boolean(siliconFlowClient || getSiliconFlowKeyList().length);

    // 構建 messages
    const messages = [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
    ];

    // 加入歷史對話 (最近 5 筆)
    const recentHistory = chatHistory.slice(-5);
    for (const h of recentHistory) {
        messages.push({ role: 'user', content: h.message });
        messages.push({ role: 'assistant', content: h.response });
    }

    messages.push({ role: 'user', content: message });

    const allToolCalls = [];
    let totalTokens = 0;

    async function agentCompletion(msgs) {
        const { result, provider, modelUsed } = await chatCompletions({
            model: activeModel,
            messages: msgs,
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
            temperature: 0.1,
            max_tokens: 2000,
            preferSiliconFlow: useSiliconFlowFirst,
        });
        if (provider === 'openai') {
            useSiliconFlowFirst = false;
            activeModel = modelUsed || mapToOpenAIModel(activeModel);
            console.log(`[Agent] 使用 OpenAI 備援模型: ${activeModel}`);
        }
        return result;
    }

    // ReAct Loop
    for (let step = 0; step < maxSteps; step++) {
        try {
            const completion = await agentCompletion(messages);

            const assistantMsg = completion.choices[0].message;
            const usage = completion.usage || {};
            totalTokens += (usage.total_tokens || 0);

            // 如果沒有工具調用，表示 Agent 已完成
            if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
                const content = assistantMsg.content || '';
                
                // 偵測 LLM 拒絕回答的情況 (可能被內容審核攔截)
                const isRefusal = !content || content.includes('無法') || content.includes('抱歉') || content.length < 10;
                
                if (isRefusal && step === 0 && allToolCalls.length === 0) {
                    // 第一輪就被拒絕且未呼叫任何工具：用學術化語言重試一次
                    console.warn(`[Agent] LLM 拒絕或空回應 (step ${step}), content: "${content.substring(0, 100)}", 嘗試重新引導...`);
                    messages.pop(); // 移除剛才的 user message
                    messages.push({
                        role: 'user',
                        content: `請使用 search_public_documents 或 fetch_allowed_url 等工具回答：${message}`,
                    });
                    continue; // 重試 ReAct loop
                }
                
                if (!content) {
                    console.warn(`[Agent] LLM 回傳空內容且無工具調用 (step ${step})`);
                }
                
                await addTokenUsage(userId, totalTokens);
                return {
                    response: content || '目前無法取得分析結果，請換個方式描述您的問題再試一次。',
                    toolCalls: allToolCalls,
                    tokensUsed: totalTokens,
                };
            }

            // 執行工具調用
            messages.push(assistantMsg);

            for (const toolCall of assistantMsg.tool_calls) {
                const fnName = toolCall.function.name;
                let fnArgs;
                try {
                    fnArgs = JSON.parse(toolCall.function.arguments);
                } catch {
                    fnArgs = {};
                }

                console.log(`[Agent] Step ${step + 1}: ${fnName}(${JSON.stringify(fnArgs).substring(0, 100)})`);

                const result = await executeToolCall(fnName, fnArgs, {
                    userId,
                    userRole: options.userRole || '調查管理員',
                });
                // 限制結果大小: 先截斷資料陣列，再 stringify，避免產生無效 JSON
                let resultForMsg = result;
                if (result && result.data && Array.isArray(result.data) && result.data.length > 50) {
                    resultForMsg = { ...result, data: result.data.slice(0, 50), truncated: true, totalRows: result.data.length };
                }
                const resultStr = JSON.stringify(resultForMsg).substring(0, 4000);

                allToolCalls.push({
                    tool: fnName,
                    args: fnArgs,
                    result: result,
                });

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: resultStr,
                });
            }
        } catch (err) {
            console.error(`[Agent] Step ${step + 1} error:`, err.message);
            
            // SiliconFlow 403/401/429 → 改用 OpenAI 重試
            if (err.status === 401 || err.status === 403 || err.status === 429) {
                if (getOpenAIClient()) {
                    useSiliconFlowFirst = false;
                    activeModel = mapToOpenAIModel(activeModel);
                    console.log(`[Agent] API ${err.status}，切換 OpenAI 備援 (${activeModel})`);
                    continue;
                }
            }
            
            await addTokenUsage(userId, totalTokens);
            return {
                response: `處理過程中發生錯誤: ${err.message}`,
                toolCalls: allToolCalls,
                tokensUsed: totalTokens,
            };
        }
    }

    // 超過最大步數，返回目前的結果
    await addTokenUsage(userId, totalTokens);
    
    // 嘗試獲取最終回應
    try {
        const { result: finalCompletion } = await chatCompletions({
            model: activeModel,
            messages: [
                ...messages,
                { role: 'user', content: '請根據以上工具結果，給出最終的完整回答。' },
            ],
            temperature: 0.3,
            max_tokens: 2000,
            preferSiliconFlow: useSiliconFlowFirst,
        });
        return {
            response: finalCompletion.choices[0].message.content,
            toolCalls: allToolCalls,
            tokensUsed: totalTokens + (finalCompletion.usage?.total_tokens || 0),
        };
    } catch {
        return {
            response: '已收集資料但無法生成最終回答，請重新嘗試。',
            toolCalls: allToolCalls,
            tokensUsed: totalTokens,
        };
    }
}

module.exports = {
    runAgent,
    AGENT_MODELS,
    AGENT_TOOLS,
    checkTokenBudget,
};
