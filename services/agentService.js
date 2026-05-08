/**
 * AI Agent Service - 碳匯永續智慧代理
 * 
 * 使用 SiliconFlow API (OpenAI-compatible) 實現 ReAct 風格的 Agent，
 * 具備工具調用能力，專注於碳匯與永續發展領域。
 * 
 * 支援的工具:
 * 1. query_tree_data    - 查詢樹木資料庫
 * 2. calculate_carbon   - 計算碳匯指標
 * 3. species_carbon_info - 查詢樹種碳匯參數
 * 4. project_summary    - 取得專案統計摘要
 * 5. carbon_report      - 生成碳匯報告
 * 
 * @module services/agentService
 */

const db = require('../config/db');
const OpenAI = require('openai');
const sqlQueryService = require('./sqlQueryService');
const carbonCalculationService = require('./carbonCalculationService');

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
    // Qwen2.5-72B: 已驗證支援 SiliconFlow function calling
    default: 'Qwen/Qwen2.5-72B-Instruct',
    reasoning: 'Qwen/QwQ-32B',
    fast: 'Qwen/Qwen2.5-7B-Instruct',
    deepseek: 'deepseek-ai/DeepSeek-V3',
    strong: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
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
            name: 'query_tree_data',
            description: '查詢樹木資料庫。可以查詢樹木調查數據、碳儲存、樹種分布等。輸入自然語言描述即可，系統會自動轉為 SQL 查詢。',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '使用者的查詢需求，例如：「高雄港有多少棵樹」、「碳儲存量最高的樹種」',
                    },
                    project_area: {
                        type: 'string',
                        description: '可選，限定查詢的專案區域，如「高雄港」、「花蓮港」',
                    },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'calculate_carbon',
            description: '根據樹木的胸徑(DBH)和樹高計算碳匯指標，包括碳儲存量、年碳吸存量、CO2 當量等。支援單棵或批量計算。',
            parameters: {
                type: 'object',
                properties: {
                    dbh_cm: {
                        type: 'number',
                        description: '胸高直徑(公分)',
                    },
                    height_m: {
                        type: 'number',
                        description: '樹高(公尺)',
                    },
                    species: {
                        type: 'string',
                        description: '樹種名稱（可選，用於查找樹種特定的碳係數）',
                    },
                },
                required: ['dbh_cm'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'species_carbon_info',
            description: '查詢特定樹種的碳匯參數，包括碳吸收範圍、生長速率、碳效率等資訊。適合比較不同樹種的碳匯能力。',
            parameters: {
                type: 'object',
                properties: {
                    species_name: {
                        type: 'string',
                        description: '樹種名稱（中文），例如「榕樹」、「欖仁」',
                    },
                },
                required: ['species_name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'project_summary',
            description: '取得指定專案區域或全部區域的統計摘要，包括樹木總數、平均碳儲存、樹種多樣性等。',
            parameters: {
                type: 'object',
                properties: {
                    project_area: {
                        type: 'string',
                        description: '專案區域名稱，留空表示全部區域',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'carbon_credit_estimate',
            description: '統計樹木碳匯效益。根據調查資料彙總碳儲存量與 CO₂ 當量，計算方法基於 TIPC AR-TMS0001 (環境部/林業署森林碳匯調查手冊式 6-4)。僅提供碳吸存量科學統計，不提供碳權定價或方法學折減率（實際碳信用額度需經授權驗證機構 VVB 核證）。',
            parameters: {
                type: 'object',
                properties: {
                    project_area: {
                        type: 'string',
                        description: '專案區域名稱',
                    },
                    period_years: {
                        type: 'number',
                        description: '計算期間(年)，預設 10 年',
                    },
                },
                required: [],
            },
        },
    },
];

// ============================================
// 工具執行函數
// ============================================

async function executeToolCall(toolName, args) {
    switch (toolName) {
        case 'query_tree_data':
            return await toolQueryTreeData(args);
        case 'calculate_carbon':
            return await toolCalculateCarbon(args);
        case 'species_carbon_info':
            return await toolSpeciesCarbonInfo(args);
        case 'project_summary':
            return await toolProjectSummary(args);
        case 'carbon_credit_estimate':
            return await toolCarbonCreditEstimate(args);
        default:
            return { error: `未知的工具: ${toolName}` };
    }
}

// --- Tool: query_tree_data ---
async function toolQueryTreeData({ query, project_area }) {
    try {
        // 使用 sqlQueryService 的能力生成並執行 SQL
        const sqlPrompt = sqlQueryService.buildSQLGenerationPrompt(query, []);
        
        // 用 SiliconFlow 生成 SQL (最便宜的模型)
        const client = siliconFlowClient || getNextClient();
        if (!client) return { error: 'SiliconFlow 未配置' };

        const sqlCompletion = await client.chat.completions.create({
            model: 'Qwen/Qwen2.5-7B-Instruct',
            messages: [{ role: 'user', content: sqlPrompt }],
            temperature: 0.1,
            max_tokens: 500,
        });
        
        let generatedSQL = sqlCompletion.choices[0].message.content.trim();
        
        if (generatedSQL === 'NOT_A_DATA_QUERY') {
            return { result: '此問題不需要查詢資料庫', query };
        }

        // 如果指定了區域，在 SQL prompt 中加入提示讓 LLM 自行處理
        // 注意：不直接拼接到 SQL 中，由 LLM 生成的 SQL 經 executeSecureQuery 驗證
        if (project_area) {
            const safeArea = project_area.replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s]/g, '');
            if (safeArea && !generatedSQL.toUpperCase().includes('PROJECT_LOCATION')) {
                if (generatedSQL.toUpperCase().includes('WHERE')) {
                    generatedSQL = generatedSQL.replace(/WHERE/i, `WHERE project_location ILIKE '%${safeArea}%' AND`);
                } else {
                    generatedSQL = generatedSQL.replace(/FROM\s+(\w+)/i, `FROM $1 WHERE project_location ILIKE '%${safeArea}%'`);
                }
            }
        }

        const queryResult = await sqlQueryService.executeSecureQuery(generatedSQL, {
            maxRetries: 0,
        });

        if (queryResult.success) {
            return {
                data: queryResult.rows,
                rowCount: queryResult.rowCount,
                sql: queryResult.executedSQL,
            };
        } else {
            return { error: queryResult.error };
        }
    } catch (err) {
        return { error: err.message };
    }
}

// --- Tool: calculate_carbon ---
async function toolCalculateCarbon({ dbh_cm, height_m, species }) {
    // 碳匯計算公式 — TIPC AR-TMS0001 / 林業署森林碳匯調查與監測手冊式 6-4
    // 邏輯統一委派 services/carbonCalculationService.js (與 transfer route 共用)
    const detail = carbonCalculationService.calculateCarbonStorageDetail(species, dbh_cm, height_m);
    if (detail.error) return { error: detail.error };

    const carbonStorage_kgCO2e = detail.value;
    const carbonStorage_tonCO2e = Math.round(carbonStorage_kgCO2e / 1000 * 1000) / 1000;

    return {
        input: { dbh_cm, height_m, species: species || '未提供' },
        formula: detail.formula,
        coefficients: {
            ...detail.coefficients,
            source: detail.source,
            species_matched: detail.species_matched,
        },
        carbon: {
            storage_kg_co2e: carbonStorage_kgCO2e,
            storage_ton_co2e: carbonStorage_tonCO2e,
        },
        annual: {
            note: 'TIPC 年固碳量 (carbon_sequestration_per_year) 內部公式涉及樹齡且未公開，本工具不進行客端重算；請查詢資料庫中的 carbon_sequestration_per_year 欄位。',
        },
        methodology: detail.methodology,
        note: '本計算為 TIPC 平台一致之估算值；實際碳信用需經授權驗證機構 (VVB) 查驗。',
    };
}

// --- Tool: species_carbon_info ---
async function toolSpeciesCarbonInfo({ species_name }) {
    try {
        const result = await db.query(
            `SELECT * FROM tree_carbon_data WHERE common_name_zh ILIKE $1 LIMIT 5`,
            [`%${species_name}%`]
        );

        if (result.rows.length > 0) {
            return { species: result.rows };
        }

        // 也查詢 tree_survey 中的統計資料
        const stats = await db.query(
            `SELECT 
                species_name,
                COUNT(*) as tree_count,
                ROUND(AVG(dbh_cm)::numeric, 1) as avg_dbh,
                ROUND(AVG(tree_height_m)::numeric, 1) as avg_height,
                ROUND(AVG(carbon_storage)::numeric, 1) as avg_carbon_storage,
                ROUND(SUM(carbon_storage)::numeric, 1) as total_carbon,
                ROUND(AVG(carbon_sequestration_per_year)::numeric, 2) as avg_annual_seq
            FROM tree_survey 
            WHERE species_name ILIKE $1
            GROUP BY species_name
            LIMIT 5`,
            [`%${species_name}%`]
        );

        if (stats.rows.length > 0) {
            return { species_stats: stats.rows };
        }

        return { message: `未找到樹種「${species_name}」的資料` };
    } catch (err) {
        return { error: err.message };
    }
}

// --- Tool: project_summary ---
async function toolProjectSummary({ project_area }) {
    try {
        let whereClause = '';
        const params = [];
        if (project_area) {
            whereClause = `WHERE project_location ILIKE $1`;
            params.push(`%${project_area}%`);
        }

        const summary = await db.query(
            `SELECT 
                project_location,
                COUNT(*) as tree_count,
                COUNT(DISTINCT species_name) as species_count,
                ROUND(AVG(dbh_cm)::numeric, 1) as avg_dbh_cm,
                ROUND(AVG(tree_height_m)::numeric, 1) as avg_height_m,
                ROUND(SUM(carbon_storage)::numeric, 1) as total_carbon_kg,
                ROUND(AVG(carbon_storage)::numeric, 1) as avg_carbon_kg,
                ROUND(SUM(carbon_sequestration_per_year)::numeric, 1) as total_annual_seq_kg
            FROM tree_survey 
            ${whereClause}
            GROUP BY project_location 
            ORDER BY tree_count DESC`,
            params
        );

        // 計算全局統計
        const totals = await db.query(
            `SELECT 
                COUNT(*) as total_trees,
                COUNT(DISTINCT species_name) as total_species,
                COUNT(DISTINCT project_location) as total_areas,
                ROUND(SUM(carbon_storage)::numeric, 1) as total_carbon_kg,
                ROUND(SUM(carbon_sequestration_per_year)::numeric, 1) as total_annual_seq_kg
            FROM tree_survey ${whereClause}`,
            params
        );

        return {
            areas: summary.rows,
            totals: totals.rows[0],
            // DB carbon_storage 已是 kg CO₂e (TIPC 公式內含 44/12)，不再乘 3.667
            co2_equivalent_tons: totals.rows[0]
                ? Math.round((parseFloat(totals.rows[0].total_carbon_kg) || 0) / 1000 * 100) / 100
                : 0,
        };
    } catch (err) {
        return { error: err.message };
    }
}

// --- Tool: carbon_credit_estimate (已重構：僅提供碳吸存科學統計) ---
// [2026-04-13] 移除原先未經驗證的方法學折減率(VCS/Gold Standard/台灣抵換)及碳權定價。
// 原因：Gold Standard 無 buffer pool 機制，VCS 折減率因專案而異(10-60%)，
//       碳價數據無明確出處。改為僅回傳碳儲存量與 CO₂ 當量的科學計算結果。
async function toolCarbonCreditEstimate({ project_area, period_years = 10 }) {
    try {
        let whereClause = '';
        const params = [];
        if (project_area) {
            whereClause = `WHERE project_location ILIKE $1`;
            params.push(`%${project_area}%`);
        }

        const data = await db.query(
            `SELECT 
                COUNT(*) as tree_count,
                ROUND(SUM(carbon_storage)::numeric, 1) as total_carbon_kg,
                ROUND(SUM(carbon_sequestration_per_year)::numeric, 1) as annual_seq_kg,
                ROUND(AVG(dbh_cm)::numeric, 1) as avg_dbh
            FROM tree_survey ${whereClause}`,
            params
        );

        const stats = data.rows[0];
        if (!stats || stats.tree_count === 0) {
            return { message: '未找到符合條件的樹木資料' };
        }

        // DB 中 carbon_storage / carbon_sequestration_per_year 已是 kg CO₂e
        // (TIPC K_sp 公式內含 44/12)，不再乘 3.667
        const totalCO2_kg = parseFloat(stats.total_carbon_kg) || 0;
        const annualCO2_kg = parseFloat(stats.annual_seq_kg) || 0;

        const currentCO2_ton = totalCO2_kg / 1000;
        const annualCO2_ton = annualCO2_kg / 1000;
        const periodCO2_ton = annualCO2_ton * period_years;

        return {
            project: project_area || '全部區域',
            tree_count: parseInt(stats.tree_count),
            avg_dbh_cm: parseFloat(stats.avg_dbh) || 0,
            period_years,
            methodology: 'TIPC AR-TMS0001 / 林業署森林碳匯手冊式 6-4 (K_sp · DBH² · H)',
            current_stock: {
                co2_equivalent_ton: Math.round(currentCO2_ton * 100) / 100,
            },
            projected: {
                annual_co2_ton: Math.round(annualCO2_ton * 100) / 100,
                period_co2_ton: Math.round(periodCO2_ton * 100) / 100,
            },
            note: '本統計適用 TIPC 平台一致之公式；實際碳信用額度需經授權驗證機構 (VVB) 依特定方法學核證後方可取得，'
                + '本系統不提供碳權定價或方法學折減率估算。',
        };
    } catch (err) {
        return { error: err.message };
    }
}

// ============================================
// Agent 主函數: ReAct Loop
// ============================================

const AGENT_SYSTEM_PROMPT = `你是「碳匯永續智慧助理」，一個專門服務於台灣港務公司(TIPC)永續碳匯管理系統的 AI Agent。

## 核心規則 (必須遵守)
1. **你必須使用工具查詢數據，絕對不可以編造或猜測任何數字。**
2. 即使是簡單的問題（例如「有多少棵樹」），也必須先調用工具取得真實數據再回答。
3. 當使用者的問題涉及多個面向時，你應該調用多個工具分別取得數據，再綜合回答。
4. 如果工具傳回錯誤，嘗試換一種方式查詢，或誠實告知使用者查詢失敗。

## 可用工具
1. **query_tree_data** — 查詢樹木資料庫 (胸徑、樹高、碳儲存、樹種分布等)
2. **calculate_carbon** — 計算碳匯指標 (碳儲存量、CO₂ 當量、年碳吸存)
3. **species_carbon_info** — 查詢特定樹種的碳匯參數
4. **project_summary** — 取得專案區域統計摘要
5. **carbon_credit_estimate** — 統計樹木碳匯效益 (碳儲存量與 CO₂ 當量，不含碳權定價)

## 回答準則
- 回答時必須引用工具返回的實際數據
- 碳匯計算要說明使用的方法學和公式
- 涉及碳匯效益評估時要聲明「此為學術估算，需經第三方驗證」
- 當使用者詢問「碳匯」「減碳效益」「碳吸存評估」「碳儲存統計」等問題時，務必調用 carbon_credit_estimate 工具
- 若使用者詢問「碳權價格」「碳交易價值」等碳權定價問題，應說明本系統僅提供碳吸存量科學統計，碳信用額度與定價需經授權驗證機構 (VVB) 核證
- 用繁體中文回答，語氣專業但友善
- 可以結合多個工具回答複雜問題

## 服務對象
- 環境學院教授和研究生 (學術研究)
- TIPC 永續發展部門 (碳盤查和碳交易)
- 林業調查員 (現場數據管理)`;

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

    const client = siliconFlowClient;
    if (!client) {
        return {
            response: '❌ AI Agent 服務未配置 (SiliconFlow API Key 未設定)',
            toolCalls: [],
            tokensUsed: 0,
        };
    }

    // 使用局部變數追蹤當前使用的 client，以支援 key 輪替
    let activeClient = client;

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

    // ReAct Loop
    for (let step = 0; step < maxSteps; step++) {
        try {
            const completion = await activeClient.chat.completions.create({
                model,
                messages,
                tools: AGENT_TOOLS,
                tool_choice: 'auto',
                temperature: 0.1,
                max_tokens: 2000,
            });

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
                        content: `請使用工具回答以下環境科學研究問題：${message}`,
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

                const result = await executeToolCall(fnName, fnArgs);
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
            
            // 如果是 API key 錯誤，嘗試切換 key
            if (err.status === 401 || err.status === 429) {
                const nextClient = getNextClient();
                if (nextClient) {
                    activeClient = nextClient;
                    console.log(`[Agent] 切換到備用 SiliconFlow API Key (index ${currentKeyIndex})`);
                    continue; // 重試這一步
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
        const finalCompletion = await activeClient.chat.completions.create({
            model,
            messages: [
                ...messages,
                { role: 'user', content: '請根據以上工具結果，給出最終的完整回答。' },
            ],
            temperature: 0.3,
            max_tokens: 2000,
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
