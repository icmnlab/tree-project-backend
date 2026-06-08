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

// --- Admin Script Execution Endpoint（已淘汰）---
// 過去用於觸發 RAG / 知識庫 / LLM 同義詞擴充腳本，這些功能與相關資料表已移除。
// 保留端點僅為相容舊前端呼叫，一律回 410；無前端入口。
router.post('/run-script', requireRole('系統管理員'), async (req, res) => {
    const { scriptName } = req.body;
    if (!scriptName) {
        return res.status(400).json({ success: false, message: 'Script name is required' });
    }
    return res.status(410).json({
        success: false,
        message: '腳本執行功能已淘汰（RAG／知識庫／LLM 同義詞擴充已移除）。',
    });
});


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
