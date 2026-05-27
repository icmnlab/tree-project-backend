/**
 * 待測量樹木 API 路由
 * 
 * 處理 VLGEO2 數據的暫存和第二階段 DBH 測量
 * 
 * 資料表：pending_tree_measurements
 * 功能：
 * 1. 批量創建待測量記錄
 * 2. 獲取測量批次列表
 * 3. 獲取待測量樹木列表
 * 4. 更新測量結果
 * 5. 轉移已完成數據到 tree_survey
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const pool = db.pool;
const { projectAuthFilter, hasProjectPermission } = require('../middleware/projectAuth');
const carbonCalculationService = require('../services/carbonCalculationService');
const requestIdDedup = require('../middleware/requestIdDedup');

// 內部小工具：把 req.projectFilter 套用到 SQL
// 回傳 { clause, params, nextIdx }
function applyProjectFilter(req, baseParamIdx) {
    const filter = req.projectFilter;
    if (filter == null) {
        return { clause: '', params: [], nextIdx: baseParamIdx };
    }
    if (filter.length === 0) {
        // 強制 0 = 1 永遠空集
        return { clause: ' AND 1=0', params: [], nextIdx: baseParamIdx };
    }
    return {
        clause: ` AND project_code = ANY($${baseParamIdx}::text[])`,
        params: [filter],
        nextIdx: baseParamIdx + 1,
    };
}

function parseRawDataSnapshot(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return {};
    }
  }
  return {};
}

function rawValue(row, key) {
  return parseRawDataSnapshot(row.raw_data_snapshot)[key];
}

function effectiveGpsSource(row) {
  return row.gps_source || rawValue(row, 'gps_source') || 'surveyor';
}

function effectiveSurveyMode(row) {
  return row.survey_mode || rawValue(row, 'survey_mode') || 'new';
}

function effectiveTargetTreeId(row) {
  return row.target_tree_id || rawValue(row, 'target_tree_id') || null;
}

function effectiveRawNumber(row, key, fallback = null) {
  const value = rawValue(row, key);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


/**
 * 初始化資料表 (如果不存在)
 */
async function initTable() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS pending_tree_measurements (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(50) NOT NULL,
      original_record_id VARCHAR(50),
      
      -- 專案資訊
      project_area VARCHAR(255),
      project_code VARCHAR(50),
      project_name VARCHAR(255),
      
      -- 樹木基本資料
      species_name VARCHAR(100),
      tree_height DOUBLE PRECISION NOT NULL,
      dbh_cm DOUBLE PRECISION,
      
      -- 樹木位置
      tree_latitude DOUBLE PRECISION NOT NULL,
      tree_longitude DOUBLE PRECISION NOT NULL,
      
      -- 測站位置
      station_latitude DOUBLE PRECISION NOT NULL,
      station_longitude DOUBLE PRECISION NOT NULL,
      
      -- VLGEO2 測量數據
      horizontal_distance DOUBLE PRECISION NOT NULL,
      slope_distance DOUBLE PRECISION NOT NULL,
      azimuth DOUBLE PRECISION NOT NULL,
      pitch DOUBLE PRECISION NOT NULL,
      altitude DOUBLE PRECISION,
      measurement_type VARCHAR(10),
      
      -- 狀態資訊
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      assigned_to VARCHAR(100),
      priority INTEGER DEFAULT 3,
      
      -- AR 測量結果
      measured_dbh_cm DOUBLE PRECISION,
      measurement_confidence DOUBLE PRECISION,
      measurement_method VARCHAR(50),
      measurement_notes TEXT,

      -- 任務語意
      survey_mode VARCHAR(20) DEFAULT 'new',
      target_tree_id BIGINT,
      match_status VARCHAR(30),
      gps_source VARCHAR(30),
      tree_position_source VARCHAR(50),
      station_position_source VARCHAR(50),
      
      -- 索引
      CONSTRAINT valid_status CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed', 'transferred'))
    );
    
    -- 創建索引
    CREATE INDEX IF NOT EXISTS idx_pending_session ON pending_tree_measurements(session_id);
    CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_tree_measurements(status);
    CREATE INDEX IF NOT EXISTS idx_pending_location ON pending_tree_measurements(tree_latitude, tree_longitude);
  `;
  
  try {
    await pool.query(createTableSQL);
    console.log('[pending-measurements] 資料表初始化完成');
  } catch (error) {
    console.error('[pending-measurements] 資料表初始化失敗:', error);
  }
}

// 啟動時依序初始化資料表及執行 migrations
(async () => {
  await initTable();

  // [T6][Phase1.5] 補上 updated_at 欄位 + trigger，為樂觀鎖使用
  try {
    await pool.query(`
      ALTER TABLE pending_tree_measurements
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      DROP TRIGGER IF EXISTS pending_measurements_set_updated_at ON pending_tree_measurements;
      CREATE TRIGGER pending_measurements_set_updated_at
        BEFORE UPDATE ON pending_tree_measurements
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('[pending-measurements] updated_at column + trigger ready');
  } catch (e) {
    console.warn('[pending-measurements] updated_at migration skipped:', e.message);
  }

  try {
    await pool.query(`
      ALTER TABLE pending_tree_measurements
        ADD COLUMN IF NOT EXISTS survey_mode VARCHAR(20) DEFAULT 'new',
        ADD COLUMN IF NOT EXISTS target_tree_id BIGINT,
        ADD COLUMN IF NOT EXISTS match_status VARCHAR(30),
        ADD COLUMN IF NOT EXISTS gps_source VARCHAR(30),
        ADD COLUMN IF NOT EXISTS tree_position_source VARCHAR(50),
        ADD COLUMN IF NOT EXISTS station_position_source VARCHAR(50);
    `);
    console.log('[pending-measurements] survey mode + gps source columns ready');
  } catch (e) {
    console.warn('[pending-measurements] survey mode migration skipped:', e.message);
  }

  try {
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'valid_status'
          AND table_name = 'pending_tree_measurements'
        ) THEN
          ALTER TABLE pending_tree_measurements DROP CONSTRAINT valid_status;
          ALTER TABLE pending_tree_measurements ADD CONSTRAINT valid_status
            CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed', 'transferred'));
        END IF;
      END $$;
    `);
  } catch (e) {
    console.warn('[pending-measurements] Constraint migration skipped:', e.message);
  }

  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pending_tree_measurements'
          AND column_name = 'measurement_type'
        ) THEN
          ALTER TABLE pending_tree_measurements ADD COLUMN measurement_type VARCHAR(10);
        END IF;
      END $$;
    `);
    console.log('[pending-measurements] measurement_type 欄位確認完成');
  } catch (e) {
    console.warn('[pending-measurements] measurement_type migration skipped:', e.message);
  }

  // Migration: instrument_dbh_cm + dbh_source columns
  try {
    await pool.query(`
      ALTER TABLE pending_tree_measurements
        ADD COLUMN IF NOT EXISTS instrument_dbh_cm DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS dbh_source VARCHAR(30);
      COMMENT ON COLUMN pending_tree_measurements.instrument_dbh_cm IS 'VLGEO2 Remote Diameter 量測值 (cm)';
      COMMENT ON COLUMN pending_tree_measurements.dbh_source IS 'DBH 來源: remote_diameter, vision, manual';
    `);
    console.log('[pending-measurements] instrument_dbh_cm 欄位確認完成');
  } catch (e) {
    console.warn('[pending-measurements] instrument_dbh migration skipped:', e.message);
  }

  // [v19.0] Migration: 新增 VLGEO2 儀器參數欄位
  try {
    await pool.query(`
      ALTER TABLE pending_tree_measurements
        ADD COLUMN IF NOT EXISTS gps_hdop DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS device_sn VARCHAR(50),
        ADD COLUMN IF NOT EXISTS ref_height DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS utm_zone VARCHAR(10),
        ADD COLUMN IF NOT EXISTS raw_data_snapshot JSONB;
      COMMENT ON COLUMN pending_tree_measurements.gps_hdop IS 'GPS HDOP 精度指標';
      COMMENT ON COLUMN pending_tree_measurements.device_sn IS '儀器序號 (SNR)';
      COMMENT ON COLUMN pending_tree_measurements.ref_height IS '儀器參考高度 REFH (m)';
      COMMENT ON COLUMN pending_tree_measurements.utm_zone IS 'UTM 帶區';
      COMMENT ON COLUMN pending_tree_measurements.raw_data_snapshot IS '完整原始數據快照 (JSON)';
    `);
    console.log('[pending-measurements] v19.0 儀器參數欄位確認完成');
  } catch (e) {
    console.warn('[pending-measurements] v19.0 migration skipped:', e.message);
  }
})();

/**
 * POST /api/pending-measurements/batch
 * 批量創建待測量記錄
 */
router.post('/batch', projectAuthFilter, async (req, res) => {
  const dedupRoute = 'POST /pending-measurements/batch';
  try {
    const cached = await requestIdDedup.getCachedResponse(req, dedupRoute);
    if (cached) {
      return res.status(cached.status_code).json(cached.response_body);
    }
  } catch (e) {
    console.warn('[pending-measurements] request dedup read skipped:', e.message);
  }

  const { measurements } = req.body;
  
  if (!measurements || !Array.isArray(measurements) || measurements.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: '請提供測量記錄陣列' 
    });
  }

  if (measurements.length > 500) {
    return res.status(400).json({ success: false, message: '批次上限 500 筆' });
  }

  // 權限檢查：若 user 有 filter，所有指定的 project_code 必須在 filter 內
  // null/undefined 視為「未匹配」，允許（後續可在 session 層補上指派）
  if (req.projectFilter != null) {
    const codes = [...new Set(
      measurements
        .map(m => m.project_code)
        .filter(c => c != null && c !== '')
    )];
    const denied = codes.filter(c => !req.projectFilter.includes(c));
    if (denied.length > 0) {
      return res.status(403).json({
        success: false,
        message: `無權限存取以下專案：${denied.join(', ')}`
      });
    }
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const insertedIds = [];
    
    for (const m of measurements) {
      const snapshot = parseRawDataSnapshot(m.raw_data_snapshot);
      const result = await client.query(`
        INSERT INTO pending_tree_measurements (
          session_id, original_record_id,
          project_area, project_code, project_name,
          species_name, tree_height, dbh_cm,
          tree_latitude, tree_longitude,
          station_latitude, station_longitude,
          horizontal_distance, slope_distance, azimuth, pitch, altitude,
          measurement_type, status, priority,
          instrument_dbh_cm, dbh_source,
          gps_hdop, device_sn, ref_height, utm_zone, raw_data_snapshot,
          survey_mode, target_tree_id, match_status,
          gps_source, tree_position_source, station_position_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
        RETURNING id
      `, [
        m.session_id,
        m.original_record_id,
        m.project_area,
        m.project_code,
        m.project_name,
        m.species_name,
        m.tree_height,
        m.dbh_cm,
        m.tree_latitude,
        m.tree_longitude,
        m.station_latitude,
        m.station_longitude,
        m.horizontal_distance,
        m.slope_distance,
        m.azimuth,
        m.pitch,
        m.altitude,
        m.measurement_type || null,
        m.status ?? 'pending',
        m.priority ?? 3,
        m.instrument_dbh_cm ?? null,
        m.dbh_source ?? null,
        m.gps_hdop ?? null,
        m.device_sn ?? null,
        m.ref_height ?? null,
        m.utm_zone ?? null,
        m.raw_data_snapshot ? JSON.stringify(m.raw_data_snapshot) : null,
        m.survey_mode || snapshot.survey_mode || 'new',
        m.target_tree_id || snapshot.target_tree_id || null,
        m.match_status || snapshot.match_status || null,
        m.gps_source || snapshot.gps_source || null,
        m.tree_position_source || snapshot.tree_position_source || null,
        m.station_position_source || snapshot.station_position_source || null
      ]);
      
      insertedIds.push(result.rows[0].id);
    }
    
    await client.query('COMMIT');
    
    const payload = {
      success: true,
      message: `成功創建 ${insertedIds.length} 筆待測量記錄`,
      session_id: measurements[0].session_id,
      inserted_ids: insertedIds
    };

    try {
      await requestIdDedup.storeResponse(req, dedupRoute, 201, payload);
    } catch (e) {
      console.warn('[pending-measurements] request dedup store skipped:', e.message);
    }

    res.status(201).json(payload);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[pending-measurements] 批量創建失敗:', error);
    res.status(500).json({ 
      success: false, 
      message: '創建失敗',
      error: '操作失敗，請稍後再試' 
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/pending-measurements/sessions
 * 獲取所有測量批次
 */
router.get('/sessions', projectAuthFilter, async (req, res) => {
  try {
    const filter = req.projectFilter;
    let where = '';
    const params = [];
    if (filter != null) {
      if (filter.length === 0) {
        return res.json([]);
      }
      where = `WHERE project_code = ANY($1::text[])`;
      params.push(filter);
    }
    const result = await pool.query(`
      SELECT 
        session_id,
        MIN(project_area) as project_area,
        MIN(project_code) as project_code,
        MIN(project_name) as project_name,
        MIN(created_at) as created_at,
        COUNT(*) as total_trees,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_trees,
        'system' as created_by
      FROM pending_tree_measurements
      ${where}
      GROUP BY session_id
      ORDER BY MIN(created_at) DESC
    `, params);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('[pending-measurements] 獲取批次失敗:', error);
    res.status(500).json({ 
      success: false, 
      message: '獲取失敗',
      error: '操作失敗，請稍後再試' 
    });
  }
});

/**
 * GET /api/pending-measurements/trees
 * 獲取待測量樹木列表
 */
router.get('/trees', projectAuthFilter, async (req, res) => {
  const { session_id, status } = req.query;
  
  try {
    let query = 'SELECT * FROM pending_tree_measurements WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (session_id) {
      query += ` AND session_id = $${paramIndex++}`;
      params.push(session_id);
    }
    
    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    const f = applyProjectFilter(req, paramIndex);
    query += f.clause;
    params.push(...f.params);
    paramIndex = f.nextIdx;
    
    query += ' ORDER BY priority ASC, created_at ASC';
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('[pending-measurements] 獲取樹木失敗:', error);
    res.status(500).json({ 
      success: false, 
      message: '獲取失敗',
      error: '操作失敗，請稍後再試' 
    });
  }
});

/**
 * GET /api/pending-measurements/stats/overview
 * 獲取統計資訊（必須在 /:id 之前，否則 'stats' 會被當作 id）
 */
router.get('/stats/overview', projectAuthFilter, async (req, res) => {
  try {
    const filter = req.projectFilter;
    let where = '';
    const params = [];
    if (filter != null) {
      if (filter.length === 0) {
        return res.json({ total: 0, pending: 0, in_progress: 0, completed: 0, skipped: 0, failed: 0, transferred: 0, total_sessions: 0 });
      }
      where = `WHERE project_code = ANY($1::text[])`;
      params.push(filter);
    }
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'transferred') as transferred,
        COUNT(DISTINCT session_id) as total_sessions
      FROM pending_tree_measurements
      ${where}
    `, params);
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('[pending-measurements] 獲取統計失敗:', error);
    res.status(500).json({ 
      success: false, 
      message: '獲取失敗',
      error: '操作失敗，請稍後再試' 
    });
  }
});

/**
 * GET /api/pending-measurements/:id
 * 獲取單筆待測量記錄
 */
router.get('/:id', projectAuthFilter, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM pending_tree_measurements WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '記錄不存在' 
      });
    }
    
    // 權限檢查：req.projectFilter==null 看全部；否則必須包含此 row 的 project_code
    const row = result.rows[0];
    if (req.projectFilter != null) {
      if (!row.project_code || !req.projectFilter.includes(row.project_code)) {
        return res.status(403).json({ success: false, message: '權限不足' });
      }
    }
    
    res.json(row);
    
  } catch (error) {
    console.error('[pending-measurements] 獲取記錄失敗:', error);
    res.status(500).json({ 
      success: false, 
      message: '獲取失敗',
      error: '操作失敗，請稍後再試' 
    });
  }
});

/**
 * PATCH /api/pending-measurements/:id
 * 更新測量結果
 * [T6][Phase1.5] 支援樂觀鎖：body.expected_updated_at 不符 → 409；row 不存在 → 410
 * 不送 expected_updated_at 時退化舊行為（向後相容）
 */
router.patch('/:id', projectAuthFilter, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const expectedUpdatedAt = updates.expected_updated_at;

  const allowedFields = [
    'status', 'measured_dbh_cm', 'measurement_confidence',
    'measurement_method', 'measurement_notes', 'completed_at',
    'assigned_to', 'species_name', 'measurement_type',
    'project_area', 'project_code', 'project_name',
    'survey_mode', 'target_tree_id', 'match_status',
    'gps_source', 'tree_position_source', 'station_position_source'
  ];

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = $${paramIndex++}`);
      values.push(updates[field]);
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({
      success: false,
      message: '沒有可更新的欄位'
    });
  }

  try {
    // [T6] 先查存在：不在 → 410 DELETED
    const existing = await pool.query(
      'SELECT * FROM pending_tree_measurements WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(410).json({
        success: false,
        code: 'DELETED',
        message: '資料已不存在或已被刪除'
      });
    }

    // 權限檢查：req.projectFilter==null 看全部；否則 row.project_code 必須在 filter 內
    if (req.projectFilter != null) {
      const rowCode = existing.rows[0].project_code;
      if (!rowCode || !req.projectFilter.includes(rowCode)) {
        return res.status(403).json({ success: false, message: '權限不足' });
      }
      // 若使用者試圖把 row 改到自己沒權限的專案 → 拒絕
      if (updates.project_code !== undefined && updates.project_code !== null
          && !req.projectFilter.includes(updates.project_code)) {
        return res.status(403).json({ success: false, message: '無目標專案的權限' });
      }
    }

    // [T6] 樂觀鎖比對（±2s 容差，避免 ISO 字串與 DB timestamptz 精度差造成假 409）
    if (expectedUpdatedAt) {
      const serverTs = new Date(existing.rows[0].updated_at).getTime();
      const clientTs = new Date(expectedUpdatedAt).getTime();
      const driftMs = Math.abs(serverTs - clientTs);
      if (Number.isFinite(serverTs) && Number.isFinite(clientTs) && driftMs > 2000) {
        return res.status(409).json({
          success: false,
          code: 'CONFLICT',
          message: '資料已被其他人修改，請重新整理',
          serverVersion: existing.rows[0]
        });
      }
    }

    values.push(id);
    const idIdx = paramIndex++;
    const sql = `
        UPDATE pending_tree_measurements
        SET ${setClauses.join(', ')}
        WHERE id = $${idIdx}
        RETURNING *
      `;

    const result = await pool.query(sql, values);

    if (result.rows.length === 0) {
      // SELECT 和 UPDATE 之間被動過 → 重查判斷 410 / 409
      const recheck = await pool.query(
        'SELECT * FROM pending_tree_measurements WHERE id = $1',
        [id]
      );
      if (recheck.rows.length === 0) {
        return res.status(410).json({
          success: false,
          code: 'DELETED',
          message: '資料已不存在或已被刪除'
        });
      }
      return res.status(409).json({
        success: false,
        code: 'CONFLICT',
        message: '資料已被其他人修改，請重新整理',
        serverVersion: recheck.rows[0]
      });
    }

    res.json({
      success: true,
      message: '更新成功',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('[pending-measurements] 更新失敗:', error);
    res.status(500).json({
      success: false,
      message: '更新失敗',
      error: '操作失敗，請稍後再試'
    });
  }
});

/**
 * 建構 survey_notes 字串，安全處理 null 值
 */
function buildSurveyNotes(p) {
  const parts = ['VLGEO2+Vision測量'];
  if (p.measurement_method) {
    parts.push(`方法: ${p.measurement_method}`);
  }
  if (p.measurement_confidence != null) {
    parts.push(`信心度: ${(p.measurement_confidence * 100).toFixed(0)}%`);
  }
  if (p.measurement_notes) {
    parts.push(p.measurement_notes);
  }
  return parts.join(' | ');
}

/**
 * POST /api/pending-measurements/transfer
 * 將已完成的測量轉移到 tree_survey 表
 * 
 * 修正：
 * - 生成 system_tree_id (NOT NULL) 和 project_tree_id
 * - 使用 advisory lock 確保 ID 不碰撞
 * - 使用 ?? 取代 || 避免 falsy 值被覆蓋 (例如 dbh=0)
 */
router.post('/transfer', projectAuthFilter, async (req, res) => {
  const { session_id } = req.body;
  
  if (!session_id) {
    return res.status(400).json({ 
      success: false, 
      message: '請提供 session_id' 
    });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 權限檢查：session 中所有 row 的 project_code 都必須在 filter 內
    if (req.projectFilter != null) {
      const codesRes = await client.query(
        'SELECT DISTINCT project_code FROM pending_tree_measurements WHERE session_id = $1',
        [session_id]
      );
      const sessionCodes = codesRes.rows.map(r => r.project_code);
      const denied = sessionCodes.filter(c => !c || !req.projectFilter.includes(c));
      if (denied.length > 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: '權限不足：有記錄屬於您無權限的專案' });
      }
    }
    
    // 獲取已完成的記錄；smoke-test rows 只供 App 實機測試，不可轉入正式 tree_survey。
    const pendingResult = await client.query(`
      SELECT * FROM pending_tree_measurements 
      WHERE session_id = $1
        AND status = 'completed'
        AND COALESCE(raw_data_snapshot->>'is_smoke_test', 'false') <> 'true'
    `, [session_id]);
    
    if (pendingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: '沒有已完成的記錄可轉移' 
      });
    }

    const blockedRows = pendingResult.rows.filter(p => {
      const gpsSource = effectiveGpsSource(p);
      const requiresGpsFix = rawValue(p, 'requires_gps_fix') === true;
      const missingTreeGps = !p.tree_latitude || !p.tree_longitude;
      return requiresGpsFix || gpsSource === 'mixed_pending' || missingTreeGps;
    });
    if (blockedRows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `有 ${blockedRows.length} 筆資料 GPS 未確認或缺座標，請先修正後再轉移`,
        blocked_pending_ids: blockedRows.map(p => p.id),
      });
    }
    
    // 鎖定 ID 序列（與 create/batch controller 共用 key 1）
    await client.query('SELECT pg_advisory_xact_lock(1)');
    
    // 取得目前最大 system_tree_id
    const sysIdRes = await client.query(`
      SELECT MAX(CAST(regexp_replace(system_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id 
      FROM tree_survey 
      WHERE (system_tree_id ~ '^ST-[0-9]+$')
      AND (is_placeholder IS NULL OR is_placeholder = false)
    `);
    let nextSysId = (sysIdRes.rows[0].max_id ?? 0) + 1;
    
    // 快取各專案的 project_tree_id 最大值（避免重複查詢）
    const projectMaxIds = {};
    
    const transferredIds = [];
    const idMapping = []; // { pending_id, tree_survey_id, system_tree_id, mode }
    
    for (const p of pendingResult.rows) {
      const surveyMode = effectiveSurveyMode(p);
      const projCode = p.project_code ?? null;
      
      // 嘗試查找 species_id
      let speciesId = null;
      if (p.species_name) {
        try {
          const speciesRes = await client.query(
            'SELECT id FROM tree_species WHERE name = $1 OR scientific_name = $1', 
            [p.species_name]
          );
          if (speciesRes.rows.length > 0) {
            speciesId = speciesRes.rows[0].id;
          }
        } catch (err) {
          console.warn(`[Transfer] Species lookup failed for ${p.species_name}:`, err.message);
        }
      }
      
      // 決定最終 DBH（?? 避免 0 被當成 falsy）
      const finalDbh = p.measured_dbh_cm ?? p.dbh_cm ?? 0;
      const finalStatus = p.measurement_notes ?? '良好';
      const surveyNotes = buildSurveyNotes(p);

      // [碳計算] TIPC AR-TMS0001 / 林業署手冊式 6-4 — K_sp · DBH² · H
      // 缺 DBH 或樹高時回 null（讓 SQL SUM 可 IGNORE NULLS，避免誤併入零碳儲）
      const finalCarbonStorage = carbonCalculationService.calculateCarbonStorage(
        p.species_name,
        finalDbh,
        p.tree_height,
      );
      // 年固碳量 (carbon_sequestration_per_year) 因 TIPC 公式未公開，
      // 不於 backend 重算；維持 NULL 由前端 fallback 顯示「—」。

      let treeSurveyId;
      let systemTreeId;

      if (surveyMode === 'maintenance') {
        const targetTreeId = effectiveTargetTreeId(p);
        if (!targetTreeId) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `pending_id=${p.id} 標記為維護，但缺少 target_tree_id`,
          });
        }

        const targetRes = await client.query(`
          SELECT id, project_code, system_tree_id, project_tree_id
          FROM tree_survey
          WHERE id = $1 AND (is_placeholder IS NULL OR is_placeholder = false)
          FOR UPDATE
        `, [targetTreeId]);
        if (targetRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `pending_id=${p.id} 對應的既有樹木不存在`,
          });
        }
        const target = targetRes.rows[0];
        if (projCode && target.project_code && target.project_code !== projCode) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `pending_id=${p.id} 的專案與目標樹木專案不一致`,
          });
        }

        await client.query(`
          UPDATE tree_survey
          SET species_name = $1,
              species_id = $2,
              tree_height_m = $3,
              dbh_cm = $4,
              status = $5,
              survey_notes = $6,
              survey_time = $7,
              carbon_storage = $8
          WHERE id = $9
        `, [
          p.species_name ?? '待辨識',
          speciesId,
          p.tree_height,
          finalDbh,
          finalStatus,
          surveyNotes,
          p.completed_at ?? new Date(),
          finalCarbonStorage,
          target.id,
        ]);

        treeSurveyId = target.id;
        systemTreeId = target.system_tree_id;
      } else {
        // 生成 system_tree_id
        systemTreeId = `ST-${nextSysId}`;
        nextSysId++;

        // 生成 project_tree_id（按專案分開計數）
        let projectTreeId;
        if (projCode) {
          if (!(projCode in projectMaxIds)) {
            const prjIdRes = await client.query(`
              SELECT MAX(CAST(regexp_replace(project_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id
              FROM tree_survey
              WHERE project_code = $1
              AND (project_tree_id ~ '^PT-[0-9]+$' OR project_tree_id ~ '^[0-9]+$')
              AND project_tree_id != 'PT-0'
              AND (is_placeholder IS NULL OR is_placeholder = false)
            `, [projCode]);
            projectMaxIds[projCode] = (prjIdRes.rows[0].max_id ?? 0);
          }
          projectMaxIds[projCode]++;
          projectTreeId = `PT-${projectMaxIds[projCode]}`;
        } else {
          projectTreeId = `PT-${Date.now()}`;
        }

        // 插入到 tree_survey（含必要的 system_tree_id, project_tree_id）
        const insertResult = await client.query(`
          INSERT INTO tree_survey (
            system_tree_id, project_tree_id,
            project_location, project_code, project_name,
            species_name, species_id, tree_height_m, dbh_cm,
            x_coord, y_coord,
            status, survey_notes, survey_time,
            carbon_storage
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING id
        `, [
          systemTreeId,
          projectTreeId,
          p.project_area,
          projCode,
          p.project_name,
          p.species_name ?? '待辨識',
          speciesId,
          p.tree_height,
          finalDbh,
          p.tree_longitude,
          p.tree_latitude,
          finalStatus,
          surveyNotes,
          p.completed_at ?? new Date(),
          finalCarbonStorage,
        ]);
        treeSurveyId = insertResult.rows[0].id;
      }
      
      transferredIds.push(treeSurveyId);
      idMapping.push({
        pending_id: p.id,
        tree_survey_id: treeSurveyId,
        system_tree_id: systemTreeId,
        mode: surveyMode,
      });

      const rawLat = effectiveRawNumber(p, 'lat', p.station_latitude ?? p.tree_latitude);
      const rawLon = effectiveRawNumber(p, 'lon', p.station_longitude ?? p.tree_longitude);
      const rawSnapshotText = p.raw_data_snapshot
        ? (typeof p.raw_data_snapshot === 'string' ? p.raw_data_snapshot : JSON.stringify(p.raw_data_snapshot))
        : null;
      
      // 同時插入 tree_measurement_raw（保留儀器數據）
      try {
        await client.query(`
          INSERT INTO tree_measurement_raw (
            tree_id, instrument_type,
            horizontal_dist, slope_dist, vertical_angle, azimuth,
            raw_lat, raw_lon, altitude,
            gps_hdop, device_sn, ref_height, utm_zone, raw_data_snapshot,
            measured_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `, [
          treeSurveyId,
          'VLGEO2+Vision',
          p.horizontal_distance,
          p.slope_distance,
          p.pitch,
          p.azimuth,
          rawLat,
          rawLon,
          p.altitude,
          p.gps_hdop ?? null,
          p.device_sn ?? null,
          p.ref_height ?? null,
          p.utm_zone ?? null,
          rawSnapshotText,
          p.completed_at ?? new Date()
        ]);
      } catch (rawErr) {
        console.warn('[Transfer] tree_measurement_raw insert skipped:', rawErr.message);
      }

      // 遷移照片：將 tree_images 的 pending owner 轉為正式 tree_survey owner。
      try {
        await client.query(`
          UPDATE tree_images 
          SET owner_type = 'survey', owner_id = $1
          WHERE owner_type = 'pending' AND owner_id = $2
        `, [treeSurveyId, p.id]);
      } catch (imgErr) {
        console.warn(`[Transfer] tree_images migration skipped for pending_id=${p.id}:`, imgErr.message);
      }
    }
    
    // 標記為已轉移
    await client.query(`
      UPDATE pending_tree_measurements 
      SET status = 'transferred'
      WHERE session_id = $1 AND status = 'completed'
    `, [session_id]);
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: `成功轉移 ${transferredIds.length} 筆記錄到 tree_survey`,
      transferred_tree_ids: transferredIds,
      id_mapping: idMapping
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[pending-measurements] 轉移失敗:', error);
    res.status(500).json({ 
      success: false, 
      message: '轉移失敗',
      error: '操作失敗，請稍後再試' 
    });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/pending-measurements/session/:sessionId/project
 * 批量更新整個 session 的專案資訊（單次 SQL，取代 N+1 逐筆 PATCH）
 */
router.patch('/session/:sessionId/project', projectAuthFilter, async (req, res) => {
  const { sessionId } = req.params;
  const { project_area, project_code, project_name } = req.body;

  if (!sessionId) {
    return res.status(400).json({ success: false, message: 'session_id is required' });
  }
  if (!project_area) {
    return res.status(400).json({ success: false, message: 'project_area is required' });
  }

  try {
    // 權限檢查：user 必須能看到 session 中所有 row 的原 project_code
    // 並且能存取新指定的 project_code
    if (req.projectFilter != null) {
      const codesRes = await pool.query(
        'SELECT DISTINCT project_code FROM pending_tree_measurements WHERE session_id = $1',
        [sessionId]
      );
      const sessionCodes = codesRes.rows.map(r => r.project_code);
      const denied = sessionCodes.filter(c => c && !req.projectFilter.includes(c));
      if (denied.length > 0) {
        return res.status(403).json({ success: false, message: '權限不足' });
      }
      if (project_code && !req.projectFilter.includes(project_code)) {
        return res.status(403).json({ success: false, message: '無目標專案的權限' });
      }
    }

    const result = await pool.query(
      `UPDATE pending_tree_measurements
       SET project_area = $1, project_code = $2, project_name = $3
       WHERE session_id = $4
       RETURNING id`,
      [project_area, project_code || null, project_name || null, sessionId]
    );

    res.json({
      success: true,
      updated: result.rowCount,
      message: `已更新 ${result.rowCount} 筆記錄的專案資訊`,
    });
  } catch (err) {
    console.error('[PendingMeasurements] Bulk update project error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/pending-measurements/session/:sessionId
 * 刪除整個測量批次
 */
router.delete('/session/:sessionId', projectAuthFilter, async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    // 權限檢查：session 中所有 row project_code 需在 filter 內
    if (req.projectFilter != null) {
      const codesRes = await pool.query(
        'SELECT DISTINCT project_code FROM pending_tree_measurements WHERE session_id = $1',
        [sessionId]
      );
      const sessionCodes = codesRes.rows.map(r => r.project_code);
      const denied = sessionCodes.filter(c => !c || !req.projectFilter.includes(c));
      if (denied.length > 0) {
        return res.status(403).json({ success: false, message: '權限不足' });
      }
    }
    
    const result = await pool.query(
      'DELETE FROM pending_tree_measurements WHERE session_id = $1 RETURNING id',
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '找不到該批次的記錄',
        deleted_count: 0
      });
    }

    res.json({
      success: true,
      message: `已刪除 ${result.rows.length} 筆記錄`,
      deleted_count: result.rows.length
    });
    
  } catch (error) {
    console.error('[pending-measurements] 刪除失敗:', error);
    res.status(500).json({ 
      success: false, 
      message: '刪除失敗',
      error: '操作失敗，請稍後再試' 
    });
  }
});

module.exports = router;
