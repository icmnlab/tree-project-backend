const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireRole } = require('../middleware/roleAuth');
const { projectAuthFilter } = require('../middleware/projectAuth');
const { resolveCountyByLngLat } = require('../utils/geo');

// 取得專案列表 (依使用者權限過濾)
// [Phase A] 優先從 projects 表查詢，fallback 到 SELECT DISTINCT FROM tree_survey
router.get('/', projectAuthFilter, async (req, res) => {
    try {
        // 依使用者權限過濾專案
        if (req.projectFilter && req.projectFilter.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // 優先查 projects 表
        let rows = [];
        try {
            let query = `
                SELECT p.name, p.project_code AS code, COALESCE(pa.area_name, '') AS area
                FROM projects p
                LEFT JOIN project_areas pa ON pa.id = p.area_id
                WHERE p.is_active = true
            `;
            const params = [];
            let paramIdx = 1;

            if (req.projectFilter) {
                query += ` AND p.project_code = ANY($${paramIdx}::text[])`;
                params.push(req.projectFilter);
                paramIdx++;
            }
            query += ` ORDER BY p.project_code`;
            const result = await db.query(query, params);
            rows = result.rows;
        } catch (projectsTableErr) {
            console.warn('[Phase A fallback] projects 表查詢失敗，退回 tree_survey:', projectsTableErr.message);
        }

        // Fallback: 如果 projects 表查無結果，退回 SELECT DISTINCT
        if (rows.length === 0) {
            let fallbackQuery = `
                SELECT DISTINCT ON (project_code)
                    project_name AS name,
                    project_code AS code,
                    project_location AS area
                FROM tree_survey
                WHERE project_name IS NOT NULL AND project_name != ''
            `;
            const fallbackParams = [];
            let paramIdx = 1;

            if (req.projectFilter) {
                fallbackQuery += ` AND project_code = ANY($${paramIdx}::text[])`;
                fallbackParams.push(req.projectFilter);
                paramIdx++;
            }
            fallbackQuery += ` ORDER BY project_code, project_name`;
            const fallbackResult = await db.query(fallbackQuery, fallbackParams);
            rows = fallbackResult.rows;
        }

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('取得專案列表錯誤:', err);
        res.status(500).json({ success: false, message: '取得專案列表時發生錯誤' });
    }
});

// 根據專案區位獲取專案列表
// [Phase A] 優先從 projects 表查詢
// [T7] 加 projectAuthFilter：Lvl<4 只能看被授權的專案
// [Bug A 修復] 支援 ?city=X：只回傳「該專案至少有一棵樹的座標解析縣市 = X」的專案
router.get('/by_area/:area', projectAuthFilter, async (req, res) => {
    const { area } = req.params;
    const { city } = req.query;
    try {
        let rows = [];

        // 優先查 projects + project_areas
        try {
            const result = await db.query(`
                SELECT p.name, p.project_code AS code, pa.area_name AS area
                FROM projects p
                JOIN project_areas pa ON pa.id = p.area_id
                WHERE pa.area_name = $1 AND p.is_active = true
                ORDER BY p.name
            `, [area]);
            rows = result.rows;
        } catch (e) {
            console.warn('[Phase A fallback] by_area projects 表查詢失敗:', e.message);
        }

        // Fallback
        if (rows.length === 0) {
            const fallback = await db.query(`
                SELECT DISTINCT project_name AS name, project_code AS code, project_location AS area
                FROM tree_survey
                WHERE project_location = $1 AND project_name IS NOT NULL AND project_name != ''
                ORDER BY project_name
            `, [area]);
            rows = fallback.rows;
        }

        // [T7] 依 projectFilter 過濾；null = 無限制
        if (Array.isArray(req.projectFilter)) {
            rows = rows.filter(r => req.projectFilter.includes(r.code));
        }

        // [Bug A] city 過濾：只保留「該專案至少有一棵樹解析到該 city」的專案
        if (city && rows.length > 0) {
            const cityCandidates = (city.endsWith('市') || city.endsWith('縣'))
                ? [city]
                : [city + '市', city + '縣'];
            const projectNames = rows.map(r => r.name);
            const { rows: trees } = await db.query(`
                SELECT project_name, x_coord, y_coord
                FROM tree_survey
                WHERE project_name = ANY($1::text[])
                  AND is_placeholder IS NOT TRUE
                  AND x_coord IS NOT NULL AND y_coord IS NOT NULL
                  AND x_coord != 0 AND y_coord != 0
            `, [projectNames]);
            const projectCities = new Map();
            for (const t of trees) {
                const detected = resolveCountyByLngLat(Number(t.x_coord), Number(t.y_coord));
                if (!detected || !detected.name) continue;
                if (!projectCities.has(t.project_name)) projectCities.set(t.project_name, new Set());
                projectCities.get(t.project_name).add(detected.name);
            }
            rows = rows.filter(r => {
                const cities = projectCities.get(r.name);
                return cities && cityCandidates.some(c => cities.has(c));
            });
        }

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error(`取得區位[${area}]的專案列表錯誤:`, err);
        res.status(500).json({ success: false, message: '取得專案列表時發生錯誤' });
    }
});

// 根據專案名稱獲取專案資訊 (主要用於檢查專案是否存在)
// [Phase A] 優先從 projects 表查詢
// [T7] 加 projectAuthFilter：Lvl<4 看不到未被授權專案
router.get('/by_name/:name', projectAuthFilter, async (req, res) => {
    const { name } = req.params;
    try {
        let row = null;

        try {
            const result = await db.query(`
                SELECT p.name, p.project_code AS code, COALESCE(pa.area_name, '') AS area
                FROM projects p
                LEFT JOIN project_areas pa ON pa.id = p.area_id
                WHERE p.name = $1
                LIMIT 1
            `, [name]);
            if (result.rows.length > 0) row = result.rows[0];
        } catch (e) {
            console.warn('[Phase A fallback] by_name projects 表查詢失敗:', e.message);
        }

        // Fallback
        if (!row) {
            const fallback = await db.query(`
                SELECT DISTINCT ON (project_code)
                    project_name AS name,
                    project_code AS code,
                    project_location AS area
                FROM tree_survey
                WHERE project_name = $1
                LIMIT 1
            `, [name]);
            if (fallback.rows.length > 0) row = fallback.rows[0];
        }

        if (row) {
            // [T7] 未被授權則回 404，避免泄露專案存在
            if (Array.isArray(req.projectFilter) && !req.projectFilter.includes(row.code)) {
                return res.status(404).json({ success: false, message: '找不到指定的專案' });
            }
            res.json({ success: true, data: row });
        } else {
            res.status(404).json({ success: false, message: '找不到指定的專案' });
        }
    } catch (err) {
        console.error(`取得專案[${name}]資訊錯誤:`, err);
        res.status(500).json({ success: false, message: '查詢專案時發生錯誤' });
    }
});


// 根據專案代碼獲取專案資訊
// [Phase A] 優先從 projects 表查詢
// [T7] 加 projectAuthFilter：Lvl<4 看不到未被授權專案
router.get('/by_code/:code', projectAuthFilter, async (req, res) => {
    const { code } = req.params;
    try {
        let row = null;

        try {
            const result = await db.query(`
                SELECT p.name, p.project_code AS code, COALESCE(pa.area_name, '') AS area
                FROM projects p
                LEFT JOIN project_areas pa ON pa.id = p.area_id
                WHERE p.project_code = $1
                LIMIT 1
            `, [code]);
            if (result.rows.length > 0) row = result.rows[0];
        } catch (e) {
            console.warn('[Phase A fallback] by_code projects 表查詢失敗:', e.message);
        }

        // Fallback
        if (!row) {
            const fallback = await db.query(`
                SELECT DISTINCT ON (project_code)
                    project_name AS name,
                    project_code AS code,
                    project_location AS area
                FROM tree_survey
                WHERE project_code = $1
                LIMIT 1
            `, [code]);
            if (fallback.rows.length > 0) row = fallback.rows[0];
        }

        if (row) {
            // [T7] 未被授權則回 404
            if (Array.isArray(req.projectFilter) && !req.projectFilter.includes(row.code)) {
                return res.status(404).json({ success: false, message: '找不到指定的專案' });
            }
            res.json({ success: true, data: row });
        } else {
            res.status(404).json({ success: false, message: '找不到指定的專案' });
        }
    } catch (err) {
        console.error(`取得專案代碼[${code}]資訊錯誤:`, err);
        res.status(500).json({ success: false, message: '查詢專案時發生錯誤' });
    }
});

// 新增專案
// [Phase B] 不再建立 placeholder tree_survey 記錄，直接寫入 projects 表
// 專案代碼改由 projects 表的數據生成，不再依賴 tree_survey
router.post('/add', requireRole('業務管理員'), async (req, res) => {
    const { name, area } = req.body;
    if (!name || !area) {
        return res.status(400).json({ success: false, message: '請提供專案名稱與區位' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Advisory Lock (Key 2) 確保專案代碼生成的原子性
        await client.query('SELECT pg_advisory_xact_lock(2)');

        // 從 tree_survey 和 projects 兩個表取最大代碼，確保不衝突
        const { rows: maxCodeRows } = await client.query(`
            SELECT GREATEST(
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM tree_survey WHERE project_code ~ '^[0-9]+$'), 0),
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM projects WHERE project_code ~ '^[0-9]+$'), 0)
            ) AS max_code
        `);
        const nextCode = (maxCodeRows[0].max_code || 0) + 1;

        // 查找 area_id
        let areaId = null;
        const { rows: areaRows } = await client.query(
            'SELECT id FROM project_areas WHERE area_name = $1 LIMIT 1', [area]
        );
        if (areaRows.length > 0) {
            areaId = areaRows[0].id;
        }

        // 寫入 projects 表
        await client.query(
            `INSERT INTO projects (project_code, name, area_id, description)
             VALUES ($1, $2, $3, '由系統自動建立')
             ON CONFLICT (project_code) DO UPDATE SET name = $2, area_id = COALESCE($3, projects.area_id)`,
            [nextCode.toString(), name, areaId]
        );

        // [雙寫向後相容] 仍插入 placeholder 記錄到 tree_survey
        // 這確保舊的 SELECT DISTINCT 查詢仍可找到此專案
        const placeholderSystemId = `PLACEHOLDER-${nextCode}`;
        await client.query(`
            INSERT INTO tree_survey (project_name, project_code, project_location, species_name, system_tree_id, project_tree_id, is_placeholder)
            VALUES ($1, $2, $3, '__PLACEHOLDER__', $4, 'PT-0', true)
        `, [name, nextCode.toString(), area, placeholderSystemId]);

        await client.query('COMMIT');

        // 自動將創建者關聯到新專案
        if (req.user && req.user.user_id) {
            try {
                // [舊] 寫入 associated_projects 逗號分隔字串
                const { rows: userRows } = await db.query('SELECT associated_projects FROM users WHERE user_id = $1', [req.user.user_id]);
                if (userRows.length > 0) {
                    const existing = userRows[0].associated_projects || '';
                    const projectList = existing ? existing.split(',') : [];
                    if (!projectList.includes(nextCode.toString())) {
                        projectList.push(nextCode.toString());
                        await db.query('UPDATE users SET associated_projects = $1 WHERE user_id = $2', [projectList.join(','), req.user.user_id]);
                    }
                }

                // [新] 寫入 user_projects
                await db.query(
                    'INSERT INTO user_projects (user_id, project_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [req.user.user_id, nextCode.toString()]
                );

                // 清除快取
                const { invalidateUserProjectsCache } = require('../middleware/projectAuth');
                invalidateUserProjectsCache(req.user.user_id);
            } catch (autoAssignErr) {
                console.error('自動關聯專案失敗 (非致命):', autoAssignErr);
            }
        }

        res.status(201).json({
            success: true,
            message: '專案新增成功',
            project: { name, code: nextCode.toString(), area }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('新增專案錯誤:', err);
        res.status(500).json({ success: false, message: '新增專案時發生錯誤' });
    } finally {
        client.release();
    }
});

// 刪除專案 (刪除該專案代碼下的所有樹木+邊界+區域資料) — 業務管理員以上
router.delete('/:code', requireRole('業務管理員'), async (req, res) => {
    const { code } = req.params;
    
    if (!code) {
        return res.status(400).json({ success: false, message: '請提供專案代碼' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // 檢查專案是否存在
        const checkQuery = `SELECT COUNT(*) as count FROM tree_survey WHERE project_code = $1`;
        const { rows: checkRows } = await client.query(checkQuery, [code]);
        
        if (parseInt(checkRows[0].count) === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: '找不到指定專案或該專案已無資料' });
        }

        // 取得專案名稱（用於刪除邊界）
        const { rows: nameRows } = await client.query('SELECT DISTINCT project_name FROM tree_survey WHERE project_code = $1 LIMIT 1', [code]);
        const projectName = nameRows.length > 0 ? nameRows[0].project_name : null;

        // 1. 刪除專案邊界
        if (projectName) {
            await client.query('DELETE FROM project_boundaries WHERE project_name = $1 OR project_code = $2', [projectName, code]);
        }

        // 2. 刪除專案下所有樹木資料
        const deleteQuery = `DELETE FROM tree_survey WHERE project_code = $1`;
        await client.query(deleteQuery, [code]);

        // 3. 清理使用者的 associated_projects 中的此專案代碼（舊）
        const { rows: allUsers } = await client.query('SELECT user_id, associated_projects FROM users WHERE associated_projects IS NOT NULL');
        for (const user of allUsers) {
            const projects = user.associated_projects.split(',').filter(p => p.trim() !== code);
            await client.query('UPDATE users SET associated_projects = $1 WHERE user_id = $2', [projects.join(','), user.user_id]);
        }

        // [Phase A 雙寫] 清理 user_projects 和 projects 表
        try {
            await client.query('DELETE FROM user_projects WHERE project_code = $1', [code]);
            await client.query('DELETE FROM projects WHERE project_code = $1', [code]);
        } catch (dualWriteErr) {
            console.error('[Phase A 雙寫] 清理新表失敗 (非致命):', dualWriteErr.message);
        }

        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `專案 (代碼: ${code}) 及其所有樹木資料、邊界已刪除` 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`刪除專案[${code}]錯誤:`, err);
        res.status(500).json({ success: false, message: '刪除專案時發生錯誤' });
    } finally {
        client.release();
    }
});

module.exports = router;
