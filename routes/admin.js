const express = require('express');
const router = express.Router();
const db = require('../config/db');
const rateLimit = require('express-rate-limit');
const reportController = require('../controllers/reportController');
const aiReportController = require('../controllers/aiReportController');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const apiKeys = require('../config/apiKeys');
const { requireRole } = require('../middleware/roleAuth');

// --- Admin Script Execution Endpoint ---
router.post('/run-script', requireRole('系統管理員'), async (req, res) => {
    const { scriptName } = req.body;

    if (!scriptName) {
        return res.status(400).json({ success: false, message: 'Script name is required' });
    }

    try {
        let resultMessage = '';
        
        // Execute script based on name
        switch (scriptName) {
            case 'populate_knowledge_from_survey':
                console.log('[Admin] Triggering populate_knowledge_from_survey...');
                // Assuming these scripts export a main function or we can run them effectively
                // Since we refactored them to export, we can call directly
                // BUT scripts might be async and logging to console. capturing output is harder this way.
                // For now, just await their completion.
                
                // Note: populate_knowledge_from_survey.js might not export a function in current version, 
                // let's check if we need to wrap it or use child_process.
                // Checking file content... it runs processTreeSurveyData() at the end.
                // We should modify it to export the function instead of auto-running if imported.
                // For safety, let's use child_process for scripts that might not be perfectly module-ready
                // OR better, we refactored populateSpeciesRegionScore to export. Let's assume we will refactor others too.
                // For now, using child_process fork is safest to isolate execution context.
                
                await runScriptInChildProcess('populate_knowledge_from_survey.js');
                resultMessage = 'Knowledge from survey population started/completed.';
                break;

            case 'populateSpeciesRegionScore':
                console.log('[Admin] Triggering populateSpeciesRegionScore...');
                await runScriptInChildProcess('populateSpeciesRegionScore.js');
                resultMessage = 'Species region score population started/completed.';
                break;

            case 'generateEmbeddings':
                console.log('[Admin] Triggering generateEmbeddings...');
                await runScriptInChildProcess('generateEmbeddings.js');
                resultMessage = 'Advanced embedding generation started/completed.';
                break;

            case 'generate_species_knowledge':
                console.log('[Admin] Triggering generate_species_knowledge...');
                // Note: This script uses Gemini API and might take a long time.
                // Running in background to prevent timeout.
                runScriptInChildProcess('generate_species_knowledge.js')
                    .then(() => console.log('[Admin] generate_species_knowledge completed.'))
                    .catch(err => console.error('[Admin] generate_species_knowledge failed:', err));
                resultMessage = 'Species knowledge generation started in background (this may take a while).';
                break;

            case 'enrich_species_synonyms':
                console.log('[Admin] Triggering enrich_species_synonyms...');
                // Background execution for LLM-heavy task
                runScriptInChildProcess('enrich_species_synonyms.js')
                    .then(() => console.log('[Admin] enrich_species_synonyms completed.'))
                    .catch(err => console.error('[Admin] enrich_species_synonyms failed:', err));
                resultMessage = 'Species synonym enrichment started in background (this may take a while).';
                break;

            default:
                return res.status(400).json({ success: false, message: 'Unknown script name' });
        }

        res.json({ success: true, message: resultMessage });

    } catch (error) {
        console.error(`[Admin] Error running script ${scriptName}:`, error);
        res.status(500).json({ success: false, message: `Error running script: ${error.message}` });
    }
});

// Helper to run script
function runScriptInChildProcess(scriptFileName) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', scriptFileName);
        const { fork } = require('child_process');
        
        const child = fork(scriptPath);

        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Script exited with code ${code}`));
        });

        child.on('error', (err) => reject(err));
    });
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


// [Stage 0.2] /chat 端點已移除 — 與 routes/ai.js 重複，且依賴已廢的 RAG 知識庫；前端不呼叫。

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


// --- 備份與還原 (使用 pg_dump 和 pg_restore) ---

// 備份資料庫
router.post('/backup', requireRole('系統管理員'), (req, res) => {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.sql`);

    // 從 DATABASE_URL 中解析資料庫連接信息
    const dbUrl = new URL(process.env.DATABASE_URL);
    const dbName = dbUrl.pathname.slice(1);
    const user = dbUrl.username;
    const password = dbUrl.password;
    const host = dbUrl.hostname;
    const port = dbUrl.port;

    // 構建 pg_dump 命令 — 使用 execFile 避免命令注入
    const args = ['-h', host, '-p', port, '-U', user, '-d', dbName, '-F', 'c', '-b', '-v', '-f', backupFile];

    execFile('pg_dump', args, { env: { ...process.env, PGPASSWORD: password } }, (error, stdout, stderr) => {
        if (error) {
            console.error('PostgreSQL 備份錯誤:', stderr);
            return res.status(500).json({
                success: false,
                message: '資料庫備份時發生錯誤',
                error: stderr
            });
        }
        res.json({
            success: true,
            message: '資料庫備份成功',
            backupFile: path.basename(backupFile)
        });
    });
});

// 還原資料庫
router.post('/restore', requireRole('系統管理員'), (req, res) => {
    const { backupFile } = req.body;
    
    // 防止路徑遍歷和命令注入
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!backupFile || typeof backupFile !== 'string') {
        return res.status(400).json({ success: false, message: '無效的備份檔案' });
    }
    
    // 只允許 backups 目錄下的檔案，防止路徑遍歷
    const resolvedPath = path.resolve(backupDir, path.basename(backupFile));
    if (!resolvedPath.startsWith(path.resolve(backupDir))) {
        return res.status(400).json({ success: false, message: '不允許的檔案路徑' });
    }
    if (!fs.existsSync(resolvedPath)) {
        return res.status(400).json({ success: false, message: '備份檔案不存在' });
    }
    
    const dbUrl = new URL(process.env.DATABASE_URL);
    const dbName = dbUrl.pathname.slice(1);
    const user = dbUrl.username;
    const password = dbUrl.password;
    const host = dbUrl.hostname;
    const port = dbUrl.port;

    // 構建 pg_restore 命令 — 使用 execFile 避免命令注入
    const args = ['-h', host, '-p', port, '-U', user, '-d', dbName, '--clean', '--if-exists', '-v', resolvedPath];

    execFile('pg_restore', args, { env: { ...process.env, PGPASSWORD: password } }, (error, stdout, stderr) => {
        if (error) {
            console.error('PostgreSQL 還原錯誤:', stderr);
            return res.status(500).json({
                success: false,
                message: '資料庫還原時發生錯誤',
                error: stderr
            });
        }
        res.json({
            success: true,
            message: '資料庫還原成功'
        });
    });
});


// --- API 密鑰管理 ---

router.post('/apikeys', requireRole('系統管理員'), (req, res) => {
    try {
        const { name, permissions } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'API Key 名稱不能為空' });
        }
        const key = apiKeys.generateApiKey(name, permissions || ['read']);
        res.json({ success: true, data: { name, key, permissions: permissions || ['read'] } });
    } catch (error) {
        console.error('創建 API 密鑰錯誤:', error);
        res.status(500).json({
            success: false,
            message: '創建 API 密鑰時發生錯誤',
            error: error.message
        });
    }
});

router.get('/apikeys', requireRole('系統管理員'), (req, res) => {
    try {
        const keys = apiKeys.listApiKeys();
        res.json({ success: true, data: keys });
    } catch (error) {
        console.error('獲取 API 密鑰列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '獲取 API 密鑰列表時發生錯誤',
            error: error.message
        });
    }
});

router.delete('/apikeys/:id', requireRole('系統管理員'), (req, res) => {
    const { id } = req.params;
    
    try {
        const deleted = apiKeys.deleteApiKey(id);
        if (deleted) {
            res.json({ success: true, message: 'API Key 已刪除' });
        } else {
            res.status(404).json({ success: false, message: 'API Key 未找到' });
        }
    } catch (error) {
        console.error('刪除 API 密鑰錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除 API 密鑰時發生錯誤',
            error: error.message
        });
    }
});

// GET /api/admin/audit-logs — 稽核日誌（業務管理員以上）
router.get('/audit-logs', requireRole('業務管理員'), async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const action = req.query.action ? String(req.query.action).trim() : null;

        let sql = `
            SELECT id, user_id, username, action, resource_type, resource_id,
                   details, ip_address, created_at
            FROM audit_logs
        `;
        const params = [];
        if (action) {
            sql += ' WHERE action = $1';
            params.push(action);
        }
        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const { rows } = await db.query(sql, params);
        res.json({ success: true, logs: rows, limit, offset });
    } catch (err) {
        console.error('查詢稽核日誌失敗:', err);
        res.status(500).json({ success: false, message: '查詢稽核日誌失敗' });
    }
});

module.exports = router;
