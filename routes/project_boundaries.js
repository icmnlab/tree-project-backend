/**
 * V3 專案邊界 API
 * 
 * 功能：
 * 1. 儲存使用者手動繪製的專案邊界多邊形
 * 2. 查詢專案邊界
 * 3. 判斷座標是否在特定專案邊界內
 * 4. 根據座標查詢對應的專案
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const turf = require('@turf/turf');
const { requireRole } = require('../middleware/roleAuth');
const { projectAuthFilter } = require('../middleware/projectAuth');
const { suggestBoundaryFromTrees } = require('../utils/boundarySuggest');

/**
 * 初始化資料表 (如果不存在)
 */
async function initializeTable() {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS project_boundaries (
            id SERIAL PRIMARY KEY,
            project_name VARCHAR(255) NOT NULL UNIQUE,
            project_code VARCHAR(50),
            project_area VARCHAR(50),
            boundary_coordinates JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        
        CREATE INDEX IF NOT EXISTS idx_project_boundaries_name ON project_boundaries(project_name);
        CREATE INDEX IF NOT EXISTS idx_project_boundaries_code ON project_boundaries(project_code);

        -- [Phase 2b] 補上 project_area 欄位（舊資料表升級）
        ALTER TABLE project_boundaries ADD COLUMN IF NOT EXISTS project_area VARCHAR(50);

        -- [Phase 2c] updated_at 改 TIMESTAMPTZ + trigger，供樂觀鎖使用
        ALTER TABLE project_boundaries ALTER COLUMN updated_at TYPE TIMESTAMPTZ;
        ALTER TABLE project_boundaries ALTER COLUMN updated_at SET DEFAULT now();
        DROP TRIGGER IF EXISTS project_boundaries_set_updated_at ON project_boundaries;
        CREATE TRIGGER project_boundaries_set_updated_at
            BEFORE UPDATE ON project_boundaries
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `;
    
    try {
        await db.query(createTableQuery);
        console.log('[project_boundaries] 資料表初始化完成');
    } catch (err) {
        console.error('[project_boundaries] 資料表初始化錯誤:', err);
    }
}

// 啟動時初始化資料表
initializeTable();

/**
 * [2NF / 多人協作] 邊界寫入前確保 projects 列存在。
 * project_code 為穩定鍵；手繪邊界（如「吳全1區」）若無對應專案則自動建立 stub。
 */
async function ensureProjectForBoundary(client, { projectName, projectCode, projectArea }) {
    const trimmedName = (projectName || '').trim();
    if (!trimmedName) return null;

    // 1) 優先沿用既有 active 專案（同名唯一）
    const byActiveName = await client.query(
        `SELECT project_code FROM projects
         WHERE name = $1 AND is_active IS NOT DISTINCT FROM TRUE
         ORDER BY id ASC LIMIT 1`,
        [trimmedName]
    );
    if (byActiveName.rows.length > 0) {
        return byActiveName.rows[0].project_code;
    }

    let resolvedCode =
        projectCode && String(projectCode).trim() && projectCode !== '無'
            ? String(projectCode).trim()
            : null;

    // 2) 若指定 code 且已存在 → 直接沿用（邊界 FK 對齊）
    if (resolvedCode) {
        const byCode = await client.query(
            `SELECT project_code, name FROM projects WHERE project_code = $1 LIMIT 1`,
            [resolvedCode]
        );
        if (byCode.rows.length > 0) {
            const existingName = (byCode.rows[0].name || '').trim();
            if (existingName && existingName !== trimmedName) {
                throw new Error(
                    `project_code ${resolvedCode} 已對應「${existingName}」，與邊界名稱「${trimmedName}」衝突`
                );
            }
            await client.query(
                `UPDATE projects SET is_active = TRUE, updated_at = NOW()
                 WHERE project_code = $1`,
                [resolvedCode]
            );
            return resolvedCode;
        }
    }

    // 3) 停用列可復活（避免再 INSERT 同名）
    const byInactiveName = await client.query(
        `SELECT project_code FROM projects
         WHERE name = $1 AND is_active IS NOT DISTINCT FROM FALSE
         ORDER BY id ASC LIMIT 1`,
        [trimmedName]
    );
    if (byInactiveName.rows.length > 0) {
        const code = byInactiveName.rows[0].project_code;
        await client.query(
            `UPDATE projects SET is_active = TRUE, updated_at = NOW() WHERE project_code = $1`,
            [code]
        );
        return code;
    }

    let areaId = null;
    if (projectArea) {
        const ar = await client.query(
            'SELECT id FROM project_areas WHERE area_name = $1 LIMIT 1',
            [projectArea]
        );
        if (ar.rows.length > 0) areaId = ar.rows[0].id;
    }

    await client.query('SELECT pg_advisory_xact_lock(2)');

    if (!resolvedCode) {
        const { rows: maxCodeRows } = await client.query(`
            SELECT GREATEST(
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM tree_survey WHERE project_code ~ '^[0-9]+$'), 0),
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM projects WHERE project_code ~ '^[0-9]+$'), 0)
            ) AS max_code
        `);
        resolvedCode = String((maxCodeRows[0].max_code || 0) + 1);
    }

    await client.query(
        `INSERT INTO projects (project_code, name, area_id, is_active, description)
         VALUES ($1, $2, $3, TRUE, '由專案邊界自動建立')
         ON CONFLICT (project_code) DO NOTHING`,
        [resolvedCode, trimmedName, areaId]
    );

    const verify = await client.query(
        `SELECT project_code FROM projects WHERE name = $1 AND is_active IS NOT DISTINCT FROM TRUE LIMIT 1`,
        [trimmedName]
    );
    if (verify.rows.length > 0) {
        return verify.rows[0].project_code;
    }

    return resolvedCode;
}

/**
 * 取得所有專案邊界 (依使用者權限過濾)
 * GET /api/project_boundaries
 */
router.get('/', projectAuthFilter, async (req, res) => {
    try {
        let query = `
            SELECT id, project_name, project_code, project_area, boundary_coordinates, created_at, updated_at
            FROM project_boundaries
        `;
        const params = [];
        let paramIdx = 1;

        // 依使用者權限過濾
        if (req.projectFilter) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, data: [] });
            }
            query += ` WHERE project_code = ANY($${paramIdx}::text[])`;
            params.push(req.projectFilter);
            paramIdx++;
        }

        query += ` ORDER BY project_name ASC`;
        const { rows } = await db.query(query, params);
        
        res.json({ 
            success: true, 
            data: rows.map(row => ({
                ...row,
                // 確保 coordinates 是正確的陣列格式
                boundary_coordinates: typeof row.boundary_coordinates === 'string' 
                    ? JSON.parse(row.boundary_coordinates) 
                    : row.boundary_coordinates
            }))
        });
    } catch (err) {
        console.error('[project_boundaries] 取得邊界列表錯誤:', err);
        res.status(500).json({ success: false, message: '取得專案邊界列表失敗' });
    }
});

/**
 * 專案邊界狀態（metadata vs spatial）
 * GET /api/project_boundaries/status/:projectName
 */
router.get('/status/:projectName', projectAuthFilter, async (req, res) => {
    const { projectName } = req.params;
    try {
        if (req.projectFilter != null) {
            const { rows: proj } = await db.query(
                'SELECT project_code FROM projects WHERE name = $1',
                [projectName],
            );
            const code = proj[0]?.project_code;
            if (!code || !req.projectFilter.includes(code)) {
                return res.status(403).json({ success: false, message: '權限不足' });
            }
        }
        const { rows: boundaryRows } = await db.query(
            'SELECT id FROM project_boundaries WHERE project_name = $1',
            [projectName],
        );
        const { rows: treeRows } = await db.query(
            `SELECT COUNT(*)::int AS cnt
             FROM tree_survey
             WHERE project_name = $1
               AND x_coord IS NOT NULL AND y_coord IS NOT NULL
               AND NOT (x_coord = 0 AND y_coord = 0)`,
            [projectName],
        );
        const treeCountWithGps = treeRows[0]?.cnt ?? 0;
        const hasBoundary = boundaryRows.length > 0;

        let canSuggest = !hasBoundary && treeCountWithGps >= 3;
        let suggestBlockedReason = null;
        if (hasBoundary) {
            suggestBlockedReason = 'ALREADY_HAS_BOUNDARY';
        } else if (treeCountWithGps < 3) {
            suggestBlockedReason = 'INSUFFICIENT_TREES';
        }

        res.json({
            success: true,
            projectName,
            hasBoundary,
            boundaryState: hasBoundary ? 'manual' : 'none',
            treeCountWithGps,
            canSuggest,
            suggestBlockedReason,
        });
    } catch (err) {
        console.error('[project_boundaries] 取得邊界狀態錯誤:', err);
        res.status(500).json({ success: false, message: '取得專案邊界狀態失敗' });
    }
});

/**
 * 從既有 tree_survey GPS 產生「建議邊界」預覽（不寫入 DB）
 * POST /api/project_boundaries/suggest
 *
 * Body: { projectName, bufferM?, maxSpanM? }
 * 主群集 outlier 排除 + 跨度上限，避免後續 APP 遠距樹木污染邊界。
 */
router.post('/suggest', requireRole('專案管理員'), async (req, res) => {
    const { projectName, bufferM, maxSpanM } = req.body;

    if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ success: false, message: '請提供 projectName' });
    }

    try {
        const { rows: existing } = await db.query(
            'SELECT id FROM project_boundaries WHERE project_name = $1',
            [projectName],
        );
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                code: 'ALREADY_HAS_BOUNDARY',
                message: '此專案已有邊界，請使用「重新繪製」修改',
                hasBoundary: true,
            });
        }

        const { rows: trees } = await db.query(
            `SELECT id, system_tree_id, x_coord, y_coord
             FROM tree_survey
             WHERE project_name = $1
               AND x_coord IS NOT NULL AND y_coord IS NOT NULL
               AND NOT (x_coord = 0 AND y_coord = 0)`,
            [projectName],
        );

        const treePoints = trees.map((t) => ({
            id: t.id,
            system_tree_id: t.system_tree_id,
            lng: t.x_coord,
            lat: t.y_coord,
        }));

        const result = suggestBoundaryFromTrees(treePoints, {
            bufferM: typeof bufferM === 'number' ? bufferM : undefined,
            maxSpanM: typeof maxSpanM === 'number' ? maxSpanM : undefined,
        });

        if (!result.ok) {
            return res.status(422).json({
                success: false,
                code: result.code,
                message: result.message,
                stats: result.stats,
            });
        }

        res.json({
            success: true,
            preview: true,
            projectName,
            coordinates: result.coordinates,
            stats: result.stats,
            warnings: result.warnings,
            message: '建議邊界預覽（尚未儲存）。請確認後再儲存。',
        });
    } catch (err) {
        console.error('[project_boundaries] 建議邊界錯誤:', err);
        res.status(500).json({ success: false, message: '產生建議邊界失敗' });
    }
});

/**
 * 新增或更新專案邊界
 * POST /api/project_boundaries
 * 
 * Body:
 * {
 *   projectName: string,
 *   projectCode: string (optional),
 *   coordinates: [[lat, lng], [lat, lng], ...] // 多邊形頂點
 * }
 */
router.post('/', requireRole('專案管理員'), async (req, res) => {
    const { projectName, projectCode, projectArea, coordinates } = req.body;
    
    // 驗證輸入
    if (!projectName) {
        return res.status(400).json({ success: false, message: '專案名稱不能為空' });
    }
    
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
        return res.status(400).json({ 
            success: false, 
            message: '邊界座標必須至少包含 3 個頂點' 
        });
    }
    
    // 驗證座標格式
    for (const coord of coordinates) {
        if (!Array.isArray(coord) || coord.length !== 2 ||
            typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
            return res.status(400).json({ 
                success: false, 
                message: '座標格式不正確，應為 [[lat, lng], ...]' 
            });
        }
    }
    
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // [Phase 2c] 樂觀鎖：若 client 帶了 expectedUpdatedAt，
        // 且目前 DB 裡已有該 project_name，則必須相符才允許覆蓋
        const expectedUpdatedAt = req.body.expectedUpdatedAt;
        const { rows: existingRows } = await client.query(
            'SELECT * FROM project_boundaries WHERE project_name = $1',
            [projectName]
        );
        if (expectedUpdatedAt && existingRows.length > 0) {
            const serverTs = new Date(existingRows[0].updated_at).getTime();
            const clientTs = new Date(expectedUpdatedAt).getTime();
            if (Number.isFinite(serverTs) && Number.isFinite(clientTs) && serverTs !== clientTs) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    code: 'CONFLICT',
                    message: '邊界已被其他人修改，請重新整理',
                    serverVersion: existingRows[0]
                });
            }
        }
        
        // 檢查該專案是否已有現有樹木資料
        const { rows: existingTrees } = await client.query(
            'SELECT x_coord, y_coord FROM tree_survey WHERE project_name = $1 AND x_coord IS NOT NULL AND y_coord IS NOT NULL',
            [projectName]
        );
        
        // 如果有現有樹木，驗證新邊界是否涵蓋所有樹木
        if (existingTrees.length > 0) {
            // 建立多邊形 (turf 需要 [lng, lat] 格式，且首尾相連)
            const polygonCoords = coordinates.map(c => [c[1], c[0]]); // 轉換為 [lng, lat]
            polygonCoords.push(polygonCoords[0]); // 閉合多邊形
            
            let polygon;
            try {
                polygon = turf.polygon([polygonCoords]);
            } catch (e) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    message: '無法建立有效的多邊形，請檢查座標是否正確' 
                });
            }
            
            // 檢查每棵現有樹木是否都在新邊界內
            const treesOutside = [];
            for (const tree of existingTrees) {
                const point = turf.point([tree.x_coord, tree.y_coord]); // [lng, lat]
                if (!turf.booleanPointInPolygon(point, polygon)) {
                    treesOutside.push({
                        lat: tree.y_coord,
                        lng: tree.x_coord
                    });
                }
            }
            
            if (treesOutside.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    message: `邊界無法涵蓋所有現有樹木，有 ${treesOutside.length} 棵樹在邊界外`,
                    treesOutside: treesOutside.slice(0, 10) // 最多返回 10 棵
                });
            }
        }
        
        // [Phase 2b] 自動解析 project_area：
        // 1) request 帶了 → 使用 request 值
        // 2) 未帶但帶了 projectCode → 從 projects + project_areas 查
        // 3) 仍無 → NULL（允許，以後能補）
        let resolvedArea = projectArea || null;
        if (!resolvedArea && projectCode) {
            try {
                const r = await client.query(`
                    SELECT pa.area_name
                    FROM projects p
                    LEFT JOIN project_areas pa ON pa.id = p.area_id
                    WHERE p.project_code = $1
                `, [projectCode]);
                if (r.rows.length > 0 && r.rows[0].area_name) {
                    resolvedArea = r.rows[0].area_name;
                }
            } catch (e) {
                console.warn('[project_boundaries] resolve project_area 失敗:', e.message);
            }
        }
        
        // [2NF] 寫入邊界前先確保 projects 存在，避免 FK 失敗且讓 /projects API 可列出
        const resolvedProjectCode = await ensureProjectForBoundary(client, {
            projectName,
            projectCode,
            projectArea: resolvedArea,
        });

        // 使用 UPSERT 語法
        const { rows } = await client.query(`
            INSERT INTO project_boundaries (project_name, project_code, project_area, boundary_coordinates, updated_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (project_name) 
            DO UPDATE SET 
                project_code = COALESCE(EXCLUDED.project_code, project_boundaries.project_code),
                project_area = COALESCE(EXCLUDED.project_area, project_boundaries.project_area),
                boundary_coordinates = EXCLUDED.boundary_coordinates,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [projectName, resolvedProjectCode ?? projectCode, resolvedArea, JSON.stringify(coordinates)]);
        
        await client.query('COMMIT');
        
        res.status(201).json({ 
            success: true, 
            message: '專案邊界已儲存',
            data: rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[project_boundaries] 儲存專案邊界錯誤:', err);
        res.status(500).json({ success: false, message: '儲存專案邊界失敗' });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────────────────────────────────
// [Phase 2d] 軟性 by_code 端點 — 以 project_code 為主鍵的查/刪
// 不替換 by-name 端點，雙軌並存。
// ─────────────────────────────────────────────────────────────────────────

/**
 * 取得特定專案的邊界（依 project_code）
 * GET /api/project_boundaries/by_code/:projectCode
 */
router.get('/by_code/:projectCode', async (req, res) => {
    const { projectCode } = req.params;
    try {
        const { rows } = await db.query(
            'SELECT * FROM project_boundaries WHERE project_code = $1',
            [projectCode]
        );
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '找不到該專案代碼的邊界',
                hasBoundary: false,
            });
        }
        const boundary = rows[0];
        res.json({
            success: true,
            data: {
                ...boundary,
                boundary_coordinates: typeof boundary.boundary_coordinates === 'string'
                    ? JSON.parse(boundary.boundary_coordinates)
                    : boundary.boundary_coordinates,
            },
            hasBoundary: true,
        });
    } catch (err) {
        console.error('[project_boundaries][by_code] 取得錯誤:', err);
        res.status(500).json({ success: false, message: '取得專案邊界失敗' });
    }
});

/**
 * 刪除專案邊界（依 project_code） — 專案管理員以上
 * DELETE /api/project_boundaries/by_code/:projectCode
 */
router.delete('/by_code/:projectCode', requireRole('專案管理員'), async (req, res) => {
    const { projectCode } = req.params;
    try {
        const { rowCount } = await db.query(
            'DELETE FROM project_boundaries WHERE project_code = $1',
            [projectCode]
        );
        if (rowCount > 0) {
            res.json({ success: true, message: '專案邊界已刪除' });
        } else {
            res.status(404).json({ success: false, message: '找不到要刪除的專案邊界' });
        }
    } catch (err) {
        console.error('[project_boundaries][by_code] 刪除錯誤:', err);
        res.status(500).json({ success: false, message: '刪除專案邊界失敗' });
    }
});

/**
 * 檢查座標是否在特定專案邊界內
 * POST /api/project_boundaries/check
 * 
 * Body:
 * {
 *   projectName: string,
 *   lat: number,
 *   lng: number
 * }
 */
router.post('/check', projectAuthFilter, async (req, res) => {
    const { projectName, lat, lng } = req.body;
    
    if (!projectName || lat === undefined || lng === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: '請提供專案名稱和座標 (lat, lng)' 
        });
    }
    
    try {
        const { rows } = await db.query(
            'SELECT boundary_coordinates FROM project_boundaries WHERE project_name = $1',
            [projectName]
        );
        
        if (rows.length === 0) {
            // 專案沒有邊界，不受座標限制
            return res.json({ 
                success: true, 
                isInside: true,
                hasBoundary: false,
                message: '該專案尚未設定邊界，不受座標限制'
            });
        }

        if (req.projectFilter != null) {
            const code = rows[0].project_code;
            if (!code || !req.projectFilter.includes(code)) {
                return res.status(403).json({ success: false, message: '權限不足' });
            }
        }
        
        const coordinates = typeof rows[0].boundary_coordinates === 'string'
            ? JSON.parse(rows[0].boundary_coordinates)
            : rows[0].boundary_coordinates;
        
        // 建立多邊形
        const polygonCoords = coordinates.map(c => [c[1], c[0]]); // 轉換為 [lng, lat]
        polygonCoords.push(polygonCoords[0]); // 閉合多邊形
        
        const polygon = turf.polygon([polygonCoords]);
        const point = turf.point([lng, lat]);
        const isInside = turf.booleanPointInPolygon(point, polygon);
        
        res.json({ 
            success: true, 
            isInside,
            hasBoundary: true,
            message: isInside ? '座標在專案邊界內' : '座標不在專案邊界內'
        });
    } catch (err) {
        console.error('[project_boundaries] 檢查座標錯誤:', err);
        res.status(500).json({ success: false, message: '檢查座標失敗' });
    }
});

/**
 * 根據座標查找對應的專案
 * POST /api/project_boundaries/find_project
 * 
 * Body:
 * {
 *   lat: number,
 *   lng: number
 * }
 * 
 * 返回座標所在的所有專案（可能多個專案邊界重疊）
 */
router.post('/find_project', projectAuthFilter, async (req, res) => {
    const { lat, lng } = req.body;
    
    if (lat === undefined || lng === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: '請提供座標 (lat, lng)' 
        });
    }
    
    try {
        let boundaryQuery =
            'SELECT project_name, project_code, project_area, boundary_coordinates FROM project_boundaries';
        const boundaryParams = [];
        if (req.projectFilter != null) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, projects: [], count: 0 });
            }
            boundaryQuery += ' WHERE project_code = ANY($1::text[])';
            boundaryParams.push(req.projectFilter);
        }
        const { rows: allBoundaries } = await db.query(boundaryQuery, boundaryParams);
        
        const matchingProjects = [];
        const point = turf.point([lng, lat]);
        
        for (const boundary of allBoundaries) {
            const coordinates = typeof boundary.boundary_coordinates === 'string'
                ? JSON.parse(boundary.boundary_coordinates)
                : boundary.boundary_coordinates;
            
            try {
                const polygonCoords = coordinates.map(c => [c[1], c[0]]);
                polygonCoords.push(polygonCoords[0]);
                
                const polygon = turf.polygon([polygonCoords]);
                
                if (turf.booleanPointInPolygon(point, polygon)) {
                    matchingProjects.push({
                        projectName: boundary.project_name,
                        projectCode: boundary.project_code,
                        projectArea: boundary.project_area
                    });
                }
            } catch (e) {
                // 忽略無效的多邊形
                console.warn(`[project_boundaries] 無效的多邊形: ${boundary.project_name}`);
            }
        }
        
        res.json({ 
            success: true, 
            projects: matchingProjects,
            count: matchingProjects.length
        });
    } catch (err) {
        console.error('[project_boundaries] 查找專案錯誤:', err);
        res.status(500).json({ success: false, message: '查找專案失敗' });
    }
});

/**
 * 批次檢查座標並自動匹配專案
 * POST /api/project_boundaries/batch_match
 * 
 * Body:
 * {
 *   trees: [{ lat: number, lng: number, index?: number }, ...]
 * }
 * 
 * 用於 BLE 批次匯入時自動填入專案名稱
 */
router.post('/batch_match', projectAuthFilter, async (req, res) => {
    const { trees } = req.body;
    
    if (!trees || !Array.isArray(trees)) {
        return res.status(400).json({ 
            success: false, 
            message: '請提供樹木座標陣列' 
        });
    }
    
    try {
        let boundaryQuery =
            'SELECT project_name, project_code, project_area, boundary_coordinates FROM project_boundaries';
        const boundaryParams = [];
        if (req.projectFilter != null) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, projects: [], count: 0 });
            }
            boundaryQuery += ' WHERE project_code = ANY($1::text[])';
            boundaryParams.push(req.projectFilter);
        }
        const { rows: allBoundaries } = await db.query(boundaryQuery, boundaryParams);
        
        // 預處理所有多邊形
        const polygons = [];
        for (const boundary of allBoundaries) {
            const coordinates = typeof boundary.boundary_coordinates === 'string'
                ? JSON.parse(boundary.boundary_coordinates)
                : boundary.boundary_coordinates;
            
            try {
                const polygonCoords = coordinates.map(c => [c[1], c[0]]);
                polygonCoords.push(polygonCoords[0]);
                
                polygons.push({
                    projectName: boundary.project_name,
                    projectCode: boundary.project_code,
                    projectArea: boundary.project_area,
                    polygon: turf.polygon([polygonCoords])
                });
            } catch (e) {
                // 忽略無效的多邊形
            }
        }
        
        // 匹配每棵樹
        const results = trees.map((tree, idx) => {
            const { lat, lng, index } = tree;
            const treeIndex = index !== undefined ? index : idx;
            
            if (lat === undefined || lng === undefined) {
                return {
                    index: treeIndex,
                    matched: false,
                    reason: '座標缺失'
                };
            }
            
            const point = turf.point([lng, lat]);
            const matchedProjects = [];
            
            for (const { projectName, projectCode, projectArea, polygon } of polygons) {
                if (turf.booleanPointInPolygon(point, polygon)) {
                    matchedProjects.push({
                        projectName,
                        projectCode,
                        projectArea,
                        polygon,
                    });
                }
            }
            
            if (matchedProjects.length === 0) {
                return {
                    index: treeIndex,
                    lat,
                    lng,
                    matched: false,
                    reason: '座標不在任何專案邊界內'
                };
            }

            // 重疊邊界：取面積最小者
            matchedProjects.sort((a, b) => turf.area(a.polygon) - turf.area(b.polygon));
            const best = matchedProjects[0];
            
            if (matchedProjects.length === 1) {
                return {
                    index: treeIndex,
                    lat,
                    lng,
                    matched: true,
                    projectName: best.projectName,
                    projectCode: best.projectCode,
                    projectArea: best.projectArea
                };
            } else {
                return {
                    index: treeIndex,
                    lat,
                    lng,
                    matched: true,
                    projectName: best.projectName,
                    projectCode: best.projectCode,
                    projectArea: best.projectArea,
                    multipleMatches: matchedProjects.length,
                    allMatches: matchedProjects.map(({ projectName, projectCode, projectArea }) => ({
                        projectName, projectCode, projectArea,
                    })),
                };
            }
        });
        
        const matchedCount = results.filter(r => r.matched).length;
        
        res.json({ 
            success: true, 
            results,
            summary: {
                total: trees.length,
                matched: matchedCount,
                unmatched: trees.length - matchedCount
            }
        });
    } catch (err) {
        console.error('[project_boundaries] 批次匹配錯誤:', err);
        res.status(500).json({ success: false, message: '批次匹配失敗' });
    }
});

// ── 動態路由必須放在所有固定路徑之後（避免 /by_code/xxx 被當成 projectName）──

/**
 * 取得特定專案的邊界
 * GET /api/project_boundaries/:projectName
 */
router.get('/:projectName', projectAuthFilter, async (req, res) => {
    const { projectName } = req.params;

    try {
        const { rows } = await db.query(
            'SELECT * FROM project_boundaries WHERE project_name = $1',
            [projectName]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '找不到該專案的邊界',
                hasBoundary: false,
            });
        }

        const boundary = rows[0];
        if (req.projectFilter != null) {
            if (!boundary.project_code || !req.projectFilter.includes(boundary.project_code)) {
                return res.status(404).json({
                    success: false,
                    message: '找不到該專案的邊界',
                    hasBoundary: false,
                });
            }
        }

        res.json({
            success: true,
            data: {
                ...boundary,
                boundary_coordinates: typeof boundary.boundary_coordinates === 'string'
                    ? JSON.parse(boundary.boundary_coordinates)
                    : boundary.boundary_coordinates,
            },
            hasBoundary: true,
        });
    } catch (err) {
        console.error('[project_boundaries] 取得專案邊界錯誤:', err);
        res.status(500).json({ success: false, message: '取得專案邊界失敗' });
    }
});

/**
 * 刪除專案邊界 — 專案管理員以上
 * DELETE /api/project_boundaries/:projectName
 */
router.delete('/:projectName', requireRole('專案管理員'), async (req, res) => {
    const { projectName } = req.params;

    try {
        const { rowCount } = await db.query(
            'DELETE FROM project_boundaries WHERE project_name = $1',
            [projectName]
        );

        if (rowCount > 0) {
            res.json({ success: true, message: '專案邊界已刪除' });
        } else {
            res.status(404).json({ success: false, message: '找不到要刪除的專案邊界' });
        }
    } catch (err) {
        console.error('[project_boundaries] 刪除專案邊界錯誤:', err);
        res.status(500).json({ success: false, message: '刪除專案邊界失敗' });
    }
});

module.exports = router;
