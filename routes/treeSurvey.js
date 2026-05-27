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
const { projectAuth, projectAuthFilter } = require('../middleware/projectAuth');
const { requireRole } = require('../middleware/roleAuth');

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
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        const offset = req.query.offset ? parseInt(req.query.offset) : 0;
        const projectCode = req.query.project_code
            ? String(req.query.project_code).trim()
            : null;
        const projectName = req.query.project_name
            ? String(req.query.project_name).trim()
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
        const response = { success: true, data: rows };
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
    try {
        const { city } = req.query;
        const { resolveAreaCity, matchCity } = require('../utils/county');

        let sql = `
            SELECT DISTINCT ON (project_code, project_name)
                project_name, project_code, project_location, x_coord, y_coord
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
        sql += ' ORDER BY project_code, project_name, id ASC';
        const { rows } = await db.query(sql, params);

        const projects = [];
        const cities = new Set();
        const seen = new Set();
        for (const r of rows) {
            const resolvedCity = resolveAreaCity({
                lng: r.x_coord,
                lat: r.y_coord,
                areaName: r.project_location,
            });
            if (resolvedCity) cities.add(resolvedCity);
            if (!r.project_name) continue;

            const cityFilter = city && String(city).trim() !== '' && city !== '全部';
            if (cityFilter && !matchCity(resolvedCity, String(city).trim())) {
                continue;
            }

            const key = `${r.project_code || ''}|${r.project_name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            projects.push({
                name: r.project_name,
                code: r.project_code,
                area: r.project_location,
                city: resolvedCity,
            });
        }
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
    try {
        const { project_code, city } = req.query;
        const swLat = parseFloat(req.query.sw_lat);
        const swLng = parseFloat(req.query.sw_lng);
        const neLat = parseFloat(req.query.ne_lat);
        const neLng = parseFloat(req.query.ne_lng);
        let limit = parseInt(req.query.limit, 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 2500;
        limit = Math.min(limit, 5000);

        let sql = `
            SELECT 
                id,
                project_location AS "專案區位",
                project_code AS "專案代碼",
                project_name AS "專案名稱",
                species_name AS "樹種名稱",
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

        sql += ` ORDER BY id ASC LIMIT $${paramIdx}`;
        params.push(limit + 1);
        paramIdx++;

        const { rows } = await db.query(sql, params);
        const truncated = rows.length > limit;
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

        if (city && typeof city === 'string' && city.trim() !== '' && city !== '全部') {
            annotated = annotated.filter(r => matchCity(r._city, city));
        }

        res.json({ success: true, data: annotated, truncated, limit });
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
            res.json({ success: true, data: rows[0] });
        } else {
            res.status(404).json({ success: false, message: '找不到指定的樹木資料' });
        }
    } catch (err) {
        console.error(`獲取樹木 ID [${id}] 資料錯誤:`, err);
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

        sql += ` ORDER BY project_tree_id ASC`;
        const { rows } = await db.query(sql, params);
        res.json({ success: true, data: rows });
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

        sql += ` ORDER BY system_tree_id ASC`;
        const { rows } = await db.query(sql, params);
        // 將回應包裹在標準格式中
        res.json({ success: true, data: rows });
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
