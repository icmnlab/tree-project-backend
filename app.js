require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { apiLimiter, burstLimiter, loginLimiter } = require('./middleware/rateLimiter');
const { jwtAuth } = require('./middleware/jwtAuth');
const { ipBlacklistGuard } = require('./middleware/ipBlacklistGuard');
const {
    cleanupUnusedProjectAreas,
    cleanupUnusedSpecies,
    cleanupOrphanedPlaceholders,
    cleanupOrphanProjects,
    cleanupOldChatLogs,
    cleanupOldLoginAttempts
} = require('./utils/cleanup');
const { scheduledSynonymMaintenance } = require('./services/speciesSynonymService');
const runPendingMigrations = require('./scripts/run_pending_migrations');

// 全域未捕獲錯誤處理
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught Exception:', err);
    // 給予時間寫入 log 後安全退出
    setTimeout(() => process.exit(1), 1000);
});

const app = express();

// [Standard Deployment] 生產環境僅跑增量 schema（不匯入 tree_survey_data.csv）
// 全新空庫請手動：node scripts/migrate.js
(async () => {
    try {
        if (process.env.NODE_ENV === 'production') {
            console.log('[Startup] Running pending migrations...');
            await runPendingMigrations();
            console.log('[Startup] Pending migrations completed.');
        }
    } catch (e) {
        console.error('[Startup] Migration failed:', e);
        process.exit(1);
    }
})();

// 設定信任反向代理（Nginx / Tailscale Funnel 等反向代理）
app.set('trust proxy', 1);

// 健康檢查端點 (Health Check)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- 中介軟體 (Middleware) ---

// CORS — 限制允許的來源（同時支援 CORS_ALLOWED_ORIGINS 和 CORS_ORIGIN）
const rawOrigins = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
const allowedOrigins = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    console.warn('[SECURITY] 生產環境未設定 CORS_ALLOWED_ORIGINS，CORS 將拒絕所有跨域請求');
}

app.use(cors({
    origin: (origin, callback) => {
        // 允許無 origin（mobile apps、server-to-server）
        if (!origin) return callback(null, true);
        // 開發模式且未設定允許來源時允許所有
        if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
}));
app.use(helmet());
app.use(express.json({
    limit: '10mb',
    // 保存 raw body 供 webhook 簽名驗證使用
    verify: (req, _res, buf) => {
        if (req.originalUrl && req.originalUrl.startsWith('/webhook')) {
            req.rawBody = buf;
        }
    },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- 路由 (Routes) ---
// 將所有 API 路由都放在 /api 前綴下
const apiRouter = express.Router();

// 掛載已完成的模組
const usersRoutes = require('./routes/users');
const projectsRoutes = require('./routes/projects');
const projectAreasRoutes = require('./routes/project_areas');
const treeSurveyRoutes = require('./routes/treeSurvey');
const treeSpeciesRoutes = require('./routes/treeSpecies');
const reportsRoutes = require('./routes/reports');
const statisticsRoutes = require('./routes/statistics');
const aiRoutes = require('./routes/ai');
const adminRoutes = require('./routes/admin');
const locationRoutes = require('./routes/location');
const managementRoutes = require('./routes/management');
const speciesIdentificationRoutes = require('./routes/speciesIdentification'); // 樹種辨識路由
const pendingMeasurementsRoutes = require('./routes/pending_measurements'); // 待測量樹木路由
const projectBoundariesRoutes = require('./routes/project_boundaries'); // V3 專案邊界路由
const mlTrainingDataRoutes = require('./routes/ml_training_data'); // V3 ML 訓練數據收集路由
const treeImagesRoutes = require('./routes/tree_images'); // 樹木影像路由
const mlServiceRoutes = require('./routes/ml_service'); // ML Service 代理路由
const csvImportRoutes = require('./routes/csvImport'); // [Phase C] CSV 匯入路由
const agentRoutes = require('./routes/agent'); // AI Agent 路由
const ipBlacklistRoutes = require('./routes/ipBlacklist'); // [T8.2] IP 黑名單管理
const researchDatasetRoutes = require('./routes/research_dataset'); // [Research] DBH 校準資料蒐集

apiRouter.use('/', usersRoutes); // 包含 /login
apiRouter.use('/projects', projectsRoutes);
apiRouter.use('/project_areas', projectAreasRoutes);
apiRouter.use('/tree_survey', treeSurveyRoutes);
apiRouter.use('/tree_species', treeSpeciesRoutes);
apiRouter.use('/', reportsRoutes); // 包含 /export
apiRouter.use('/tree_statistics', statisticsRoutes);
apiRouter.use('/', aiRoutes); // 包含 /chat, /reports/ai-sustainability 等
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/location', locationRoutes);
apiRouter.use('/tree-management', managementRoutes);
apiRouter.use('/species', speciesIdentificationRoutes); // 掛載樹種辨識路由
apiRouter.use('/pending-measurements', pendingMeasurementsRoutes); // 掛載待測量樹木路由
apiRouter.use('/project-boundaries', projectBoundariesRoutes); // 掛載專案邊界路由
apiRouter.use('/ml-training', mlTrainingDataRoutes); // 掛載 ML 訓練數據路由
apiRouter.use('/tree-images', treeImagesRoutes); // 掛載樹木影像路由
apiRouter.use('/ml-service', mlServiceRoutes); // 掛載 ML Service 代理路由
apiRouter.use('/admin/import-csv', csvImportRoutes); // [Phase C] 掛載 CSV 匯入路由
apiRouter.use('/admin/ip-blacklist', ipBlacklistRoutes); // [T8.2] 掛載 IP 黑名單管理
apiRouter.use('/admin/research-dataset', researchDatasetRoutes); // [Research] DBH 校準資料蒐集
apiRouter.use('/agent', agentRoutes); // 掛載 AI Agent 路由


// --- GitHub Webhook (不需 JWT) ---
const webhookRoutes = require('./routes/webhook');
app.use('/webhook', webhookRoutes);

// 將所有 API 路由應用速率限制並掛載到 /api
// 順序：ipBlacklistGuard（IP 黑名單）→ burstLimiter（10秒爆量）→ apiLimiter（一般 rate limit）→ jwtAuth → 路由
app.use('/api', ipBlacklistGuard, burstLimiter, apiLimiter, jwtAuth, apiRouter);


// --- 靜態檔案服務 (可選) ---
// 如果前端 build 檔案會放在後端目錄下，可以取消註解
// app.use(express.static(path.join(__dirname, 'public')));


// --- 全域錯誤處理 ---
app.use((err, req, res, next) => {
    // 僅在 log 中記錄完整錯誤，不回傳給客戶端
    console.error('未處理的錯誤:', err.stack);
    
    const statusCode = err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production'
        ? '伺服器發生未預期的錯誤'
        : err.message || '伺服器發生未預期的錯誤';
    
    res.status(statusCode).json({ success: false, message });
});

// --- 啟動伺服器 ---
const PORT = process.env.PORT || 3000;

// 必要環境變數檢查
if (process.env.NODE_ENV === 'production') {
    const required = ['DATABASE_URL', 'JWT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error(`[FATAL] 缺少必要環境變數: ${missing.join(', ')}`);
        process.exit(1);
    }
}

app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
    console.log('環境變數 DB_HOST:', process.env.DB_HOST ? '已設置' : '未設置');
    console.log('環境變數 DATABASE_URL:', process.env.DATABASE_URL ? '已設置' : '未設置');

    // 設定每小時執行一次的定期清理任務
    const cleanupInterval = 60 * 60 * 1000; // 1小時
    setInterval(async () => {
        console.log('[Scheduler] Running hourly cleanup tasks...');
        try { await cleanupOrphanedPlaceholders(); } catch (e) { console.error('[Scheduler] cleanupOrphanedPlaceholders error:', e.message); }
        try { await cleanupUnusedSpecies(); } catch (e) { console.error('[Scheduler] cleanupUnusedSpecies error:', e.message); }
        try { await cleanupUnusedProjectAreas(); } catch (e) { console.error('[Scheduler] cleanupUnusedProjectAreas error:', e.message); }
        try { await cleanupOrphanProjects(); } catch (e) { console.error('[Scheduler] cleanupOrphanProjects error:', e.message); }
        try { await cleanupOldChatLogs(); } catch (e) { console.error('[Scheduler] cleanupOldChatLogs error:', e.message); }
        try { await cleanupOldLoginAttempts(); } catch (e) { console.error('[Scheduler] cleanupOldLoginAttempts error:', e.message); }
        try { await scheduledSynonymMaintenance(); } catch (e) { console.error('[Scheduler] scheduledSynonymMaintenance error:', e.message); }
        console.log('[Scheduler] Hourly cleanup tasks finished.');
    }, cleanupInterval);

    // 啟動時也執行一次清理（特別是聊天記錄）
    setTimeout(async () => {
        console.log('[Startup] Running initial chat logs cleanup...');
        await cleanupOldChatLogs();
        console.log('[Startup] Initial cleanup finished.');
    }, 5000); // 延遲 5 秒執行，讓伺服器先穩定
});
