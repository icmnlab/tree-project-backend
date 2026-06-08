/**
 * Agent 資料庫／碳匯計算工具（唯讀 SQL、統計、試算）
 * 與 agentExternalRetrievalService、agentExportService 並用。
 */
const db = require('../config/db');
const format = require('pg-format');
const sqlQueryService = require('./sqlQueryService');
const carbonCalculationService = require('./carbonCalculationService');
const { chatCompletions } = require('./llmProviderService');
const { getUserProjects } = require('../middleware/projectAuth');

const AGENT_DATA_TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'query_tree_data',
            description:
                '以自然語言查詢樹木調查資料庫（tree_survey 等），回傳資料列與執行的 SQL。可查樹種、胸徑、碳儲存、專案區位等。',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '查詢需求，如「高雄港胸徑大於50的樹」',
                    },
                    project_area: {
                        type: 'string',
                        description: '可選，限定專案區位名稱',
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
            description:
                '依胸徑、樹高、樹種計算單株碳儲存量（TIPC／手冊方法學），回傳公式與 kg CO2e。',
            parameters: {
                type: 'object',
                properties: {
                    dbh_cm: { type: 'number', description: '胸徑（公分）' },
                    height_m: { type: 'number', description: '樹高（公尺）' },
                    species: { type: 'string', description: '樹種名稱（可選）' },
                },
                required: ['dbh_cm'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'species_carbon_info',
            description: '查詢樹種碳匯參數或調查資料中的樹種統計。',
            parameters: {
                type: 'object',
                properties: {
                    species_name: { type: 'string', description: '樹種名稱（中文）' },
                },
                required: ['species_name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'project_summary',
            description: '各專案區位樹木數量、樹種數、碳儲存總量等統計摘要。',
            parameters: {
                type: 'object',
                properties: {
                    project_area: { type: 'string', description: '可選，專案區位' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'carbon_credit_estimate',
            description:
                '依資料庫現有調查資料估算碳儲存與年吸碳量（噸 CO2e），非碳權市場價格。',
            parameters: {
                type: 'object',
                properties: {
                    project_area: { type: 'string', description: '專案區位' },
                    period_years: { type: 'number', description: '預估年數，預設 10' },
                },
                required: [],
            },
        },
    },
];

async function scopeSqlForUser(sql, userId, userRole) {
    if (userRole === '系統管理員' || userRole === '業務管理員') {
        return sql;
    }
    const codes = await getUserProjects(userId);
    if (!codes.length) {
        if (/\bWHERE\b/i.test(sql)) {
            return sql.replace(/\bWHERE\b/i, 'WHERE 1=0 AND');
        }
        return sql.replace(/FROM\s+(\w+)/i, 'FROM $1 WHERE 1=0');
    }
    const inList = codes.map((c) => format('%L', c)).join(', ');
    const clause = `project_code IN (${inList})`;
    if (/\bWHERE\b/i.test(sql)) {
        return sql.replace(/\bWHERE\b/i, `WHERE ${clause} AND`);
    }
    return sql.replace(/FROM\s+(\w+)/i, `FROM $1 WHERE ${clause}`);
}

async function scopeProjectCodesForRole(userId, userRole, project_area) {
    let codes = null;
    if (userRole !== '系統管理員' && userRole !== '業務管理員') {
        codes = await getUserProjects(userId);
        if (!codes.length) return { codes: [], extraWhere: ' AND 1=0', params: [] };
    }
    const params = [];
    let extraWhere = '';
    if (project_area) {
        const safe = project_area.replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s]/g, '');
        if (safe) {
            extraWhere += ` AND project_location ILIKE $${params.length + 1}`;
            params.push(`%${safe}%`);
        }
    }
    if (codes) {
        extraWhere += ` AND project_code = ANY($${params.length + 1}::text[])`;
        params.push(codes);
    }
    return { codes, extraWhere, params };
}

async function toolQueryTreeData({ query, project_area }, ctx) {
    try {
        const sqlPrompt = sqlQueryService.buildSQLGenerationPrompt(query, []);
        const { result: completion } = await chatCompletions({
            model: process.env.AGENT_SQL_MODEL || 'gpt-5.4-mini',
            messages: [{ role: 'user', content: sqlPrompt }],
            temperature: 0.1,
            max_tokens: 500,
            preferSiliconFlow: false,
        });

        let generatedSQL = (completion.choices[0].message.content || '').trim();
        generatedSQL = generatedSQL.replace(/^```sql?\s*/i, '').replace(/```\s*$/i, '').trim();

        if (generatedSQL === 'NOT_A_DATA_QUERY') {
            return { result: '此問題不適合查詢資料庫', query };
        }

        if (project_area) {
            const safeArea = project_area.replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s]/g, '');
            if (safeArea && !generatedSQL.toUpperCase().includes('PROJECT_LOCATION')) {
                if (generatedSQL.toUpperCase().includes('WHERE')) {
                    generatedSQL = generatedSQL.replace(
                        /WHERE/i,
                        `WHERE project_location ILIKE '%${safeArea}%' AND`
                    );
                } else {
                    generatedSQL = generatedSQL.replace(
                        /FROM\s+(\w+)/i,
                        `FROM $1 WHERE project_location ILIKE '%${safeArea}%'`
                    );
                }
            }
        }

        generatedSQL = await scopeSqlForUser(generatedSQL, ctx.userId, ctx.userRole);

        const queryResult = await sqlQueryService.executeSecureQuery(generatedSQL, {
            maxRetries: 1,
        });

        if (queryResult.success) {
            return {
                data: queryResult.rows,
                rowCount: queryResult.rowCount,
                sql: queryResult.executedSQL,
            };
        }
        return { error: queryResult.error };
    } catch (err) {
        return { error: err.message };
    }
}

async function toolCalculateCarbon({ dbh_cm, height_m, species }) {
    const detail = carbonCalculationService.calculateCarbonStorageDetail(
        species,
        dbh_cm,
        height_m
    );
    if (detail.error) return { error: detail.error };

    const carbonStorage_kgCO2e = detail.value;
    const carbonStorage_tonCO2e = Math.round((carbonStorage_kgCO2e / 1000) * 1000) / 1000;

    return {
        input: { dbh_cm, height_m, species: species || '未指定' },
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
        methodology: detail.methodology,
        note: '單株試算；年度吸碳請以資料庫 carbon_sequestration_per_year 或調查統計為準。',
    };
}

async function toolSpeciesCarbonInfo({ species_name }, ctx) {
    try {
        // 舊 tree_carbon_data 靜態表已移除；改以實際調查資料 (tree_survey) 統計回答。
        const { extraWhere, params } = await scopeProjectCodesForRole(
            ctx.userId,
            ctx.userRole,
            null
        );
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
            WHERE species_name ILIKE $1${extraWhere}
            GROUP BY species_name
            LIMIT 5`,
            [`%${species_name}%`, ...params]
        );

        if (stats.rows.length > 0) {
            return { species_stats: stats.rows };
        }
        return { message: `找不到樹種「${species_name}」相關資料` };
    } catch (err) {
        return { error: err.message };
    }
}

async function toolProjectSummary({ project_area }, ctx) {
    try {
        const { extraWhere, params } = await scopeProjectCodesForRole(
            ctx.userId,
            ctx.userRole,
            project_area
        );
        const baseWhere = `WHERE 1=1${extraWhere}`;

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
            ${baseWhere}
            GROUP BY project_location 
            ORDER BY tree_count DESC`,
            params
        );

        const totals = await db.query(
            `SELECT 
                COUNT(*) as total_trees,
                COUNT(DISTINCT species_name) as total_species,
                COUNT(DISTINCT project_location) as total_areas,
                ROUND(SUM(carbon_storage)::numeric, 1) as total_carbon_kg,
                ROUND(SUM(carbon_sequestration_per_year)::numeric, 1) as total_annual_seq_kg
            FROM tree_survey ${baseWhere}`,
            params
        );

        return {
            areas: summary.rows,
            totals: totals.rows[0],
            co2_equivalent_tons: totals.rows[0]
                ? Math.round(((parseFloat(totals.rows[0].total_carbon_kg) || 0) / 1000) * 100) / 100
                : 0,
        };
    } catch (err) {
        return { error: err.message };
    }
}

async function toolCarbonCreditEstimate({ project_area, period_years = 10 }, ctx) {
    try {
        const { extraWhere, params } = await scopeProjectCodesForRole(
            ctx.userId,
            ctx.userRole,
            project_area
        );

        const data = await db.query(
            `SELECT 
                COUNT(*) as tree_count,
                ROUND(SUM(carbon_storage)::numeric, 1) as total_carbon_kg,
                ROUND(SUM(carbon_sequestration_per_year)::numeric, 1) as annual_seq_kg,
                ROUND(AVG(dbh_cm)::numeric, 1) as avg_dbh
            FROM tree_survey WHERE 1=1${extraWhere}`,
            params
        );

        const stats = data.rows[0];
        if (!stats || parseInt(stats.tree_count, 10) === 0) {
            return { message: '找不到符合條件的樹木資料' };
        }

        const totalCO2_kg = parseFloat(stats.total_carbon_kg) || 0;
        const annualCO2_kg = parseFloat(stats.annual_seq_kg) || 0;
        const currentCO2_ton = totalCO2_kg / 1000;
        const annualCO2_ton = annualCO2_kg / 1000;

        return {
            project: project_area || '全部授權範圍',
            tree_count: parseInt(stats.tree_count, 10),
            avg_dbh_cm: parseFloat(stats.avg_dbh) || 0,
            period_years,
            methodology: 'TIPC AR-TMS0001／調查資料庫碳儲存與年吸碳欄位加總',
            current_stock: {
                co2_equivalent_ton: Math.round(currentCO2_ton * 100) / 100,
            },
            projected: {
                annual_co2_ton: Math.round(annualCO2_ton * 100) / 100,
                period_co2_ton: Math.round(annualCO2_ton * period_years * 100) / 100,
            },
            note: '此為盤查統計估算，非碳權市場交易價格；正式核證須依 VVB 方法學。',
        };
    } catch (err) {
        return { error: err.message };
    }
}

async function executeAgentDataTool(toolName, args, ctx) {
    switch (toolName) {
        case 'query_tree_data':
            return toolQueryTreeData(args, ctx);
        case 'calculate_carbon':
            return toolCalculateCarbon(args);
        case 'species_carbon_info':
            return toolSpeciesCarbonInfo(args, ctx);
        case 'project_summary':
            return toolProjectSummary(args, ctx);
        case 'carbon_credit_estimate':
            return toolCarbonCreditEstimate(args, ctx);
        default:
            return null;
    }
}

module.exports = {
    AGENT_DATA_TOOL_DEFINITIONS,
    executeAgentDataTool,
};
