const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireRole } = require('../middleware/roleAuth');
const { projectAuthFilter } = require('../middleware/projectAuth');
const { resolveCountyByLngLat } = require('../utils/geo');
const { resolveAreaCity, normalizeCityCandidates, matchCity } = require('../utils/county');
const {
    mergeProjectLists,
    applyProjectFilter,
    fetchActiveProjects,
    fetchBoundaryOnlyProjects,
} = require('../utils/projectCatalog');

// 取得專案列表 (依使用者權限過濾)
// [P1-2] projects ∪ boundary-only；不再 fallback tree_survey DISTINCT
router.get('/', projectAuthFilter, async (req, res) => {
    try {
        if (req.projectFilter && req.projectFilter.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const activeRows = await fetchActiveProjects(req.projectFilter);
        const boundaryRows = await fetchBoundaryOnlyProjects();
        let rows = mergeProjectLists(activeRows, boundaryRows);
        rows = applyProjectFilter(rows, req.projectFilter);

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('取得專案列表錯誤:', err);
        res.status(500).json({ success: false, message: '取得專案列表時發生錯誤' });
    }
});

// 根據專案區位獲取專案列表
// [P3 / Bug 3] 一勞永逸版：
//   - 唯一資料源 = projects + project_areas (透過 area_id JOIN)
//   - 移除 tree_survey fallback (避免靠 project_name 字串相等，遇到
//     projects.name 含「（B1）」suffix 而 tree_survey 不含時整段斷掉)
//   - city 過濾：
//     1. 優先用 project_areas.city (denormalized cache，9 個港都已設好)
//     2. project_areas.city = NULL 時退回座標掃描，但用 project_code JOIN
//        而非 project_name 字串相等
router.get('/by_area/:area', projectAuthFilter, async (req, res) => {
    const { area } = req.params;
    const { city } = req.query;
    try {
        const activeRows = await db.query(`
            SELECT p.name, p.project_code AS code, pa.area_name AS area, pa.city AS area_city
            FROM projects p
            JOIN project_areas pa ON pa.id = p.area_id
            WHERE pa.area_name = $1 AND p.is_active = true
            ORDER BY p.name
        `, [area]);
        // area_id 為 NULL 但邊界已標 project_area 的 active 專案（migration stub / dedupe 後遺留）
        const orphanedRows = await db.query(`
            SELECT DISTINCT p.name, p.project_code AS code, TRIM(pb.project_area) AS area, NULL::text AS area_city
            FROM projects p
            JOIN project_boundaries pb ON TRIM(pb.project_name) = TRIM(p.name)
            WHERE p.is_active = true
              AND p.area_id IS NULL
              AND TRIM(pb.project_area) = TRIM($1)
        `, [area]);
        const boundaryRows = await fetchBoundaryOnlyProjects({ area });
        let rows = mergeProjectLists(activeRows.rows, boundaryRows);
        rows = mergeProjectLists(rows, orphanedRows.rows);
        // 還原 area_city（僅 active 專案有；boundary-only 列無此欄）
        const cityByCode = new Map();
        for (const r of activeRows.rows) {
            if (r.code) cityByCode.set(r.code, r.area_city);
        }
        rows = rows.map((r) => ({
            ...r,
            area_city: r.code ? cityByCode.get(r.code) ?? null : null,
        }));

        // [T7] 依 projectFilter 過濾；null = 無限制
        if (Array.isArray(req.projectFilter)) {
            rows = rows.filter(r => r.code && req.projectFilter.includes(r.code));
        }

        // city 過濾
        if (city && rows.length > 0) {
            const cityCandidates = normalizeCityCandidates(city);

            // 1. 優先用 project_areas.city
            const allHaveAreaCity = rows.every(r => r.area_city != null);
            if (allHaveAreaCity) {
                rows = rows.filter(r => cityCandidates.includes(r.area_city));
            } else {
                // 2. Fallback：座標掃描，用 project_code JOIN 避免 name 漂移
                const projectCodes = rows.map(r => r.code);
                const { rows: trees } = await db.query(`
                    SELECT project_code, project_location, x_coord, y_coord
                    FROM tree_survey
                    WHERE project_code = ANY($1::text[])
                      AND is_placeholder IS NOT TRUE
                `, [projectCodes]);
                const projectCities = new Map();
                for (const t of trees) {
                    const detected = resolveAreaCity({
                        lng: t.x_coord,
                        lat: t.y_coord,
                        areaName: t.project_location,
                    });
                    if (!detected) continue;
                    if (!projectCities.has(t.project_code)) projectCities.set(t.project_code, new Set());
                    projectCities.get(t.project_code).add(detected);
                }
                rows = rows.filter(r => {
                    if (r.area_city) return cityCandidates.includes(r.area_city);
                    const cities = projectCities.get(r.code);
                    return cities && cityCandidates.some(c => cities.has(c));
                });
            }
        }

        // 移除 internal-only 欄位避免 leak schema
        rows = rows.map(({ area_city, ...rest }) => rest);

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

/** 新增專案後自動關聯至建立者（非致命） */
async function autoAssignProjectToUser(req, projectCode) {
    if (!req.user?.user_id) return;
    try {
        const { rows: userRows } = await db.query(
            'SELECT associated_projects FROM users WHERE user_id = $1',
            [req.user.user_id]
        );
        if (userRows.length > 0) {
            const existing = userRows[0].associated_projects || '';
            const projectList = existing ? existing.split(',') : [];
            if (!projectList.includes(projectCode)) {
                projectList.push(projectCode);
                await db.query(
                    'UPDATE users SET associated_projects = $1 WHERE user_id = $2',
                    [projectList.join(','), req.user.user_id]
                );
            }
        }
        await db.query(
            'INSERT INTO user_projects (user_id, project_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.user.user_id, projectCode]
        );
        const { invalidateUserProjectsCache } = require('../middleware/projectAuth');
        invalidateUserProjectsCache(req.user.user_id);
    } catch (autoAssignErr) {
        console.error('自動關聯專案失敗 (非致命):', autoAssignErr);
    }
}

// 新增專案
// [Phase B] 直接寫入 projects 表 (single source of truth)
// 不再寫入 placeholder tree_survey 紀錄：
//   - GET 端早已從 projects + project_areas 主查 (此檔上半部)
//   - placeholder 會被 Bug 3 的 by_area JOIN 用「project_location」當 key
//     誤導區位歸屬
//   - 也是 Bug 2 (test 專案無法刪除) 的副作用：以前 DELETE handler 用
//     tree_survey COUNT > 0 才允許刪 → 沒樹的純 projects 列就刪不掉
router.post('/add', requireRole('業務管理員'), async (req, res) => {
    const { name, area } = req.body;
    if (!name || !area) {
        return res.status(400).json({ success: false, message: '請提供專案名稱與區位' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // 查找 area_id（新增與重複指派皆需）
        let areaId = null;
        const { rows: areaRows } = await client.query(
            'SELECT id FROM project_areas WHERE area_name = $1 LIMIT 1', [area]
        );
        if (areaRows.length > 0) {
            areaId = areaRows[0].id;
        }

        const dupCheck = await client.query(
            `SELECT project_code, area_id FROM projects
             WHERE name = $1 AND is_active IS NOT DISTINCT FROM TRUE
             LIMIT 1`,
            [name]
        );
        if (dupCheck.rows.length > 0) {
            const existingCode = dupCheck.rows[0].project_code;
            const existingAreaId = dupCheck.rows[0].area_id;

            // 孤兒專案（area_id NULL）→ 指派到目前港區，避免「同名已存在但列表看不到」
            if (existingAreaId == null && areaId != null) {
                await client.query(
                    'UPDATE projects SET area_id = $1 WHERE project_code = $2',
                    [areaId, existingCode]
                );
                await client.query('COMMIT');
                await autoAssignProjectToUser(req, existingCode);
                return res.status(200).json({
                    success: true,
                    code: 'PROJECT_REASSIGNED',
                    message: '專案已存在，已指派到此港區',
                    project: { name, code: existingCode, area },
                });
            }

            // 已在同一港區 → 視為選取既有專案，非錯誤
            if (existingAreaId != null && areaId != null && existingAreaId === areaId) {
                await client.query('ROLLBACK');
                return res.status(200).json({
                    success: true,
                    code: 'PROJECT_ALREADY_IN_AREA',
                    message: '專案已存在於此港區',
                    project: { name, code: existingCode, area },
                });
            }

            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_PROJECT_NAME',
                message: '同名專案已存在於其他港區，請改用其他名稱或聯絡管理員',
                existing_code: existingCode,
            });
        }

        // Advisory Lock (Key 2) 確保專案代碼生成的原子性
        await client.query('SELECT pg_advisory_xact_lock(2)');

        // 從 tree_survey 和 projects 兩個表取最大代碼，確保不衝突
        // (tree_survey 仍納入是為了相容歷史資料的純數字 project_code)
        const { rows: maxCodeRows } = await client.query(`
            SELECT GREATEST(
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM tree_survey WHERE project_code ~ '^[0-9]+$'), 0),
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM projects WHERE project_code ~ '^[0-9]+$'), 0)
            ) AS max_code
        `);
        const nextCode = (maxCodeRows[0].max_code || 0) + 1;

        // 寫入 projects 表 (single source of truth)
        await client.query(
            `INSERT INTO projects (project_code, name, area_id, description)
             VALUES ($1, $2, $3, '由系統自動建立')
             ON CONFLICT (project_code) DO UPDATE SET name = $2, area_id = COALESCE($3, projects.area_id)`,
            [nextCode.toString(), name, areaId]
        );

        await client.query('COMMIT');

        await autoAssignProjectToUser(req, nextCode.toString());

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

// 刪除專案 — 業務管理員以上
// [Phase B / Bug 2] 改用 projects 表為「專案是否存在」的判定主鍵
//   - 舊邏輯用 SELECT COUNT(*) FROM tree_survey 當門檻，
//     導致只有 projects 紀錄、沒有任何樹的測試/孤兒專案永遠 404
//     (例如 test吳全/test花慈/「無」/t1)
//   - 新邏輯：projects 表查到就刪，級聯清理所有 dependants
//   - 級聯範圍 (與 information_schema 對 project_code 的所有出現一致)：
//     1. project_boundaries
//     2. pending_tree_measurements (補上：原本漏處理！)
//     3. tree_survey
//     4. user_projects
//     5. users.associated_projects 逗號字串 (相容舊欄位)
//     6. projects (本身)
router.delete('/:code', requireRole('業務管理員'), async (req, res) => {
    const { code } = req.params;

    if (!code) {
        return res.status(400).json({ success: false, message: '請提供專案代碼' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. 以 projects 表為主鍵存在性檢查；找不到才檢查 tree_survey 兜底
        //    (相容遺留資料：projects 沒寫但 tree_survey 有的舊紀錄)
        const { rows: projRows } = await client.query(
            'SELECT id, name FROM projects WHERE project_code = $1 LIMIT 1', [code]
        );
        let projectName = projRows.length > 0 ? projRows[0].name : null;

        if (!projectName) {
            const { rows: legacyRows } = await client.query(
                'SELECT DISTINCT project_name FROM tree_survey WHERE project_code = $1 LIMIT 1', [code]
            );
            projectName = legacyRows.length > 0 ? legacyRows[0].project_name : null;
        }

        // 兩邊都沒有 → 真的不存在才回 404
        if (!projectName && projRows.length === 0) {
            const { rows: tsCheck } = await client.query(
                'SELECT 1 FROM tree_survey WHERE project_code = $1 LIMIT 1', [code]
            );
            if (tsCheck.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: '找不到指定專案' });
            }
        }

        // 2. 刪除專案邊界 (用 project_code 為主，project_name 為輔以相容歷史)
        const delBoundary = await client.query(
            'DELETE FROM project_boundaries WHERE project_code = $1 OR ($2::text IS NOT NULL AND project_name = $2)',
            [code, projectName]
        );

        // 3. 刪除 pending 量測 (補上：原本漏的！)
        const delPending = await client.query(
            'DELETE FROM pending_tree_measurements WHERE project_code = $1', [code]
        );

        // 4. 刪除樹木資料
        const delTrees = await client.query(
            'DELETE FROM tree_survey WHERE project_code = $1', [code]
        );

        // 5. 清理 user_projects 多對多
        const delUserProj = await client.query(
            'DELETE FROM user_projects WHERE project_code = $1', [code]
        );

        // 6. 清理 users.associated_projects 逗號字串 (相容舊欄位)
        //    只更新確實含此 code 的列，避免無謂寫入
        const { rows: dirtyUsers } = await client.query(
            `SELECT user_id, associated_projects FROM users
             WHERE associated_projects IS NOT NULL
               AND ('' || ',' || associated_projects || ',') LIKE '%,' || $1 || ',%'`,
            [code]
        );
        for (const u of dirtyUsers) {
            const cleaned = (u.associated_projects || '')
                .split(',')
                .map(s => s.trim())
                .filter(s => s !== '' && s !== code)
                .join(',');
            await client.query('UPDATE users SET associated_projects = $1 WHERE user_id = $2', [cleaned, u.user_id]);
        }

        // 7. 最後刪除 projects 主紀錄
        const delProj = await client.query(
            'DELETE FROM projects WHERE project_code = $1', [code]
        );

        await client.query('COMMIT');

        // 清除快取 (associated_projects 已變更)
        try {
            const { invalidateUserProjectsCache } = require('../middleware/projectAuth');
            for (const u of dirtyUsers) invalidateUserProjectsCache(u.user_id);
        } catch (_) { /* non-fatal */ }

        res.json({
            success: true,
            message: `專案 (代碼: ${code}) 已刪除`,
            details: {
                boundaries: delBoundary.rowCount,
                pending: delPending.rowCount,
                trees: delTrees.rowCount,
                user_projects: delUserProj.rowCount,
                projects: delProj.rowCount,
                users_cleaned: dirtyUsers.length,
            }
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
