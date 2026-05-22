/**
 * 專案權限驗證中間件
 * 
 * [Phase B] 改為即時查詢 user_projects 表，不再依賴 JWT 中的 associated_projects 字串
 * 好處：改權限後立即生效，不需重新登入
 * 
 * 功能：
 * 1. 驗證使用者是否有權限存取/編輯特定專案的資料
 * 2. 系統管理員和業務管理員有全部專案的權限
 * 3. 其他角色即時從 user_projects 表查詢權限
 * 
 * 使用方式：
 *   router.put('/tree/:id', jwtAuth, projectAuth, updateTreeController);
 */

const db = require('../config/db');

// 記憶體快取（5 分鐘 TTL），避免每個請求都查 DB
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 從 user_projects 表查詢使用者的關聯專案（含快取）
 */
async function getUserProjects(userId) {
    const cacheKey = `up:${userId}`;
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return cached.projects;
    }

    try {
        const { rows } = await db.query(
            'SELECT project_code FROM user_projects WHERE user_id = $1',
            [userId]
        );
        const projects = rows.map(r => r.project_code);
        _cache.set(cacheKey, { projects, ts: Date.now() });
        return projects;
    } catch (err) {
        console.error('[ProjectAuth] user_projects 查詢失敗:', err.message);
        // 如果 user_projects 表不存在，嘗試 fallback 到 associated_projects
        try {
            const { rows } = await db.query(
                'SELECT associated_projects FROM users WHERE user_id = $1',
                [userId]
            );
            if (rows.length > 0 && rows[0].associated_projects) {
                return rows[0].associated_projects.split(',').map(p => p.trim()).filter(p => p);
            }
        } catch (fallbackErr) {
            console.error('[ProjectAuth] fallback 也失敗:', fallbackErr.message);
        }
        return [];
    }
}

/**
 * 清除特定使用者的快取（在更新權限後呼叫）
 */
function invalidateUserProjectsCache(userId) {
    _cache.delete(`up:${userId}`);
}

/**
 * 檢查使用者是否有專案權限
 */
async function hasProjectPermission(userId, projectCode, userRole) {
    if (userRole === '系統管理員' || userRole === '業務管理員') {
        return true;
    }
    if (!projectCode) {
        return true;
    }
    const projects = await getUserProjects(userId);
    return projects.includes(projectCode);
}

/**
 * 從請求中提取專案代碼
 */
function extractProjectCode(req) {
    if (req.body.project_code) return req.body.project_code;
    if (req.query.project_code) return req.query.project_code;
    if (req.params.project_code) return req.params.project_code;
    return null;
}

/**
 * 專案權限驗證中間件
 */
async function projectAuth(req, res, next) {
    try {
        if (!req.user || !req.user.user_id) {
            return res.status(401).json({
                success: false,
                message: '未授權：請先登入'
            });
        }
        
        const userId = req.user.user_id;
        const userRole = req.user.role;
        
        // 系統管理員和業務管理員直接放行
        if (userRole === '系統管理員' || userRole === '業務管理員') {
            return next();
        }
        
        let projectCode = extractProjectCode(req);
        
        // 編輯/刪除操作：從 DB 查詢資源的 project_code
        if (!projectCode && (req.method === 'PUT' || req.method === 'DELETE')) {
            const resourceId = req.params.id;
            if (resourceId) {
                try {
                    const result = await db.query(
                        'SELECT project_code FROM tree_survey WHERE id = $1',
                        [resourceId]
                    );
                    if (result.rows.length > 0) {
                        projectCode = result.rows[0].project_code;
                    }
                } catch (err) {
                    console.error('[ProjectAuth] Failed to query project_code:', err.message);
                }
            }
        }
        
        // [Phase B] 即時查 user_projects 表檢查權限
        if (projectCode) {
            const allowed = await hasProjectPermission(userId, projectCode, userRole);
            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    message: '權限不足：您沒有此專案的存取權限'
                });
            }
        }
        
        req.projectCode = projectCode;
        next();
    } catch (error) {
        console.error('[ProjectAuth] Error:', error);
        return res.status(500).json({
            success: false,
            message: '權限驗證失敗'
        });
    }
}

/**
 * 專案權限過濾中間件（查詢用）
 * [Phase B] 即時從 user_projects 查詢，不再讀 JWT
 */
async function projectAuthFilter(req, res, next) {
    if (!req.user || !req.user.user_id) {
        return next();
    }
    
    const userRole = req.user.role;
    
    // 系統管理員和業務管理員可以看全部
    if (userRole === '系統管理員' || userRole === '業務管理員') {
        req.projectFilter = null;
        return next();
    }
    
    // [Phase B] 從 user_projects 表即時查詢
    const projects = await getUserProjects(req.user.user_id);
    req.projectFilter = projects.length > 0 ? projects : [];
    
    next();
}

module.exports = {
    projectAuth,
    projectAuthFilter,
    hasProjectPermission,
    invalidateUserProjectsCache,
    getUserProjects,
};
