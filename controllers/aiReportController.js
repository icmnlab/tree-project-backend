const db = require('../config/db');
const OpenAI = require('openai');
const { chatCompletions, getOpenAIClient } = require('../services/llmProviderService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const format = require('pg-format');

// 使用 SiliconFlow API (免費) 替代 OpenAI
const SF_KEY = process.env.SiliconFlow_API_KEY || process.env.Alt1_SiliconFlow_API_KEY;
const siliconFlowClient = SF_KEY ? new OpenAI({
    apiKey: SF_KEY,
    baseURL: 'https://api.siliconflow.cn/v1',
}) : null;

// 報告使用的模型 (不需要 function calling，用更強的文字生成模型)
const REPORT_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507';

// Simple in-memory cache
const reportCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Helper to clean expired cache
const cleanCache = () => {
    const now = Date.now();
    for (const [key, value] of reportCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            reportCache.delete(key);
        }
    }
};
// Clean cache every 30 mins
setInterval(cleanCache, CACHE_DURATION);

// 生成 AI 永續報告
exports.generateAIReport = async (req, res) => {
    try {
        // Create a deterministic cache key from query parameters
        const sortedParams = Object.keys(req.query).sort().reduce((acc, key) => {
            acc[key] = req.query[key];
            return acc;
        }, {});
        const cacheKey = JSON.stringify(sortedParams);

        // Check cache
        if (reportCache.has(cacheKey)) {
            const cachedEntry = reportCache.get(cacheKey);
            if (Date.now() - cachedEntry.timestamp < CACHE_DURATION) {
                console.log('[AI Report] Serving from cache for key:', cacheKey);
                return res.json(cachedEntry.data);
            } else {
                reportCache.delete(cacheKey);
            }
        }

        // 獲取過濾條件（如果有）
        const filters = req.query;
        // [生命週期] AI 報告以「活立木」為基礎；淘汰木（枯死/倒塌/移除）不計入碳匯統計。
        let whereClauses = ["lifecycle_status = 'active'"];
        const params = [];
        let paramIndex = 1;

        // 構建 SQL 過濾條件
        if (filters.projectAreas) {
            const areasList = filters.projectAreas.split(',').map(area => area.trim()).filter(Boolean);
            if (areasList.length > 0) {
                whereClauses.push(format('project_location IN (%L)', areasList));
            }
        }

        if (filters.species) {
            const speciesList = filters.species.split(',').map(s => s.trim()).filter(Boolean);
            if (speciesList.length > 0) {
                whereClauses.push(format('species_name IN (%L)', speciesList));
            }
        }

        if (filters.minDbh) {
            whereClauses.push(`dbh_cm >= $${paramIndex++}`);
            params.push(parseFloat(filters.minDbh));
        }

        if (filters.maxDbh) {
            whereClauses.push(`dbh_cm <= $${paramIndex++}`);
            params.push(parseFloat(filters.maxDbh));
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 1. 基本統計數據
        const basicStatsSql = `
            SELECT 
                COUNT(*) as total_trees,
                COUNT(DISTINCT species_name) as species_count,
                AVG(tree_height_m) as avg_height,
                AVG(dbh_cm) as avg_dbh,
                SUM(carbon_storage) as total_carbon_storage,
                SUM(carbon_sequestration_per_year) as total_annual_carbon_sequestration
            FROM tree_survey
            ${whereClause}
        `;
        
        const { rows: basicStatsRows } = await db.query(basicStatsSql, params);
        const basicStats = basicStatsRows[0];

        // 組合基本統計數據
        const basicStatsKg = {
            total_trees: parseInt(basicStats.total_trees, 10) || 0,
            species_count: parseInt(basicStats.species_count, 10) || 0,
            avg_height: parseFloat(basicStats.avg_height) || 0,
            avg_dbh: parseFloat(basicStats.avg_dbh) || 0,
            total_carbon_storage: parseFloat(basicStats.total_carbon_storage) || 0,
            total_annual_carbon_sequestration: parseFloat(basicStats.total_annual_carbon_sequestration) || 0
        };

        // 2. 物種多樣性分析
        const speciesDiversitySql = `
            SELECT 
                species_name AS "樹種名稱",
                COUNT(*) as count,
                (COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM tree_survey ${whereClause}), 0)) as percentage
            FROM tree_survey
            ${whereClause ? whereClause + ' AND species_name IS NOT NULL' : ' WHERE species_name IS NOT NULL'}
            GROUP BY species_name
            ORDER BY count DESC
        `;
        const { rows: speciesDiversity } = await db.query(speciesDiversitySql, params);

        // 3. 健康狀況分析
        const healthStatusSql = `
            SELECT 
                status,
                COUNT(*) as count,
                (COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM tree_survey ${whereClause}), 0)) as percentage
            FROM tree_survey
            ${whereClause ? whereClause + ' AND status IS NOT NULL' : ' WHERE status IS NOT NULL'}
            GROUP BY status
        `;
        const { rows: healthStatus } = await db.query(healthStatusSql, params);
        
        // 4. 徑級分佈
        const dbhDistributionSql = `
            SELECT 
                CASE 
                    WHEN dbh_cm < 10 THEN '小於10公分'
                    WHEN dbh_cm BETWEEN 10 AND 20 THEN '10-20公分'
                    WHEN dbh_cm BETWEEN 20 AND 30 THEN '20-30公分'
                    WHEN dbh_cm BETWEEN 30 AND 40 THEN '30-40公分'
                    ELSE '大於40公分'
                END as dbh_range,
                COUNT(*) as count,
                (COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM tree_survey ${whereClause}), 0)) as percentage
            FROM tree_survey
            ${whereClause}
            GROUP BY dbh_range
            ORDER BY MIN(dbh_cm)
        `;
        const { rows: dbhDistribution } = await db.query(dbhDistributionSql, params);

        // 5. 專案區位分析
        const projectAreasSql = `
            SELECT 
                project_location,
                COUNT(*) as tree_count,
                SUM(carbon_storage) as total_carbon,
                SUM(carbon_sequestration_per_year) as annual_carbon
            FROM tree_survey
            ${whereClause ? whereClause + ' AND project_location IS NOT NULL' : ' WHERE project_location IS NOT NULL'}
            GROUP BY project_location
        `;
        const { rows: projectAreas } = await db.query(projectAreasSql, params);

        // 準備專案區位數據
        const projectAreasKg = projectAreas.map(area => ({
            name: area.project_location,
            tree_count: parseInt(area.tree_count, 10),
            total_carbon: parseFloat(area.total_carbon) || 0,
            annual_carbon: parseFloat(area.annual_carbon) || 0
        }));

        // 組合報告數據
        const reportData = {
            basicStats: basicStatsKg,
            speciesDiversity,
            healthStatus,
            dbhDistribution,
            projectAreas: projectAreasKg,
            filters: req.query,
            generatedAt: new Date().toISOString()
        };
        
        // Prepare data specifically for AI analysis
        const dataForAI = {
            basicStats: basicStatsKg,
            speciesDiversity,
            healthStatus,
            dbhDistribution,
            projectAreas: projectAreasKg,
            filters: req.query
        };

        // 生成 AI 分析報告
        const aiAnalysis = await generateAIAnalysis(dataForAI);

        const responseData = {
            success: true,
            data: {
                ...reportData, 
                aiAnalysis
            }
        };

        // Update cache
        reportCache.set(cacheKey, {
            timestamp: Date.now(),
            data: responseData
        });

        res.json(responseData);
        
    } catch (error) {
        console.error('Error generating AI sustainability report:', error);
        res.status(500).json({
            success: false,
            error: '生成 AI 永續報告時發生錯誤'
        });
    }
};

// 使用 OpenAI 生成 AI 分析
async function generateAIAnalysis(reportData) {
    try {
        // Destructure the data
        const { basicStats, speciesDiversity, healthStatus, dbhDistribution, projectAreas, filters } = reportData;

        // 格式化數據以供提示使用
        const formattedBasicStats = `
- 總樹木數量: ${basicStats.total_trees ?? 'N/A'} 棵
- 物種數量: ${basicStats.species_count ?? 'N/A'} 種
- 平均樹高: ${basicStats.avg_height ? basicStats.avg_height.toFixed(2) : 'N/A'} 公尺
- 平均胸徑: ${basicStats.avg_dbh ? basicStats.avg_dbh.toFixed(2) : 'N/A'} 公分
- 總碳儲存量: ${basicStats.total_carbon_storage ? basicStats.total_carbon_storage.toFixed(2) : 'N/A'} 公斤
- 年碳吸存量: ${basicStats.total_annual_carbon_sequestration ? basicStats.total_annual_carbon_sequestration.toFixed(2) : 'N/A'} 公斤/年`;

        const formattedSpecies = speciesDiversity && speciesDiversity.length > 0
            ? speciesDiversity.slice(0, 5).map(s => `- ${s['樹種名稱']}: ${s.count} 棵 (${s.percentage ? parseFloat(s.percentage).toFixed(1) : 'N/A'}%)`).join('\n')
            : '無物種多樣性數據';

        const formattedHealth = healthStatus && healthStatus.length > 0
            ? healthStatus.map(h => `- ${h.status}: ${h.count} 棵 (${h.percentage ? parseFloat(h.percentage).toFixed(1) : 'N/A'}%)`).join('\n')
            : '無健康狀況數據';

        const formattedDbh = dbhDistribution && dbhDistribution.length > 0
            ? dbhDistribution.map(d => `- ${d.dbh_range}: ${d.count} 棵 (${d.percentage ? parseFloat(d.percentage).toFixed(1) : 'N/A'}%)`).join('\n')
            : '無徑級分佈數據';

        // 準備 prompt - 優化結構和要求
        let prompt = `**任務：** 根據提供的樹木調查數據，生成一份專業的永續發展影響分析報告。

**扮演角色：** 你是一位資深的林業與永續發展顧問，專精於利用量化數據評估生態系統服務與環境影響。

**數據摘要：**
${formattedBasicStats}

**物種多樣性 (前5名)：**
${formattedSpecies}

**健康狀況分佈：**
${formattedHealth}

**徑級 (胸徑) 分佈：**
${formattedDbh}

**報告要求：**
請撰寫一份約 600-800 字的分析報告，包含以下部分：

1.  **總體概述：** 簡要總結本次調查的核心發現，強調樹木總量、碳匯貢獻和物種多樣性概況。請明確引用上述數據支持你的論點 (例如："本次調查共記錄了 ${basicStats.total_trees ?? 'N/A'} 棵樹木...")。
2.  **碳匯與氣候調節貢獻：**
    *   分析 ${basicStats.total_carbon_storage ? basicStats.total_carbon_storage.toFixed(2) : 'N/A'} 公斤的總碳儲存量和 ${basicStats.total_annual_carbon_sequestration ? basicStats.total_annual_carbon_sequestration.toFixed(2) : 'N/A'} 公斤/年的碳吸存量對減緩氣候變遷的意義。
    *   結合徑級分佈 (${formattedDbh})，討論不同大小樹木在碳匯中的角色。
3.  **生物多樣性與生態系統韌性：**
    *   基於 ${basicStats.species_count ?? 'N/A'} 種物種和主要樹種分佈 (${formattedSpecies})，評估當前的生物多樣性水平。
    *   討論物種多樣性對生態系統穩定性和韌性的重要性。
4.  **樹木健康與生長潛力：**
    *   分析樹木健康狀況 (${formattedHealth})，指出潛在風險或優勢。
    *   結合徑級分佈 (${formattedDbh})，評估樹群的年齡結構和未來生長潛力。
5.  **永續管理建議：**
    *   基於以上分析，提出 2-3 點具體、可行的管理建議，以提升碳匯效益、增強生物多樣性或改善樹木健康。建議應與數據分析結果緊密掛鉤。
6.  **未來展望：** 簡述持續監測和數據收集的重要性，以及這些數據如何支持長期的永續發展目標。

**寫作風格：** 請使用專業、客觀、數據驅動的語言。確保分析邏輯清晰，結論有數據支持。`;

        // 如果有過濾條件，添加相關提示
        if (filters && Object.keys(filters).length > 0 && !(Object.keys(filters).length === 1 && filters.hasOwnProperty(''))) { // 確保 filters 不是空的或只有一個空鍵
            let filterDescription = '此報告的數據分析基於以下篩選條件：';
            const filterParts = [];
            if (filters.projectAreas) {
                filterParts.push(`專案區位包含 "${filters.projectAreas.split(',').join('、')}"`);
            }
            if (filters.species) {
                filterParts.push(`樹種包含 "${filters.species.split(',').join('、')}"`);
            }
            if (filters.minDbh) {
                filterParts.push(`胸徑大於等於 ${filters.minDbh} 公分`);
            }
            if (filters.maxDbh) {
                filterParts.push(`胸徑小於等於 ${filters.maxDbh} 公分`);
            }
            filterDescription += filterParts.join('；');
            prompt += `

**重要提示：** ${filterDescription}。請在分析報告的開頭明確說明這一點，並在整個分析中考慮這些條件對結果的影響。`;
        } else {
            prompt += `

**注意：** 此報告分析涵蓋了資料庫中的所有樹木數據。`;
        }


        if (!siliconFlowClient && !getOpenAIClient()) {
            return '無法生成 AI 分析報告：SiliconFlow / OpenAI API Key 均未設定。';
        }
        console.log('[AI Report] Sending request to LLM API...');
        const { result: response, provider } = await chatCompletions({
            model: REPORT_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 2000,
        });
        console.log(`[AI Report] Received response from ${provider} API.`);

        // 檢查是否有有效的回應內容
        if (response.choices && response.choices.length > 0 && response.choices[0].message && response.choices[0].message.content) {
            // Qwen3 可能帶有 <think>...</think> 標籤，需要清除
            let content = response.choices[0].message.content.trim();
            content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            return content;
        } else {
            console.error('SiliconFlow API did not return valid content.');
            return "無法生成 AI 分析報告，因為 AI 模型未返回有效內容。";
        }
    } catch (error) {
        console.error('Error generating AI analysis:', error);
        if (error.response) {
            console.error('API Error Status:', error.response.status);
            console.error('API Error Data:', error.response.data);
        }
        return `無法生成 AI 分析報告。錯誤詳情：${error.message}`;
    }
} 

// 新增: 生成 AI 報告的 PDF 函數
async function generateAIReportPDF(reportDataWithAI) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 72, right: 72 }
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfData = Buffer.concat(buffers);
            resolve(pdfData);
        });
        doc.on('error', reject);

        // 設置中文字型
        // 路徑解析: 從 controllers 目錄往上一層 (backend) -> Noto_Sans_TC -> static -> NotoSansTC-Regular.ttf
        // 注意：VariableFont 在某些 PDFKit 版本可能支援度不佳，優先使用靜態 Regular 字體
        const fontPath = path.join(__dirname, '..', 'Noto_Sans_TC', 'static', 'NotoSansTC-Regular.ttf');
        const fallbackFontPath = path.join(__dirname, '..', 'Noto_Sans_TC', 'NotoSansTC-VariableFont_wght.ttf');

        try {
            if (fs.existsSync(fontPath)) {
                doc.font(fontPath);
                console.log('使用中文字型:', fontPath);
            } else if (fs.existsSync(fallbackFontPath)) {
                doc.font(fallbackFontPath);
                console.log('使用備用中文字型 (Variable):', fallbackFontPath);
            } else {
                console.error('中文字型檔案未找到! PDF 中文可能會變亂碼。搜尋路徑:', fontPath);
                // 嘗試列出 Noto_Sans_TC 目錄內容以供除錯
                const dirPath = path.join(__dirname, '..', 'Noto_Sans_TC');
                if (fs.existsSync(dirPath)) {
                    console.log('Noto_Sans_TC 目錄內容:', fs.readdirSync(dirPath));
                    const staticPath = path.join(dirPath, 'static');
                    if(fs.existsSync(staticPath)) {
                         console.log('Noto_Sans_TC/static 目錄內容:', fs.readdirSync(staticPath));
                    }
                }
            }
        } catch (fontError) {
            console.error('載入中文字型錯誤:', fontError);
        }

        const { basicStats, speciesDiversity, healthStatus, dbhDistribution, projectAreas, filters, generatedAt, aiAnalysis } = reportDataWithAI;

        // 報告標題
        doc.fontSize(20).text('AI 永續發展影響分析報告', { align: 'center' });
        doc.moveDown(2);

        // 報告生成時間與篩選條件
        doc.fontSize(10).text(`報告生成時間: ${new Date(generatedAt).toLocaleString()}`, { align: 'right' });
        if (filters && Object.keys(filters).length > 0 && !(Object.keys(filters).length === 1 && filters.hasOwnProperty(''))) {
            let filterDescription = '篩選條件: ';
            const filterParts = [];
            if (filters.projectAreas) {
                filterParts.push(`專案區位 "${filters.projectAreas.split(',').join('、')}"`);
            }
            if (filters.species) {
                filterParts.push(`樹種 "${filters.species.split(',').join('、')}"`);
            }
            if (filters.minDbh) {
                filterParts.push(`胸徑 >= ${filters.minDbh}公分`);
            }
            if (filters.maxDbh) {
                filterParts.push(`胸徑 <= ${filters.maxDbh}公分`);
            }
            filterDescription += filterParts.join('； ');
            doc.fontSize(10).text(filterDescription, { align: 'left' });
        } else {
            doc.fontSize(10).text('篩選條件: 所有樹木數據', { align: 'left'});
        }
        doc.moveDown();

        // AI 分析內容
        doc.fontSize(16).text('AI 分析與洞察', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text(aiAnalysis || 'AI 分析內容未能成功生成。');
        doc.moveDown(2);

        // 原始數據摘要 (可選，如果AI分析已包含足夠信息，此部分可簡化或移除)
        doc.addPage()
           .fontSize(16).text('數據摘要', { underline: true });
        doc.moveDown();

        doc.fontSize(14).text('1. 基本統計數據');
        doc.fontSize(11)
           .text(`總樹木數量: ${basicStats.total_trees ?? 'N/A'} 棵`)
           .text(`物種數量: ${basicStats.species_count ?? 'N/A'} 種`)
           .text(`平均樹高: ${basicStats.avg_height ? basicStats.avg_height.toFixed(2) : 'N/A'} 公尺`)
           .text(`平均胸徑: ${basicStats.avg_dbh ? basicStats.avg_dbh.toFixed(2) : 'N/A'} 公分`)
           .text(`總碳儲存量: ${basicStats.total_carbon_storage ? basicStats.total_carbon_storage.toFixed(2) : 'N/A'} 公斤`)
           .text(`年碳吸存量: ${basicStats.total_annual_carbon_sequestration ? basicStats.total_annual_carbon_sequestration.toFixed(2) : 'N/A'} 公斤/年`);
        doc.moveDown();

        doc.fontSize(14).text('2. 物種多樣性 (前5名)');
        if (speciesDiversity && speciesDiversity.length > 0) {
            speciesDiversity.slice(0, 5).forEach(s => {
                const percentage = s.percentage ? parseFloat(s.percentage) : 0;
                doc.fontSize(11).text(`- ${s['樹種名稱']}: ${s.count} 棵 (${percentage.toFixed(1)}%)`);
            });
        } else {
            doc.fontSize(11).text('無物種多樣性數據');
        }
        doc.moveDown();

        doc.fontSize(14).text('3. 健康狀況分佈');
        if (healthStatus && healthStatus.length > 0) {
            healthStatus.forEach(h => {
                const percentage = h.percentage ? parseFloat(h.percentage) : 0;
                doc.fontSize(11).text(`- ${h.status}: ${h.count} 棵 (${percentage.toFixed(1)}%)`);
            });
        } else {
            doc.fontSize(11).text('無健康狀況數據');
        }
        doc.moveDown();

        doc.fontSize(14).text('4. 徑級 (胸徑) 分佈');
        if (dbhDistribution && dbhDistribution.length > 0) {
            dbhDistribution.forEach(d => {
                const percentage = d.percentage ? parseFloat(d.percentage) : 0;
                doc.fontSize(11).text(`- ${d.dbh_range}: ${d.count} 棵 (${percentage.toFixed(1)}%)`);
            });
        } else {
            doc.fontSize(11).text('無徑級分佈數據');
        }
        doc.moveDown();
        
        if (projectAreas && projectAreas.length > 0) {
            doc.fontSize(14).text('5. 各專案區位統計');
             projectAreas.forEach(area => {
                doc.fontSize(11).text(`- ${area.name}: ${area.tree_count}棵樹, 總碳儲存 ${area.total_carbon ? area.total_carbon.toFixed(2) : 'N/A'}kg, 年碳吸存 ${area.annual_carbon ? area.annual_carbon.toFixed(2) : 'N/A'}kg/年`);
            });
        } else {
             doc.fontSize(11).text('無特定專案區位數據');
        }
        doc.moveDown();

        doc.end();
    });
}

// 導出新的 PDF 生成函數
exports.generateAIReportPDF = generateAIReportPDF; 