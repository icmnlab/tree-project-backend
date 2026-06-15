const db = require('../config/db');
const AuditLogService = require('../services/auditLogService');
const { findReplacementCharField } = require('../utils/textValidation');
const { lifecycleFromStatus } = require('../utils/treeLifecycle');
const { toTraditional } = require('../utils/chineseConvert');

/**
 * 批量匯入樹木調查資料 (v2)
 * 
 * 特性：
 * 1. 原子性事務 (Atomic Transaction)：確保整批資料寫入的一致性。
 * 2. 伺服器端 ID 生成 (Server-Side ID Generation)：
 *    - 鎖定並分配 System ID (ST-XXXX)
 *    - 鎖定並分配 Project ID (PT-XXXX)
 * 3. 雙表寫入 (Dual-Table Writing)：
 *    - tree_survey: 寫入業務資料 (供 App 顯示與編輯)
 *    - tree_measurement_raw: 寫入儀器原始數據 (供科研與校正)
 * 4. 專案正規化支援：自動處理 projects 表的關聯 (若有)。
 */
exports.batchImportTrees = async (req, res) => {
    // 亂碼防護：批次中任一筆含 U+FFFD（編碼解碼失敗）→ 整批拒絕，避免部分損毀
    const treesIn = Array.isArray(req.body && req.body.trees) ? req.body.trees : [];
    for (let i = 0; i < treesIn.length; i++) {
        const bad = findReplacementCharField(treesIn[i], [
            'species_name', 'status', 'notes', 'tree_notes', 'survey_notes',
        ]);
        if (bad) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_TEXT_ENCODING',
                message: `第 ${i + 1} 筆欄位「${bad}」含無效字元（亂碼 U+FFFD），請確認來源檔案為 UTF-8 編碼`,
            });
        }
    }

    const client = await db.pool.connect();
    
    try {
        const { 
            project_area, 
            project_code, 
            project_name, 
            trees 
        } = req.body;

        if (!trees || !Array.isArray(trees) || trees.length === 0) {
            return res.status(400).json({ success: false, message: '無有效的樹木資料' });
        }

        await client.query('BEGIN');

        // ---------------------------------------------------------
        // Step 1: 準備專案關聯 (Project Association)
        // ---------------------------------------------------------
        // 嘗試查找或創建專案 (為了正規化做準備)
        // 如果 projects 表存在，我們嘗試獲取 project_id
        let projectId = null;
        try {
            // 簡單檢查 projects 表是否存在
            const checkTable = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'projects'
                );
            `);
            
            if (checkTable.rows[0].exists && project_code) {
                // 嘗試獲取專案 ID
                const prjRes = await client.query(
                    'SELECT id FROM projects WHERE project_code = $1', 
                    [project_code]
                );
                if (prjRes.rows.length > 0) {
                    projectId = prjRes.rows[0].id;
                } else {
                    // 若專案不存在，暫時先不強制創建，避免複雜度過高
                    // 未來可以在這裡加入自動創建專案的邏輯
                }
            }
        } catch (err) {
            console.warn('Project association skipped:', err.message);
        }

        // ---------------------------------------------------------
        // Step 2: 鎖定並獲取 ID 序列起點 (Atomic ID Generation)
        // ---------------------------------------------------------
        
        // A. 系統樹木編號 (System ID)
        // 使用 Advisory Lock (Key 1) 確保 System ID 生成的原子性
        // 這會阻塞其他嘗試獲取 Key 1 鎖的事務，直到當前事務結束
        await client.query('SELECT pg_advisory_xact_lock(1)'); 

        // [FIX v17.1] 排除佔位記錄 (PLACEHOLDER-*) 以確保 ID 序列正確
        const sysIdRes = await client.query(`
            SELECT MAX(CAST(regexp_replace(system_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id 
            FROM tree_survey 
            WHERE (system_tree_id ~ '^ST-[0-9]+$')
            AND (is_placeholder IS NULL OR is_placeholder = false)
        `);
        let nextSysId = (sysIdRes.rows[0].max_id || 0) + 1;

        // B. 專案樹木編號 (Project ID)
        // 針對該專案代碼鎖定最大 ID
        // 使用 Advisory Lock (Key 2) + ProjectCode Hash 確保專案內序列原子性
        // 簡單起見，這裡我們複用 Key 1 的鎖定範圍 (因為 System ID 是全局的，鎖了它等於鎖了所有)，所以不需要額外鎖定
        // [FIX v17.1] 排除佔位記錄 (PT-0) 以確保第一筆實際資料為 PT-1
        let nextPrjId = 1;
        if (project_code) {
            const prjIdRes = await client.query(`
                SELECT MAX(CAST(regexp_replace(project_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id 
                FROM tree_survey 
                WHERE project_code = $1 
                AND (project_tree_id ~ '^PT-[0-9]+$' OR project_tree_id ~ '^[0-9]+$')
                AND project_tree_id != 'PT-0'
                AND (is_placeholder IS NULL OR is_placeholder = false)
            `, [project_code]);
            nextPrjId = (prjIdRes.rows[0].max_id || 0) + 1;
        }

        // ---------------------------------------------------------
        // Step 3: 迭代處理並寫入 (Batch Insert)
        // ---------------------------------------------------------
        const insertedIds = [];

        for (const tree of trees) {
            // 生成 ID
            const systemTreeId = `ST-${nextSysId++}`;
            const projectTreeId = project_code ? `PT-${nextPrjId++}` : `PT-${Date.now()}`; // Fallback

            // [生命週期] 由樹況推導；批次匯入若帶枯死/倒塌/移除狀態，與單筆新增/維護淘汰流程一致
            // 設定 lifecycle_status/retired_at/retired_reason（避免「枯死卻仍計為活立木」）。
            const finalStatusText = tree.status || '良好';
            const lifecycle = lifecycleFromStatus(finalStatusText) ?? 'active';
            const isRetired = lifecycle !== 'active';
            const surveyTime = tree.survey_time || new Date().toISOString();
            const retiredAt = isRetired ? surveyTime : null;
            const retiredReason = isRetired ? finalStatusText : null;

            // 準備 tree_survey 數據
            // [FIX] 座標對應修正：x_coord = 經度 (lon), y_coord = 緯度 (lat)
            // project_name / project_location 由 trigger 09 自 projects + project_areas 覆蓋
            const surveyValues = [
                project_code || '無',
                systemTreeId,
                projectTreeId,
                tree.species_id || '無',
                toTraditional(tree.species_name) || '無',
                parseFloat(tree.lon) || 0, // x_coord = 經度 (Longitude)
                parseFloat(tree.lat) || 0, // y_coord = 緯度 (Latitude)
                finalStatusText,
                tree.note || '無',
                tree.tree_remark || '無',
                parseFloat(tree.height) || 0,
                parseFloat(tree.dbh) || 0,
                tree.survey_remark || '批量匯入',
                surveyTime,
                parseFloat(tree.carbon_storage) || 0,
                parseFloat(tree.carbon_sequestration) || 0,
                projectId, // 新增的正規化欄位 (可能為 null)
                lifecycle,
                retiredAt,
                retiredReason
            ];

            // 寫入主表
            const insertSurveySql = `
                INSERT INTO tree_survey 
                (project_code, system_tree_id, project_tree_id, species_id, 
                species_name, x_coord, y_coord, status, notes, tree_notes, tree_height_m, 
                dbh_cm, survey_notes, survey_time, carbon_storage, carbon_sequestration_per_year, project_id,
                lifecycle_status, retired_at, retired_reason) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                RETURNING id;
            `;
            
            const surveyResult = await client.query(insertSurveySql, surveyValues);
            const newTreeId = surveyResult.rows[0].id;
            insertedIds.push(newTreeId);

            // 準備 tree_measurement_raw 數據 (如果 metadata 存在)
            // [BACKWARD COMPAT] 只有當 raw 表存在時才嘗試寫入，確保舊資料庫不會報錯
            if (tree.metadata) {
                const meta = tree.metadata;
                
                // 先檢查 tree_measurement_raw 表是否存在
                const tableCheck = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = 'tree_measurement_raw'
                    );
                `);
                
                if (tableCheck.rows[0].exists) {
                    const remoteDia = meta.remote_diameter_cm ?? meta.instrument_dbh_cm ?? null;
                    const rawValues = [
                        newTreeId,
                        meta.instrument_type || tree.type || 'VLGEO2',
                        meta.snr || meta.device_sn || null,
                        meta.hd ?? meta.horizontal_distance ?? null,
                        meta.sd ?? meta.slope_distance ?? null,
                        meta.pitch !== undefined ? parseFloat(meta.pitch) : null,
                        meta.az ?? meta.azimuth ?? null,
                        meta.ref_height !== undefined ? parseFloat(meta.ref_height) : null,
                        meta.hdop !== undefined ? parseFloat(meta.hdop) : null,
                        meta.raw_lat !== undefined ? parseFloat(meta.raw_lat) : null,
                        meta.raw_lon !== undefined ? parseFloat(meta.raw_lon) : null,
                        meta.altitude !== undefined ? parseFloat(meta.altitude) : null,
                        meta.utm_zone || null,
                        meta.measured_at || tree.survey_time || null,
                        JSON.stringify(meta),
                        remoteDia !== null && remoteDia !== undefined ? parseFloat(remoteDia) : null,
                    ];

                    const insertRawSql = `
                        INSERT INTO tree_measurement_raw
                        (tree_id, instrument_type, device_sn, horizontal_dist, slope_dist, vertical_angle, 
                        azimuth, ref_height, gps_hdop, raw_lat, raw_lon, altitude, utm_zone,
                        measured_at, raw_data_snapshot, instrument_dbh_cm)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                    `;
                    await client.query(insertRawSql, rawValues);
                }
                // 如果表不存在，靜默跳過（metadata 已備份在 survey_notes 或其他地方）
            }
        }

        await client.query('COMMIT');

        // Audit Log for batch import
        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'BATCH_IMPORT_TREES',
            resourceType: 'tree_survey',
            details: { 
                count: insertedIds.length,
                projectCode: project_code,
                projectName: project_name,
                startSystemId: `ST-${nextSysId - insertedIds.length}`,
                endSystemId: `ST-${nextSysId - 1}`
            },
            req
        });

        res.status(201).json({
            success: true,
            message: `成功匯入 ${insertedIds.length} 筆資料`,
            data: {
                count: insertedIds.length,
                start_system_id: `ST-${nextSysId - insertedIds.length}`,
                end_system_id: `ST-${nextSysId - 1}`
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('批量匯入失敗:', err);
        res.status(500).json({ 
            success: false, 
            message: '匯入過程中發生錯誤，已全部復原', 
            error: err.message 
        });
    } finally {
        client.release();
    }
};

