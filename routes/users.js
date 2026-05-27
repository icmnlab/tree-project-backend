const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { loginLimiter } = require('../middleware/rateLimiter');
const { signJwt } = require('../middleware/jwtAuth');
const AuditLogService = require('../services/auditLogService');
const { checkAccountLocked, recordLoginFailure, resetLoginAttempts } = require('../middleware/loginAttemptMonitor');
const { requireRole, getRoleLevel } = require('../middleware/roleAuth');
const { invalidateUserProjectsCache } = require('../middleware/projectAuth');

// 使用者管理相關 API
// 登入路由
router.post('/login', loginLimiter, async (req, res) => {
    const { account, password, loginType } = req.body;

    if (!account || !password) {
        return res.status(400).json({
            success: false,
            message: '請提供帳號和密碼'
        });
    }

    try {
        // Phase 4.4: 檢查帳號是否被鎖定
        const lockStatus = await checkAccountLocked(account);
        if (lockStatus.locked) {
            return res.status(403).json({
                success: false,
                message: lockStatus.message
            });
        }
        
        let roleCheck = '';
        let queryParams = [account];
        
        if (loginType === 'admin') {
            // 只允許特定角色登入管理後台
            // 注意：role 欄位是 user_role enum 類型，需要轉換為 text 進行比較
            const allowedAdminRoles = ['系統管理員', '業務管理員', '專案管理員', '調查管理員'];
            roleCheck = ` AND role::text = ANY($2::text[])`;
            queryParams.push(allowedAdminRoles);
        }

        const query = `SELECT user_id, username, password_hash, display_name, role, associated_projects, is_active FROM users WHERE username = $1 ${roleCheck}`;
        
        const { rows } = await db.query(query, queryParams);

        if (rows.length === 0) {
            await recordLoginFailure(account, req);
            await AuditLogService.log({
                action: 'LOGIN_FAILED',
                username: account,
                details: { reason: 'User not found or role mismatch', loginType },
                req
            });
            return res.status(404).json({
                success: false,
                message: loginType === 'admin' ? '無管理員權限或帳號不存在' : '帳號不存在'
            });
        }

        const user = rows[0];

        if (!user.is_active) {
            await AuditLogService.log({
                userId: user.user_id,
                username: user.username,
                action: 'LOGIN_FAILED',
                details: { reason: 'Account disabled', loginType },
                req
            });
            return res.status(403).json({
                success: false,
                message: '您的帳號已被禁用，請聯繫管理員'
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            const { attempts, locked } = await recordLoginFailure(account, req);
            await AuditLogService.log({
                userId: user.user_id,
                username: user.username,
                action: 'LOGIN_FAILED',
                details: { reason: 'Invalid password', loginType, attempts, locked },
                req
            });
            
            const message = locked 
                ? '密碼錯誤次數過多，帳號已被鎖定'
                : `密碼錯誤 (剩餘嘗試次數: ${5 - attempts})`;
            
            return res.status(401).json({
                success: false,
                message: message
            });
        }
        
        // 登入成功，重置登入失敗計數
        await resetLoginAttempts(account);
        
        await AuditLogService.log({
            userId: user.user_id,
            username: user.username,
            action: 'LOGIN',
            details: { loginType, role: user.role },
            req
        });

        // [Phase A] 優先從 projects 表查詢可存取專案，保留 fallback
        let accessibleProjects = [];
        try {
            if (user.role === '系統管理員' || user.role === '業務管理員') {
                const { rows: projectRows } = await db.query(`
                    SELECT p.project_code AS code, p.name, COALESCE(pa.area_name, '') AS area
                    FROM projects p
                    LEFT JOIN project_areas pa ON pa.id = p.area_id
                    WHERE p.is_active = true
                    ORDER BY p.project_code
                `);
                accessibleProjects = projectRows;
            } else {
                // 優先從 user_projects junction table 查詢
                const { rows: projectRows } = await db.query(`
                    SELECT p.project_code AS code, p.name, COALESCE(pa.area_name, '') AS area
                    FROM user_projects up
                    JOIN projects p ON p.project_code = up.project_code
                    LEFT JOIN project_areas pa ON pa.id = p.area_id
                    WHERE up.user_id = $1 AND p.is_active = true
                    ORDER BY p.project_code
                `, [user.user_id]);
                accessibleProjects = projectRows;
            }
        } catch (newQueryErr) {
            console.warn('[Phase A fallback] 新表查詢失敗，退回 tree_survey:', newQueryErr.message);
            accessibleProjects = [];
        }

        // Fallback: 如果新表查無結果，退回 SELECT DISTINCT FROM tree_survey
        if (accessibleProjects.length === 0) {
            if (user.role === '系統管理員' || user.role === '業務管理員') {
                const { rows: projectRows } = await db.query('SELECT DISTINCT project_code as code, project_name as name, project_location as area FROM tree_survey');
                accessibleProjects = projectRows;
            } else {
                const projectCodes = user.associated_projects ? user.associated_projects.split(',') : [];
                if (projectCodes.length > 0) {
                    const projectQuery = 'SELECT DISTINCT project_code as code, project_name as name, project_location as area FROM tree_survey WHERE project_code = ANY($1::text[])';
                    const { rows: projectRows } = await db.query(projectQuery, [projectCodes]);
                    accessibleProjects = projectRows;
                }
            }
        }

        let token;
        if (process.env.JWT_SECRET) {
            try {
                // [Phase B] JWT payload 不再包含 associated_projects
                // 改為即時查 user_projects 表，改權限後立即生效不需重新登入
                token = signJwt({
                    user_id: user.user_id,
                    username: user.username,
                    role: user.role,
                });
            } catch (e) {
                token = undefined;
            }
        }

        // ML Service 設定（所有已登入使用者都可取得，確保 App 無需手動設定）。
        // 優先用手機可連到的公開/Tailscale URL；API key 僅保留在後端內部使用。
        const mlConfig = {};
        const mlPublicUrl = process.env.ML_SERVICE_PUBLIC_URL || process.env.ML_SERVICE_URL;
        if (mlPublicUrl) {
            mlConfig.url = mlPublicUrl;
        }

        res.status(200).json({
            success: true,
            message: '登錄成功',
            token,
            user: {
                user_id: user.user_id,
                username: user.username,
                display_name: user.display_name,
                role: user.role,
                associated_projects: user.associated_projects, // [舊] 保留向後相容
                projects: accessibleProjects, // [Phase A 新增] 結構化專案陣列
                accessibleProjects: accessibleProjects // 保留此欄位向後相容
            },
            mlConfig: Object.keys(mlConfig).length > 0 ? mlConfig : undefined,
        });

    } catch (error) {
        console.error('登入處理錯誤:', error);
        return res.status(500).json({
            success: false,
            message: '登入處理時發生錯誤'
        });
    }
});


// 取得使用者列表 (業務管理員以上)
router.get('/users', requireRole('業務管理員'), async (req, res) => {
    try {
        // [FIX] 明確轉換 is_active 為布林值 (true/false)，避免前端混淆
        const { rows } = await db.query('SELECT user_id, username, display_name, role, is_active FROM users ORDER BY user_id ASC');
        
        // 確保 is_active 輸出為 boolean
        const users = rows.map(user => ({
            ...user,
            is_active: !!user.is_active // 強制轉為 bool，PostgreSQL BOOLEAN 類型驅動可能已處理，但雙重保險
        }));

        res.json({
            success: true,
            users: users
        });
    } catch (err) {
        console.error('取得使用者列表錯誤:', err);
        return res.status(500).json({
            success: false,
            message: '取得使用者列表時發生錯誤'
        });
    }
});

/**
 * 密碼強度驗證
 * 要求：至少 8 字元，包含大小寫字母和數字
 */
function validatePasswordStrength(password) {
    if (!password || password.length < 8) {
        return '密碼長度至少 8 個字元';
    }
    if (!/[A-Z]/.test(password)) {
        return '密碼需包含至少一個大寫字母';
    }
    if (!/[a-z]/.test(password)) {
        return '密碼需包含至少一個小寫字母';
    }
    if (!/[0-9]/.test(password)) {
        return '密碼需包含至少一個數字';
    }
    return null;
}

// 新增使用者 (業務管理員以上)
router.post('/users', requireRole('業務管理員'), async (req, res) => {
    const { username, password, display_name, role } = req.body;
    const isActive = req.body.is_active === undefined ? true : (req.body.is_active ? true : false);

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: '請提供使用者名稱和密碼'
        });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
        return res.status(400).json({
            success: false,
            message: passwordError
        });
    }

    // 角色階層檢查：不能建立比自己角色更高的使用者
    const targetRole = role || '一般使用者';
    if (getRoleLevel(targetRole) >= getRoleLevel(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: '權限不足：不能建立與自己同等或更高權限的使用者'
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING user_id';
        
        const { rows } = await db.query(sql, [username, hashedPassword, display_name || username, role || '一般使用者', isActive]);
        
        await AuditLogService.log({
            userId: req.user?.user_id, // Acting user
            username: req.user?.username,
            action: 'CREATE_USER',
            resourceType: 'users',
            resourceId: rows[0].user_id,
            details: { createdUsername: username, role },
            req
        });

        res.status(201).json({
            success: true,
            message: '使用者新增成功',
            userId: rows[0].user_id
        });
    } catch (error) {
        console.error('新增使用者錯誤:', error);
        if (error.code === '23505') { // PostgreSQL unique violation
            return res.status(409).json({ success: false, message: '使用者名稱已存在' });
        }
        res.status(500).json({
            success: false,
            message: '新增使用者時發生錯誤'
        });
    }
});

// 修改使用者 (業務管理員以上)
router.put('/users/:id', requireRole('業務管理員'), async (req, res) => {
    const { id } = req.params;
    const { display_name, role, password, is_active } = req.body;

    try {
        // 查詢目標使用者的角色，確保不能修改同等或更高權限的使用者
        const { rows: targetUser } = await db.query('SELECT role FROM users WHERE user_id = $1', [id]);
        if (targetUser.length === 0) {
            return res.status(404).json({ success: false, message: '找不到指定的使用者' });
        }
        if (getRoleLevel(targetUser[0].role) >= getRoleLevel(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: '權限不足：不能修改與自己同等或更高權限的使用者'
            });
        }
        // 如果要修改角色，新角色也不能 >= 操作者
        if (role !== undefined && getRoleLevel(role) >= getRoleLevel(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: '權限不足：不能將使用者提升至與自己同等或更高的角色'
            });
        }
        const fieldsToUpdate = [];
        const values = [];
        let queryIndex = 1;

        if (display_name !== undefined) {
            fieldsToUpdate.push(`display_name = $${queryIndex++}`);
            values.push(display_name);
        }
        if (role !== undefined) {
            fieldsToUpdate.push(`role = $${queryIndex++}`);
            values.push(role);
        }
        if (is_active !== undefined) {
            fieldsToUpdate.push(`is_active = $${queryIndex++}`);
            values.push(is_active);
        }
        if (password) {
            const pwdError = validatePasswordStrength(password);
            if (pwdError) {
                return res.status(400).json({ success: false, message: pwdError });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            fieldsToUpdate.push(`password_hash = $${queryIndex++}`);
            values.push(hashedPassword);
        }

        if (fieldsToUpdate.length === 0) {
            return res.status(400).json({
                success: false,
                message: '沒有提供任何要更新的欄位'
            });
        }

        const sql = `UPDATE users SET ${fieldsToUpdate.join(', ')} WHERE user_id = $${queryIndex}`;
        values.push(id);

        const { rowCount } = await db.query(sql, values);

        if (rowCount > 0) {
            await AuditLogService.log({
                userId: req.user?.user_id,
                username: req.user?.username,
                action: 'UPDATE_USER',
                resourceType: 'users',
                resourceId: id,
                details: { updatedFields: Object.keys(req.body).filter(k => k !== 'password') },
                req
            });

            res.json({
                success: true,
                message: '使用者修改成功'
            });
        } else {
            res.status(404).json({ success: false, message: '找不到指定的使用者' });
        }
    } catch (error) {
        console.error('修改使用者錯誤:', error);
        res.status(500).json({
            success: false,
            message: '修改使用者時發生錯誤'
        });
    }
});

// 切換使用者啟用狀態 (業務管理員以上)
router.put('/users/:id/status', requireRole('業務管理員'), async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
        return res.status(400).json({
            success: false,
            message: '請求參數 isActive 必須是布林值'
        });
    }

    try {
        const { rowCount } = await db.query('UPDATE users SET is_active = $1 WHERE user_id = $2', [isActive, id]);
        
        if (rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: '找不到指定的使用者'
            });
        }

        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'UPDATE_USER_STATUS',
            resourceType: 'users',
            resourceId: id,
            details: { isActive },
            req
        });

        res.json({
            success: true,
            message: `使用者狀態已更新`
        });
    } catch (err) {
        console.error(`切換使用者 ${id} 狀態錯誤:`, err);
        return res.status(500).json({
            success: false,
            message: '更新使用者狀態時發生資料庫錯誤'
        });
    }
});

// 刪除使用者 (業務管理員以上)
router.delete('/users/:id', requireRole('業務管理員'), async (req, res) => {
    const { id } = req.params;

    try {
        // 檢查目標使用者角色，不能刪除同等或更高權限的使用者
        const { rows: targetUser } = await db.query('SELECT role FROM users WHERE user_id = $1', [id]);
        if (targetUser.length > 0 && getRoleLevel(targetUser[0].role) >= getRoleLevel(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: '權限不足：不能刪除與自己同等或更高權限的使用者'
            });
        }
        const { rowCount } = await db.query('DELETE FROM users WHERE user_id = $1', [id]);
        if (rowCount > 0) {
            await AuditLogService.log({
                userId: req.user?.user_id,
                username: req.user?.username,
                action: 'DELETE_USER',
                resourceType: 'users',
                resourceId: id,
                req
            });

            res.json({
                success: true,
                message: '使用者刪除成功'
            });
        } else {
            res.status(404).json({ success: false, message: '找不到指定的使用者' });
        }
    } catch (err) {
        console.error('刪除使用者錯誤:', err);
        return res.status(500).json({
            success: false,
            message: '刪除使用者時發生錯誤'
        });
    }
});

// 獲取使用者關聯專案 (業務管理員以上)
// [Phase A] 優先從 user_projects + projects 查詢，fallback 到 associated_projects
router.get('/users/:userId/projects', requireRole('業務管理員'), async (req, res) => {
    const { userId } = req.params;

    try {
        // 檢查使用者是否存在
        const { rows: userRows } = await db.query('SELECT user_id, associated_projects FROM users WHERE user_id = $1', [userId]);
        if (userRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '找不到指定的使用者'
            });
        }

        let projectRows = [];

        // [Phase A] 優先從 user_projects junction table 查詢
        try {
            const result = await db.query(`
                SELECT p.project_code AS "專案代碼", p.name AS "專案名稱", COALESCE(pa.area_name, '') AS "專案區位"
                FROM user_projects up
                JOIN projects p ON p.project_code = up.project_code
                LEFT JOIN project_areas pa ON pa.id = p.area_id
                WHERE up.user_id = $1
                ORDER BY p.project_code
            `, [userId]);
            projectRows = result.rows;
        } catch (newQueryErr) {
            console.warn('[Phase A fallback] user_projects 查詢失敗:', newQueryErr.message);
        }

        // Fallback: 從 associated_projects 逗號分隔字串查詢
        if (projectRows.length === 0) {
            const associatedProjects = userRows[0].associated_projects;
            const projectList = associatedProjects ? associatedProjects.split(',').map(p => p.trim()).filter(p => p) : [];

            if (projectList.length > 0) {
                const projectQuery = 'SELECT DISTINCT project_code, project_name, project_location FROM tree_survey WHERE project_code = ANY($1::text[])';
                const { rows: fallbackRows } = await db.query(projectQuery, [projectList]);
                projectRows = fallbackRows.map(p => ({
                    "專案代碼": p.project_code,
                    "專案名稱": p.project_name,
                    "專案區位": p.project_location
                }));
            }
        }

        res.json({
            success: true,
            projects: projectRows
        });
    } catch (err) {
        console.error('獲取關聯專案錯誤:', err);
        return res.status(500).json({
            success: false,
            message: '獲取關聯專案時發生錯誤'
        });
    }
});

// 更新使用者關聯專案 (業務管理員以上)
router.put('/users/:userId/projects', requireRole('業務管理員'), async (req, res) => {
    const { userId } = req.params;
    const { projects } = req.body; // 專案代碼陣列

    if (!Array.isArray(projects)) {
        return res.status(400).json({
            success: false,
            message: '專案清單格式錯誤'
        });
    }

    try {
        // [舊] 寫入 associated_projects 逗號分隔字串
        const projectsString = projects.join(',');
        const { rowCount } = await db.query('UPDATE users SET associated_projects = $1 WHERE user_id = $2', [projectsString, userId]);

        if (rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: '找不到指定的使用者'
            });
        }

        // [Phase A 雙寫] 同步寫入 user_projects junction table
        try {
            await db.query('DELETE FROM user_projects WHERE user_id = $1', [userId]);
            if (projects.length > 0) {
                const values = projects.map((code, i) => `($1, $${i + 2})`).join(', ');
                await db.query(
                    `INSERT INTO user_projects (user_id, project_code) VALUES ${values} ON CONFLICT DO NOTHING`,
                    [userId, ...projects]
                );
            }
            // [Phase B] 清除快取，使新權限立即生效
            invalidateUserProjectsCache(userId);
        } catch (dualWriteErr) {
            console.error('[Phase A 雙寫] user_projects 同步失敗 (非致命):', dualWriteErr.message);
        }

        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'UPDATE_USER_PROJECTS',
            resourceType: 'users',
            resourceId: userId,
            details: { projects },
            req
        });

        res.json({
            success: true,
            message: '關聯專案更新成功'
        });
    } catch (err) {
        console.error('更新關聯專案錯誤:', err);
        return res.status(500).json({
            success: false,
            message: '更新關聯專案時發生錯誤'
        });
    }
});

// --- 邀請碼註冊 ---

let invitesTableReady = false;
async function ensureInvitesTable() {
    if (invitesTableReady) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS registration_invites (
            invite_id SERIAL PRIMARY KEY,
            code VARCHAR(32) UNIQUE NOT NULL,
            role VARCHAR(50) DEFAULT '一般使用者',
            max_uses INT DEFAULT 1,
            use_count INT DEFAULT 0,
            expires_at TIMESTAMP,
            created_by INT REFERENCES users(user_id),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_registration_invites_code
            ON registration_invites(code);
    `);
    invitesTableReady = true;
}

// 建立邀請碼（業務管理員以上）
router.post('/invites', requireRole('業務管理員'), async (req, res) => {
    const { role, max_uses, expires_in_days } = req.body;
    const targetRole = role || '一般使用者';
    if (getRoleLevel(targetRole) >= getRoleLevel(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: '不能建立同等或更高權限的邀請碼',
        });
    }
    const maxUses = Math.min(Math.max(parseInt(max_uses, 10) || 1, 1), 100);
    const days = Math.min(Math.max(parseInt(expires_in_days, 10) || 7, 1), 90);
    const code = `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    try {
        await ensureInvitesTable();
        const { rows } = await db.query(
            `INSERT INTO registration_invites (code, role, max_uses, expires_at, created_by)
             VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval, $5)
             RETURNING invite_id, code, role, max_uses, expires_at`,
            [code, targetRole, maxUses, String(days), req.user.user_id]
        );
        res.status(201).json({ success: true, invite: rows[0] });
    } catch (err) {
        console.error('建立邀請碼失敗:', err);
        res.status(500).json({ success: false, message: '建立邀請碼失敗' });
    }
});

// 公開註冊（需有效邀請碼）
router.post('/register', loginLimiter, async (req, res) => {
    const { invite_code, username, password, display_name } = req.body;
    if (!invite_code || !username || !password) {
        return res.status(400).json({
            success: false,
            message: '請提供邀請碼、帳號與密碼',
        });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
        return res.status(400).json({ success: false, message: passwordError });
    }

    const client = await db.pool.connect();
    try {
        await ensureInvitesTable();
        await client.query('BEGIN');

        const normalizedCode = String(invite_code).trim().toUpperCase();
        const { rows: invRows } = await client.query(
            `SELECT * FROM registration_invites
             WHERE UPPER(code) = $1 AND is_active = true FOR UPDATE`,
            [normalizedCode]
        );
        if (invRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: '邀請碼無效' });
        }
        const inv = invRows[0];
        if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: '邀請碼已過期' });
        }
        if (inv.use_count >= inv.max_uses) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: '邀請碼已達使用上限' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const { rows: userRows } = await client.query(
            `INSERT INTO users (username, password_hash, display_name, role, is_active)
             VALUES ($1, $2, $3, $4, true) RETURNING user_id`,
            [
                username.trim(),
                hashedPassword,
                display_name?.trim() || username.trim(),
                inv.role,
            ]
        );

        await client.query(
            `UPDATE registration_invites SET use_count = use_count + 1 WHERE invite_id = $1`,
            [inv.invite_id]
        );

        await client.query('COMMIT');

        await AuditLogService.log({
            userId: userRows[0].user_id,
            username,
            action: 'REGISTER_INVITE',
            details: { invite_id: inv.invite_id, role: inv.role },
            req,
        });

        res.status(201).json({
            success: true,
            message: '註冊成功，請登入',
            userId: userRows[0].user_id,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ success: false, message: '帳號已存在' });
        }
        console.error('邀請註冊失敗:', err);
        res.status(500).json({ success: false, message: '註冊失敗' });
    } finally {
        client.release();
    }
});


module.exports = router;
