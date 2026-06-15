const express = require('express');
const router = express.Router();
const db = require('../config/db');
const format = require('pg-format');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { cleanupUnusedSpecies, cleanupUnusedProjectAreas } = require('../utils/cleanup');
const treeSurveyBatchController = require('../controllers/treeSurveyBatchController');
const treeSurveyCreateController = require('../controllers/treeSurveyCreateController');
const treeSurveyUpdateController = require('../controllers/treeSurveyUpdateController'); // 引入新的 Update Controller
const AuditLogService = require('../services/auditLogService');
const { projectAuth, projectAuthFilter, hasProjectPermission } = require('../middleware/projectAuth');
const { requireRole } = require('../middleware/roleAuth');
const { attachDomainAliases, attachDomainAliasesList } = require('../utils/domainAliases');
const { isRetiredLifecycle } = require('../utils/treeLifecycle');

const DEBUG_MAP = process.env.DEBUG_MAP === '1' || process.env.DEBUG_MAP === 'true';
function mapApiLog(msg, extra) {
    if (!DEBUG_MAP) return;
    const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
    console.log(`[MapAPI] ${msg}${suffix}`);
}

// --- Multer 設定 (用於檔案上傳) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // __dirname 是目前檔案的路徑, 我們需要回到 backend/uploads
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
        'application/vnd.ms-excel', 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
        'text/csv'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.csv') || file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('只允許上傳Excel或CSV文件'));
    }
  }
});

// 取得所有樹木資料 (依使用者權限過濾專案)
router.get('/', projectAuthFilter, async (req, res) => {
    try {
        // 支援分頁參數
        // [審計#20] 伺服器端預設/最大上限：未帶 limit 或要求過大時 cap，
        // 防止誤用/濫用一次拉全表（前端所有呼叫本就帶 limit，行為不變）。
        const MAX_LIMIT = 2000;
        const requested = req.query.limit ? parseInt(req.query.limit) : null;
        const limit = (Number.isFinite(requested) && requested > 0)
            ? Math.min(requested, MAX_LIMIT)
            : MAX_LIMIT;
        const offset = req.query.offset ? parseInt(req.query.offset) : 0;
        const projectCode = req.query.project_code
            ? String(req.query.project_code).trim()
            : null;
        const projectName = req.query.project_name
            ? String(req.query.project_name).trim()
            : null;
        const searchQ = req.query.q
            ? String(req.query.q).trim()
            : null;

        // 使用 AS 將欄位名稱轉換為前端期望的中文名稱
        let sql = `
            SELECT 
                id,
                project_location AS "專案區位",
                project_code AS "專案代碼",
                project_name AS "專案名稱",
                system_tree_id AS "系統樹木",
                project_tree_id AS "專案樹木",
                species_id AS "樹種編號",
                species_name AS "樹種名稱",
                x_coord AS "X坐標",
                y_coord AS "Y坐標",
                status AS "狀況",
                -- 同時輸出英文正規鍵與中文 UI 別名：前端/契約優先讀英文鍵，中文別名供既有顯示相容
                lifecycle_status,
                lifecycle_status AS "生命週期",
                retired_at,
                retired_at AS "淘汰時間",
                retired_reason,
                retired_reason AS "淘汰原因",
                notes AS "註記",
                tree_notes AS "樹木備註",
                tree_height_m AS "樹高（公尺）",
                dbh_cm AS "胸徑（公分）",
                survey_notes AS "調查備註",
                survey_time AS "調查時間",
                carbon_storage AS "碳儲存量",
                carbon_sequestration_per_year AS "推估年碳吸存量",
                updated_at
            FROM tree_survey 
            WHERE (is_placeholder IS NULL OR is_placeholder = false)
        `;

        const params = [];
        let paramIdx = 1;

        // 依使用者權限過濾專案
        if (req.projectFilter) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, data: [] });
            }
            sql += ` AND project_code = ANY($${paramIdx}::text[])`;
            params.push(req.projectFilter);
            paramIdx++;
        }

        if (projectCode && projectCode !== '全部') {
            sql += ` AND project_code = $${paramIdx}`;
            params.push(projectCode);
            paramIdx++;
        } else if (projectName && projectName !== '全部') {
            sql += ` AND project_name = $${paramIdx}`;
            params.push(projectName);
            paramIdx++;
        }

        if (searchQ) {
            const like = `%${searchQ}%`;
            sql += ` AND (
                species_name ILIKE $${paramIdx}
                OR project_name ILIKE $${paramIdx}
                OR project_location ILIKE $${paramIdx}
                OR survey_notes ILIKE $${paramIdx}
                OR tree_notes ILIKE $${paramIdx}
                OR CAST(project_tree_id AS TEXT) ILIKE $${paramIdx}
                OR CAST(species_id AS TEXT) ILIKE $${paramIdx}
            )`;
            params.push(like);
            paramIdx++;
        }

        sql += ` ORDER BY id ASC`;

        // 使用參數化查詢避免 SQL injection
        if (limit && Number.isFinite(limit) && limit > 0) {
            sql += ` LIMIT $${paramIdx}`;
            params.push(limit);
            paramIdx++;
            if (Number.isFinite(offset) && offset >= 0) {
                sql += ` OFFSET $${paramIdx}`;
                params.push(offset);
                paramIdx++;
            }
        }

        const { rows } = await db.query(sql, params);
        
        // 回傳資料與分頁資訊
        const response = { success: true, data: attachDomainAliasesList(rows) };
        if (limit) {
            let countSql = `SELECT COUNT(*) FROM tree_survey WHERE (is_placeholder IS NULL OR is_placeholder = false)`;
            const countParams = [];
            let countIdx = 1;
            if (req.projectFilter && req.projectFilter.length > 0) {
                countSql += ` AND project_code = ANY($${countIdx}::text[])`;
                countParams.push(req.projectFilter);
                countIdx++;
            }
            if (projectCode && projectCode !== '全部') {
                countSql += ` AND project_code = $${countIdx}`;
                countParams.push(projectCode);
                countIdx++;
            } else if (projectName && projectName !== '全部') {
                countSql += ` AND project_name = $${countIdx}`;
                countParams.push(projectName);
                countIdx++;
            }
            if (searchQ) {
                const like = `%${searchQ}%`;
                countSql += ` AND (
                    species_name ILIKE $${countIdx}
                    OR project_name ILIKE $${countIdx}
                    OR project_location ILIKE $${countIdx}
                    OR survey_notes ILIKE $${countIdx}
                    OR tree_notes ILIKE $${countIdx}
                    OR CAST(project_tree_id AS TEXT) ILIKE $${countIdx}
                    OR CAST(species_id AS TEXT) ILIKE $${countIdx}
                )`;
                countParams.push(like);
                countIdx++;
            }
            const countResult = await db.query(countSql, countParams);
            response.totalCount = parseInt(countResult.rows[0].count, 10);
            response.limit = limit;
            response.offset = offset;
        }
        res.json(response);
    } catch (err) {
        console.error('獲取所有樹木資料錯誤:', err);
        res.status(500).json({ success: false, message: '查詢資料庫時發生錯誤' });
    }
});

// [優化] 地圖專用精簡 API (依使用者權限過濾)
// Query: project_code, city, sw_lat, sw_lng, ne_lat, ne_lng, limit (default 2500, max 5000)
router.get('/map/meta', projectAuthFilter, async (req, res) => {
    const t0 = Date.now();
    try {
        const { city } = req.query;
        mapApiLog('meta request', { city, projectFilter: req.projectFilter?.length ?? 'all' });
        const { resolveAreaCity, matchCity } = require('../utils/county');

        let sql = `
            SELECT project_name, project_code, project_location, x_coord, y_coord
            FROM tree_survey
            WHERE (is_placeholder IS NULL OR is_placeholder = false)
              AND x_coord IS NOT NULL AND y_coord IS NOT NULL
              AND x_coord != 0 AND y_coord != 0
        `;
        const params = [];
        if (req.projectFilter) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, projects: [], cities: [], totalTrees: 0 });
            }
            sql += ' AND project_code = ANY($1::text[])';
            params.push(req.projectFilter);
        }
        const { rows } = await db.query(sql, params);

        const cityTrim = city && String(city).trim() !== '' && city !== '全部'
            ? String(city).trim()
            : null;
        const projectAgg = new Map();
        const cities = new Set();
        for (const r of rows) {
            const resolvedCity = resolveAreaCity({
                lng: r.x_coord,
                lat: r.y_coord,
                areaName: r.project_location,
            });
            if (resolvedCity) cities.add(resolvedCity);
            if (!r.project_name) continue;

            const key = `${r.project_code || ''}|${r.project_name}`;
            if (!projectAgg.has(key)) {
                projectAgg.set(key, {
                    name: r.project_name,
                    code: r.project_code,
                    area: r.project_location,
                    hasCityMatch: false,
                });
            }
            if (!cityTrim || matchCity(resolvedCity, cityTrim)) {
                projectAgg.get(key).hasCityMatch = true;
            }
        }

        const projects = [];
        for (const p of projectAgg.values()) {
            if (cityTrim && !p.hasCityMatch) continue;
            projects.push({
                name: p.name,
                code: p.code,
                area: p.area,
            });
        }
        projects.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
        // 輕量 count
        let countSql = `SELECT COUNT(*) FROM tree_survey
            WHERE (is_placeholder IS NULL OR is_placeholder = false)
              AND x_coord IS NOT NULL AND y_coord IS NOT NULL
              AND x_coord != 0 AND y_coord != 0`;
        const countParams = [];
        if (req.projectFilter && req.projectFilter.length > 0) {
            countSql += ' AND project_code = ANY($1::text[])';
            countParams.push(req.projectFilter);
        }
        const countRes = await db.query(countSql, countParams);
        // 若未指定 city，補充從 area 名稱解析的縣市（相容舊資料）
        if (!city || city === '全部') {
            for (const r of rows.slice(0, 500)) {
                const c = resolveAreaCity({
                    lng: r.x_coord,
                    lat: r.y_coord,
                    areaName: r.project_location,
                });
                if (c) cities.add(c);
            }
        }
        mapApiLog('meta response', {
            projects: projects.length,
            cities: cities.size,
            totalTrees: parseInt(countRes.rows[0].count, 10),
            ms: Date.now() - t0,
        });
        res.json({
            success: true,
            projects,
            cities: [...cities],
            totalTrees: parseInt(countRes.rows[0].count, 10),
        });
    } catch (err) {
        console.error('地圖 meta 錯誤:', err);
        res.status(500).json({ success: false, message: '查詢資料庫時發生錯誤' });
    }
});

router.get('/map', projectAuthFilter, async (req, res) => {
    const t0 = Date.now();
    try {
        const { project_code, city } = req.query;
        mapApiLog('map request', {
            project_code,
            city,
            sw_lat: req.query.sw_lat,
            sw_lng: req.query.sw_lng,
            ne_lat: req.query.ne_lat,
            ne_lng: req.query.ne_lng,
            limit: req.query.limit,
        });
        const swLat = parseFloat(req.query.sw_lat);
        const swLng = parseFloat(req.query.sw_lng);
        const neLat = parseFloat(req.query.ne_lat);
        const neLng = parseFloat(req.query.ne_lng);
        // [審計#5] 未傳 limit 時預設 cap 20000（防資料成長後一次全量拖垮 API；
        // 現有資料 ~7k 不受影響，超出時回 truncated=true 供前端提示）。
        const MAP_MAX_LIMIT = 20000;
        let limit = MAP_MAX_LIMIT;
        if (req.query.limit !== undefined && req.query.limit !== '') {
            const parsed = parseInt(req.query.limit, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                limit = Math.min(parsed, MAP_MAX_LIMIT);
            }
        }

        let sql = `
            SELECT 
                id,
                project_location AS "專案區位",
                project_code AS "專案代碼",
                project_name AS "專案名稱",
                species_name AS "樹種名稱",
                -- 同時輸出英文正規鍵與中文 UI 別名（前端地圖優先讀 lifecycle_status）
                lifecycle_status,
                lifecycle_status AS "生命週期",
                x_coord AS "X坐標",
                y_coord AS "Y坐標"
            FROM tree_survey 
            WHERE x_coord IS NOT NULL 
              AND y_coord IS NOT NULL 
              AND x_coord != 0 
              AND y_coord != 0
              AND (is_placeholder IS NULL OR is_placeholder = false)
        `;
        const params = [];
        let paramIdx = 1;

        if (req.projectFilter) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, data: [], truncated: false });
            }
            sql += ` AND project_code = ANY($${paramIdx}::text[])`;
            params.push(req.projectFilter);
            paramIdx++;
        }

        if (project_code && String(project_code).trim() !== '' && project_code !== '全部') {
            sql += ` AND project_code = $${paramIdx}`;
            params.push(String(project_code).trim());
            paramIdx++;
        }

        const cityTrim = city && typeof city === 'string' && city.trim() !== '' && city !== '全部'
            ? city.trim()
            : null;
        if (cityTrim) {
            const { getCountyBboxForCandidate } = require('../utils/geo');
            const countyBbox = getCountyBboxForCandidate(cityTrim);
            if (countyBbox) {
                sql += ` AND y_coord BETWEEN $${paramIdx} AND $${paramIdx + 1}
                         AND x_coord BETWEEN $${paramIdx + 2} AND $${paramIdx + 3}`;
                params.push(countyBbox.minLat, countyBbox.maxLat, countyBbox.minLng, countyBbox.maxLng);
                paramIdx += 4;
            }
        }

        if (Number.isFinite(swLat) && Number.isFinite(swLng)
            && Number.isFinite(neLat) && Number.isFinite(neLng)) {
            const minLat = Math.min(swLat, neLat);
            const maxLat = Math.max(swLat, neLat);
            const minLng = Math.min(swLng, neLng);
            const maxLng = Math.max(swLng, neLng);
            sql += ` AND y_coord BETWEEN $${paramIdx} AND $${paramIdx + 1}
                     AND x_coord BETWEEN $${paramIdx + 2} AND $${paramIdx + 3}`;
            params.push(minLat, maxLat, minLng, maxLng);
            paramIdx += 4;
        }

        sql += ' ORDER BY id ASC';
        if (limit != null) {
            sql += ` LIMIT $${paramIdx}`;
            params.push(limit + 1);
            paramIdx++;
        }

        const { rows } = await db.query(sql, params);
        const truncated = limit != null && rows.length > limit;
        const dataRows = truncated ? rows.slice(0, limit) : rows;

        const { resolveAreaCity, matchCity } = require('../utils/county');
        let annotated = dataRows.map(r => ({
            ...r,
            _city: resolveAreaCity({
                lng: r['X坐標'],
                lat: r['Y坐標'],
                areaName: r['專案區位'],
            }),
        }));

        if (cityTrim) {
            annotated = annotated.filter(r => matchCity(r._city, cityTrim));
        }

        mapApiLog('map response', {
            rows: dataRows.length,
            returned: annotated.length,
            truncated,
            limit,
            city: cityTrim,
            ms: Date.now() - t0,
        });

        res.json({
            success: true,
            data: annotated,
            truncated,
            limit,
            filter: {
                project_code: project_code || null,
                city: cityTrim,
            },
        });
    } catch (err) {
        console.error('獲取地圖樹木資料錯誤:', err);
        res.status(500).json({ success: false, message: '查詢資料庫時發生錯誤' });
    }
});

// [V2 NEW] 根據 ID 獲取單筆樹木資料 (依使用者權限過濾)
router.get('/by_id/:id', projectAuthFilter, async (req, res) => {
    const { id } = req.params;
    try {
        let sql = `
            SELECT 
                id,
                project_location AS "專案區位",
                project_code AS "專案代碼",
                project_name AS "專案名稱",
                system_tree_id AS "系統樹木",
                project_tree_id AS "專案樹木",
                species_id AS "樹種編號",
                species_name AS "樹種名稱",
                x_coord AS "X坐標",
                y_coord AS "Y坐標",
                status AS "狀況",
                -- 同時輸出英文正規鍵與中文 UI 別名：前端/契約優先讀英文鍵，中文別名供既有顯示相容
                lifecycle_status,
                lifecycle_status AS "生命週期",
                retired_at,
                retired_at AS "淘汰時間",
                retired_reason,
                retired_reason AS "淘汰原因",
                notes AS "註記",
                tree_notes AS "樹木備註",
                tree_height_m AS "樹高（公尺）",
                dbh_cm AS "胸徑（公分）",
                survey_notes AS "調查備註",
                survey_time AS "調查時間",
                carbon_storage AS "碳儲存量",
                carbon_sequestration_per_year AS "推估年碳吸存量",
                updated_at
            FROM tree_survey 
            WHERE id = $1
        `;
        const params = [id];
        let paramIdx = 2;

        // 依使用者權限過濾
        if (req.projectFilter) {
            if (req.projectFilter.length === 0) {
                return res.status(403).json({ success: false, message: '無權限查看此資料' });
            }
            sql += ` AND project_code = ANY($${paramIdx}::text[])`;
            params.push(req.projectFilter);
        }

        const { rows } = await db.query(sql, params);
        if (rows.length > 0) {
            res.json({ success: true, data: attachDomainAliases(rows[0]) });
        } else {
            res.status(404).json({ success: false, message: '找不到指定的樹木資料' });
        }
    } catch (err) {
        console.error(`獲取樹木 ID [${id}] 資料錯誤:`, err);
        res.status(500).json({ success: false, message: '查詢資料庫時發生錯誤' });
    }
});

// 歷次量測紀錄（最新在上）— 須在動態 :id 路由之前
router.get('/by_id/:id/measurements', projectAuthFilter, async (req, res) => {
    const { id } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    try {
        const treeRes = await db.query(
            'SELECT id, project_code FROM tree_survey WHERE id = $1',
            [id],
        );
        if (treeRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: '找不到指定的樹木資料' });
        }

        const row = treeRes.rows[0];
        if (req.projectFilter != null) {
            if (req.projectFilter.length === 0) {
                return res.status(403).json({ success: false, message: '無權限查看此資料' });
            }
            if (!row.project_code || !req.projectFilter.includes(row.project_code)) {
                return res.status(403).json({ success: false, message: '無權限查看此資料' });
            }
        }

        const countRes = await db.query(
            'SELECT COUNT(*)::int AS total FROM tree_survey_measurements WHERE tree_id = $1',
            [id],
        );
        const total = countRes.rows[0]?.total ?? 0;

        const histRes = await db.query(`
            SELECT
                id,
                tree_id,
                pending_id,
                survey_time,
                tree_height_m,
                dbh_cm,
                species_name,
                species_id,
                status,
                survey_notes,
                carbon_storage,
                x_coord,
                y_coord,
                survey_mode,
                instrument_type,
                instrument_dbh_cm,
                created_at
            FROM tree_survey_measurements
            WHERE tree_id = $1
            ORDER BY survey_time DESC, id DESC
            LIMIT $2 OFFSET $3
        `, [id, limit, offset]);

        res.json({
            success: true,
            tree_id: parseInt(id, 10),
            count: histRes.rows.length,
            total,
            offset,
            limit,
            data: histRes.rows,
        });
    } catch (err) {
        console.error(`獲取樹木 ID [${id}] 歷次量測錯誤:`, err);
        res.status(500).json({ success: false, message: '查詢資料庫時發生錯誤' });
    }
});

// 根據專案名稱或專案代碼獲取樹木 (依使用者權限過濾)
// [P3 / Bug 3] 改成 name OR code 解析：
//   - 透過 projects 表把 name → code，避免 projects.name='X（B1）'
//     vs tree_survey.project_name='X' 字串漂移時整段查不到
//   - 保留直接 project_name 比對當 fallback (相容沒 projects 列的歷史資料)
router.get('/by_project/:projectNameOrCode', projectAuthFilter, async (req, res) => {
    const { projectNameOrCode } = req.params;
    try {
        let sql = `
            SELECT 
                id,
                project_location AS "專案區位",
                project_code AS "專案代碼",
                project_name AS "專案名稱",
                system_tree_id AS "系統樹木",
                project_tree_id AS "專案樹木",
                species_id AS "樹種編號",
                species_name AS "樹種名稱",
                x_coord AS "X坐標",
                y_coord AS "Y坐標",
                status AS "狀況",
                notes AS "註記",
                tree_notes AS "樹木備註",
                tree_height_m AS "樹高（公尺）",
                dbh_cm AS "胸徑（公分）",
                survey_notes AS "調查備註",
                survey_time AS "調查時間",
                carbon_storage AS "碳儲存量",
                carbon_sequestration_per_year AS "推估年碳吸存量",
                updated_at
            FROM tree_survey 
            WHERE (
                project_code IN (
                    SELECT project_code FROM projects
                    WHERE name = $1 OR project_code = $1
                )
                OR project_name = $1
            )
              AND (is_placeholder IS NULL OR is_placeholder = false)
              AND species_name != '__PLACEHOLDER__'
              AND species_name != '預設樹種'
        `;
        const params = [projectNameOrCode];
        let paramIdx = 2;

        if (req.projectFilter) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, data: [] });
            }
            sql += ` AND project_code = ANY($${paramIdx}::text[])`;
            params.push(req.projectFilter);
        }

        // [稽核#9] 伺服器端上限，避免單一專案巨量列拖垮回應
        const limit = Math.min(
            Math.max(parseInt(req.query.limit, 10) || 2000, 1),
            2000
        );
        sql += ` ORDER BY project_tree_id ASC LIMIT $${params.length + 1}`;
        params.push(limit + 1);

        const { rows } = await db.query(sql, params);
        const truncated = rows.length > limit;
        res.json({
            success: true,
            data: truncated ? rows.slice(0, limit) : rows,
            truncated,
        });
    } catch (err) {
        console.error(`獲取專案 [${projectNameOrCode}] 的樹木資料錯誤:`, err);
        res.status(500).json({ success: false, message: '查詢資料庫時發生錯誤' });
    }
});

// 根據區位名稱獲取樹木 (依使用者權限過濾)
router.get('/by_area/:areaName', projectAuthFilter, async (req, res) => {
    const { areaName } = req.params;
    try {
        let sql = `
            SELECT 
                id,
                project_location AS "專案區位",
                project_code AS "專案代碼",
                project_name AS "專案名稱",
                system_tree_id AS "系統樹木",
                project_tree_id AS "專案樹木",
                species_id AS "樹種編號",
                species_name AS "樹種名稱",
                x_coord AS "X坐標",
                y_coord AS "Y坐標",
                status AS "狀況",
                notes AS "註記",
                tree_notes AS "樹木備註",
                tree_height_m AS "樹高（公尺）",
                dbh_cm AS "胸徑（公分）",
                survey_notes AS "調查備註",
                survey_time AS "調查時間",
                carbon_storage AS "碳儲存量",
                carbon_sequestration_per_year AS "推估年碳吸存量",
                updated_at
            FROM tree_survey 
            WHERE project_location = $1
        `;
        const params = [areaName];
        let paramIdx = 2;

        if (req.projectFilter) {
            if (req.projectFilter.length === 0) {
                return res.json({ success: true, data: [] });
            }
            sql += ` AND project_code = ANY($${paramIdx}::text[])`;
            params.push(req.projectFilter);
        }

        // [稽核#9] 伺服器端上限，避免單一區位巨量列拖垮回應
        const limit = Math.min(
            Math.max(parseInt(req.query.limit, 10) || 2000, 1),
            2000
        );
        sql += ` ORDER BY system_tree_id ASC LIMIT $${params.length + 1}`;
        params.push(limit + 1);

        const { rows } = await db.query(sql, params);
        const truncated = rows.length > limit;
        // 將回應包裹在標準格式中
        res.json({
            success: true,
            data: truncated ? rows.slice(0, limit) : rows,
            truncated,
        });
    } catch (err) {
        console.error(`獲取區位 [${areaName}] 的樹木資料錯誤:`, err);
        res.status(500).json({ success: false, message: '查詢資料庫時發生錯誤' });
    }
});

// --- Batch Import Route (v2) ---
router.post('/batch_import', requireRole('調查管理員'), projectAuth, treeSurveyBatchController.batchImportTrees);

// --- Single Create Route (v2) - For manual input with server-side ID generation ---
router.post('/create_v2', requireRole('調查管理員'), projectAuth, treeSurveyCreateController.createTreeV2);

// [T6 cleanup] V1 POST /tree_survey (Chinese-key payload) 已移除；前端統一走 create_v2

// --- Single Update Route (v2) ---
router.put('/update_v2/:id', requireRole('調查管理員'), projectAuth, treeSurveyUpdateController.updateTreeV2);

// [T6 cleanup] V1 PUT /tree_survey/:id (Chinese-key payload) 已移除；前端統一走 update_v2


// [NEW] 刪除指定的佔位樹木記錄 — 專案管理員以上 + 專案權限
router.delete('/placeholder/:id', requireRole('專案管理員'), projectAuth, async (req, res) => {
    const { id } = req.params;
    try {
        // 使用 is_placeholder 欄位而非 species_name 來判斷佔位記錄
        const sql = `
            DELETE FROM tree_survey 
            WHERE id = $1 AND (is_placeholder = true OR species_name = '__PLACEHOLDER__' OR species_name = '預設樹種')
        `;
        const { rowCount } = await db.query(sql, [id]);
        
        if (rowCount > 0) {
            res.json({ success: true, message: '指定的佔位紀錄已成功刪除' });
        } else {
            // 這不是一個錯誤，可能紀錄已經被編輯或已被其他程序清理
            res.status(200).json({ success: true, message: '指定的佔位紀錄不存在或已被編輯' });
        }
    } catch (err) {
        console.error(`刪除佔位紀錄 (ID: ${id}) 錯誤:`, err);
        res.status(500).json({ success: false, message: '刪除佔位紀錄時發生錯誤' });
    }
});

// 刪除樹木資料 (專案管理員以上 + 專案權限)
router.delete('/:id', requireRole('專案管理員'), projectAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const { rowCount } = await db.query('DELETE FROM tree_survey WHERE id = $1', [id]);
        if (rowCount > 0) {
            await AuditLogService.log({
                userId: req.user?.user_id,
                username: req.user?.username,
                action: 'DELETE_TREE',
                resourceType: 'tree_survey',
                resourceId: id,
                req
            });

            res.json({ success: true, message: '樹木資料刪除成功' });

            // 在回應發送後，異步執行清理任務
            // "Fire-and-forget"
            cleanupUnusedSpecies();
            cleanupUnusedProjectAreas();

        } else {
            res.status(404).json({ success: false, message: '找不到指定的樹木資料' });
        }
    } catch (err) {
        console.error('刪除樹木資料錯誤:', err);
        res.status(500).json({ success: false, message: '刪除樹木資料失敗' });
    }
});


// 淘汰木健康狀態文字對照（lifecycle_status -> status）
const RETIRE_STATUS_TEXT = { dead: '枯死', fallen: '倒塌', removed: '已移除' };

// 將樹木標記為已淘汰（枯死/倒塌/移除）— 調查管理員以上 + 專案權限
// 不刪除資料：保留歷史與照片，僅排除活立木碳匯與維護待辦，地圖灰階顯示，可復原。
// 採 調查管理員：與維護量測流程一致（現場人員回報枯死/倒塌/移除即可淘汰），低於 DELETE 的 專案管理員。
router.post('/:id/retire', requireRole('調查管理員'), projectAuth, async (req, res) => {
    const { id } = req.params;
    const lifecycle = String(req.body?.lifecycle_status || '').trim();
    const note = (req.body?.note != null) ? String(req.body.note).trim() : '';
    if (!isRetiredLifecycle(lifecycle)) {
        return res.status(400).json({ success: false, message: 'lifecycle_status 必須為 dead / fallen / removed' });
    }
    try {
        const reasonText = note || RETIRE_STATUS_TEXT[lifecycle];
        const sql = `
            UPDATE tree_survey
            SET lifecycle_status = $2,
                retired_at = NOW(),
                retired_reason = $3,
                status = $4
            WHERE id = $1
            RETURNING id
        `;
        const { rowCount } = await db.query(sql, [id, lifecycle, reasonText, RETIRE_STATUS_TEXT[lifecycle]]);
        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: '找不到指定的樹木資料' });
        }
        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'RETIRE_TREE',
            resourceType: 'tree_survey',
            resourceId: id,
            details: { lifecycle_status: lifecycle, reason: reasonText },
            req
        });
        res.json({ success: true, message: '已標記為淘汰（不計入活立木碳匯）' });
    } catch (err) {
        console.error(`淘汰樹木 (ID: ${id}) 錯誤:`, err);
        res.status(500).json({ success: false, message: '標記淘汰時發生錯誤' });
    }
});

// 復原樹木為「存活」狀態 — 調查管理員以上 + 專案權限
router.post('/:id/restore', requireRole('調查管理員'), projectAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const sql = `
            UPDATE tree_survey
            SET lifecycle_status = 'active',
                retired_at = NULL,
                retired_reason = NULL,
                status = '正常'
            WHERE id = $1
            RETURNING id
        `;
        const { rowCount } = await db.query(sql, [id]);
        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: '找不到指定的樹木資料' });
        }
        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'RESTORE_TREE',
            resourceType: 'tree_survey',
            resourceId: id,
            req
        });
        res.json({ success: true, message: '已復原為存活（重新計入活立木碳匯）' });
    } catch (err) {
        console.error(`復原樹木 (ID: ${id}) 錯誤:`, err);
        res.status(500).json({ success: false, message: '復原時發生錯誤' });
    }
});


// 獲取下一個系統樹木編號
// [T7] 加 requireRole：避免 Lvl 1 探測 ID 序列
router.get('/next_system_number', requireRole('調查管理員'), async (req, res) => {
    try {
        // [FIX v17.1] 排除佔位記錄 (PLACEHOLDER-*) 以確保 ID 序列正確
        const query = `
            SELECT MAX(CAST(regexp_replace(system_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id 
            FROM tree_survey 
            WHERE (system_tree_id ~ '^ST-[0-9]+$')
            AND (is_placeholder IS NULL OR is_placeholder = false);
        `;
        const { rows } = await db.query(query);
        const maxId = rows[0].max_id || 0;
        res.json({ success: true, nextNumber: maxId + 1 });
    } catch (err) {
        console.error('獲取下一個系統樹木編號錯誤:', err);
        res.status(500).json({ success: false, message: '獲取編號時發生錯誤' });
    }
});

// 獲取下一個專案樹木編號（根據專案代碼）
// [T7] 加 requireRole + projectAuth：避免偵察別專案 ID
router.get('/next_project_number/:projectCode', requireRole('調查管理員'), async (req, res, next) => {
    // 把 :projectCode 暴露給 projectAuth 用
    req.params.project_code = req.params.projectCode;
    next();
}, projectAuth, async (req, res) => {
    const { projectCode } = req.params;
    try {
        // [FIX v17.1] 排除佔位記錄 (PT-0) 以確保第一筆實際資料為 PT-1
        const query = `
            SELECT MAX(CAST(regexp_replace(project_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id 
            FROM tree_survey 
            WHERE project_code = $1 
            AND (project_tree_id ~ '^PT-[0-9]+$' OR project_tree_id ~ '^[0-9]+$')
            AND project_tree_id != 'PT-0'
            AND (is_placeholder IS NULL OR is_placeholder = false);
        `;
        const { rows } = await db.query(query, [projectCode]);
        const maxId = rows[0].max_id || 0;
        res.json({ success: true, nextNumber: maxId + 1 });
    } catch (err) {
        console.error(`獲取專案 ${projectCode} 的下一個樹木編號錯誤:`, err);
        res.status(500).json({ success: false, message: '獲取編號時發生錯誤' });
    }
});

// 獲取專案的常見樹種
// [T7] 加 projectAuth：避免低權限看別專案常見樹種統計
router.get('/common_species/:projectCode', async (req, res, next) => {
    req.params.project_code = req.params.projectCode;
    next();
}, projectAuth, async (req, res) => {
    const { projectCode } = req.params;
    const query = `
      SELECT 
        species_id AS "樹種編號", 
        species_name AS "樹種名稱", 
        COUNT(*) as count
      FROM tree_survey
      WHERE project_code = $1
      GROUP BY species_id, species_name
      ORDER BY count DESC
      LIMIT 5;
    `;
    try {
        const { rows } = await db.query(query, [projectCode]);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('獲取常見樹種錯誤:', err);
        res.status(500).json({ success: false, message: '獲取常見樹種時發生錯誤' });
    }
});


// 批量匯入 (調查管理員以上)
// [T7] 升級為專案管理員：CSV 可橫跨專案，避免低權限使用者匯入別專案資料
router.post('/import', requireRole('專案管理員'), upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '請選擇要上傳的文件' });
    }

    const client = await db.pool.connect();
    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            return res.status(400).json({ success: false, message: '文件中沒有數據' });
        }

        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(1)');

        const projectCodes = [...new Set(
            data.map((r) => r['專案代碼']).filter((c) => c && c !== '無')
        )];
        if (req.user.role !== '系統管理員' && req.user.role !== '業務管理員') {
            for (const code of projectCodes) {
                const allowed = await hasProjectPermission(req.user.user_id, code, req.user.role);
                if (!allowed) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({
                        success: false,
                        message: `權限不足：無法匯入專案 ${code}`,
                    });
                }
            }
        }

        let successCount = 0;
        const errors = [];

        const sql = `
            INSERT INTO tree_survey 
            (project_location, project_code, project_name, system_tree_id, project_tree_id, species_id, 
            species_name, x_coord, y_coord, status, notes, tree_notes, tree_height_m, 
            dbh_cm, survey_notes, survey_time, carbon_storage, carbon_sequestration_per_year) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `;

        for (const row of data) {
            const values = [
                row['專案區位'] || '無',
                row['專案代碼'] || '無',
                row['專案名稱'] || '無',
                row['系統樹木']?.toString() || '0',
                row['專案樹木']?.toString() || '0',
                row['樹種編號'] || '無',
                row['樹種名稱'] || '無',
                parseFloat(row['X坐標']) || 0,
                parseFloat(row['Y坐標']) || 0,
                row['狀況'] || '無',
                row['註記'] || '無',
                row['樹木備註'] || '無',
                parseFloat(row['樹高（公尺）']) || 0,
                parseFloat(row['胸徑（公分）']) || 0,
                row['調查備註'] || '無',
                row['調查時間'] ? new Date(row['調查時間']) : new Date(),
                parseFloat(row['碳儲存量']) || 0,
                parseFloat(row['推估年碳吸存量']) || 0
            ];
            
            try {
                await client.query(sql, values);
                successCount++;
            } catch (err) {
                errors.push({ row: row, error: err.message });
            }
        }

        if (errors.length > 0) {
            await client.query('ROLLBACK');
            res.status(400).json({
                success: false,
                message: `導入失敗 ${errors.length} 條記錄，已全部復原。`,
                details: {
                    errorCount: errors.length,
                    errors: errors.slice(0, 10)
                }
            });
        } else {
            await client.query('COMMIT');
            res.json({
                success: true,
                message: `成功導入 ${successCount} 條記錄。`,
                details: {
                    successCount,
                    errorCount: 0
                }
            });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('批量導入錯誤:', error);
        res.status(500).json({ success: false, message: '批量導入時發生錯誤', error: error.message });
    } finally {
        client.release();
        // 刪除臨時文件
        fs.unlink(req.file.path, (err) => {
            if (err) console.error("刪除上傳文件失敗:", err);
        });
    }
});


// 下載模板 (從 index_4.js 遷移)
router.get('/template', (req, res) => {
    const templatePath = path.join(__dirname, '..', 'data', 'tree_survey_template.xlsx');
  
    if (!fs.existsSync(templatePath)) {
        // 如果模板不存在，創建一個
        const workbook = xlsx.utils.book_new();
        const templateData = [{
            '專案區位': '範例區域', '專案代碼': 'P001', '專案名稱': '範例專案',
            '系統樹木': 'T001', '專案樹木': 'PT001', '樹種編號': 'S001',
            '樹種名稱': '臺灣欒樹', 'X坐標': 121.5, 'Y坐標': 25.0,
            '狀況': '健康', '註記': '', '樹木備註': '',
            '樹高（公尺）': 5.5, '胸徑（公分）': 20.0, '調查備註': '',
            '調查時間': new Date().toISOString(), '碳儲存量': 50.5, '推估年碳吸存量': 10.2
        }];
        const worksheet = xlsx.utils.json_to_sheet(templateData);
        xlsx.utils.book_append_sheet(workbook, worksheet, '樹木調查模板');
        
        try {
            xlsx.writeFile(workbook, templatePath);
        } catch (e) {
            console.error("創建模板文件失敗:", e);
            return res.status(500).send("無法創建模板文件");
        }
    }
  
    res.download(templatePath, '樹木調查模板.xlsx', (err) => {
        if (err) {
            console.error("下載模板失敗:", err);
            res.status(500).send("無法下載模板");
        }
    });
});


module.exports = router;
