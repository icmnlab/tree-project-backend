const jwt = require('jsonwebtoken');

// JWT 使用的演算法 — 固定為 HS256 防止 algorithm confusion attack
const JWT_ALGORITHM = 'HS256';

/**
 * 從 Authorization header 中提取 Bearer token
 */
function getBearerToken(req) {
    const header = req.headers.authorization;
    if (!header) return null;

    const prefix = 'Bearer ';
    if (!header.startsWith(prefix)) return null;

    const token = header.slice(prefix.length).trim();
    return token || null;
}

/**
 * 判斷是否跳過驗證的路徑（公開端點，無需 JWT）
 */
const PUBLIC_PATHS = new Set([
    '/login',
    '/register',
    '/password-reset-request',
    '/password-reset',
]);

function shouldSkipAuth(req) {
    if (req.method === 'OPTIONS') return true;
    if (PUBLIC_PATHS.has(req.path)) return true;
    return false;
}

/**
 * JWT 認證中間件
 * - 強制要求有效的 JWT token
 * - 固定演算法為 HS256
 * - 驗證失敗回傳 401
 */
async function jwtAuth(req, res, next) {
    if (shouldSkipAuth(req)) return next();

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        console.error('[SECURITY] JWT_SECRET is not configured!');
        return res.status(500).json({
            success: false,
            message: '伺服器認證設定錯誤'
        });
    }

    const token = getBearerToken(req);
    if (!token) {
        return res.status(401).json({
            success: false,
            message: '未授權：缺少 JWT token'
        });
    }

    try {
        const decoded = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
        req.user = decoded;
        return next();
    } catch (err) {
        const message = err.name === 'TokenExpiredError'
            ? '未授權：Token 已過期，請重新登入'
            : '未授權：無效的 Token';
        return res.status(401).json({
            success: false,
            message
        });
    }
}

/**
 * 簽發 JWT token
 * - 固定演算法為 HS256
 * - 預設有效期由 JWT_EXPIRES_IN 環境變數控制（預設 24h）
 */
function signJwt(payload) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not configured');
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
    return jwt.sign(payload, secret, { algorithm: JWT_ALGORITHM, expiresIn });
}

module.exports = {
    jwtAuth,
    signJwt,
};
