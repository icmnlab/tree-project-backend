const rateLimit = require('express-rate-limit');
const { recordOffense } = require('../services/ipBlacklistService');

// 測試 / CI：設 DISABLE_RATE_LIMIT=true 時所有限流器直接放行
// （正式環境不設此變數，行為與原本完全一致）。
const rateLimitDisabled = () => process.env.DISABLE_RATE_LIMIT === 'true';

// 通用 API 速率限制: 允許使用者在短時間內進行多次普通操作
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 500, // 在 15 分鐘內最多允許 500 次請求
    message: {
        success: false,
        message: '您的請求過於頻繁，請稍後再試。'
    },
    standardHeaders: true, // 回傳速率限制資訊到 `RateLimit-*` headers
    legacyHeaders: false, // 禁用 'X-RateLimit-*' headers
    skip: rateLimitDisabled,
});

// 短時間爆量限制 (T8.2): 同一 IP 在 10 秒內 >= 20 次請求即視為攻擊
// 命中時：回 429 + 寫入 ip_blacklist (5 分鐘起跳，offense_count 累進升級)
const burstLimiter = rateLimit({
    windowMs: 10 * 1000, // 10 秒
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: rateLimitDisabled,
    message: {
        success: false,
        message: '短時間內請求過於頻繁，已暫時封鎖此 IP。'
    },
    handler: (req, res, _next, options) => {
        // 觸發 IP 黑名單升級（baseMinutes=5；offense_count 由 service 內部處理累進）
        recordOffense(req.ip, 5, 'BURST', req).catch((e) =>
            console.error('[burstLimiter] recordOffense failed:', e.message)
        );
        res.status(options.statusCode).json(options.message);
    },
});

// 登入嘗試限制 (per IP): 防止暴力破解
// 注意：這是單一 IP 的登入呼叫上限（含成功/失敗）；帳號層另有 5 次失敗鎖 30 分鐘的機制（loginAttemptMonitor.js）
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 小時
    max: 50, // 每小時單一 IP 最多 50 次登入嘗試（避免同 NAT/Wi-Fi 多帳號共用時誤殺）
    skip: rateLimitDisabled,
    message: {
        success: false,
        message: '此 IP 的登入嘗試次數過多，請稍後再試（1 小時後自動解除）。'
    }
});

// AI 相關路由的速率限制: 平衡使用與成本控制
const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 小時
    max: 30, // 每小時最多允許 30 次 AI 相關請求
    message: {
        success: false,
        message: 'AI 相關功能請求過於頻繁，請一小時後再試。'
    }
});

module.exports = {
    apiLimiter,
    burstLimiter,
    loginLimiter,
    aiLimiter
};
