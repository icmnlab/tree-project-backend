const db = require('../config/db');
const AuditLogService = require('../services/auditLogService');
const carbonCalculationService = require('../services/carbonCalculationService');

/**
 * 單筆新增樹木調查資料 (v2) - 用於人工手動輸入
 * 
 * 特性：
 * 1. 伺服器端 ID 生成 (Server-Side ID Generation)：
 *    - 鎖定並分配 System ID (ST-XXXX)
 *    - 鎖定並分配 Project ID (PT-XXXX)
 * 2. 專案正規化支援：嘗試關聯 projects 表 (若有)。
 * 3. 僅寫入業務資料 (tree_survey)，不涉及儀器原始數據 (tree_measurement_raw)。
 */
exports.createTreeV2 = async (req, res) => {
    const client = await db.pool.connect();
    
    try {
        const { 
            project_area, 
            project_code, 
            project_name,
            species_id,
            species_name,
            x_coord, // 前端傳來可能是 lat/lon 或 x_coord/y_coord，需統一
            y_coord,
            lat,
            lon,
            status,
            note,
            tree_remark,
            tree_height_m,
            height,
            dbh_cm,
            dbh,
            survey_notes,
            survey_remark,
            survey_time,
            carbon_storage,
            carbon_sequestration_per_year,
            carbon_sequestration
        } = req.body;

        await client.query('BEGIN');

        // ---------------------------------------------------------
        // Step 1: 準備專案關聯 (Project Association)
        // ---------------------------------------------------------
        let projectId = null;
        try {
            const checkTable = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'projects'
                );
            `);
            
            if (checkTable.rows[0].exists && project_code) {
                const prjRes = await client.query(
                    'SELECT id FROM projects WHERE project_code = $1', 
                    [project_code]
                );
                if (prjRes.rows.length > 0) {
                    projectId = prjRes.rows[0].id;
                }
            }
        } catch (err) {
            console.warn('Project association skipped in createV2:', err.message);
        }

        // ---------------------------------------------------------
        // Step 1.5: 嘗試查找或驗證 species_id
        // ---------------------------------------------------------
        let finalSpeciesId = species_id;
        // 如果沒有提供 ID 但有提供名稱，嘗試查找
        if ((!finalSpeciesId || finalSpeciesId === '無') && species_name && species_name !== '無') {
            try {
                // 嘗試精確匹配名稱 (中文名稱 或 學名)
                const speciesRes = await client.query(
                    'SELECT id FROM tree_species WHERE name = $1 OR scientific_name = $1', 
                    [species_name]
                );
                if (speciesRes.rows.length > 0) {
                    finalSpeciesId = speciesRes.rows[0].id;
                }
            } catch (err) {
                console.warn('Species lookup failed:', err.message);
            }
        }

        // ---------------------------------------------------------
        // Step 2: 鎖定並生成 ID (Atomic ID Generation)
        // ---------------------------------------------------------
        
        // 使用 Advisory Lock (Key 1) 確保全局序列原子性 (與 Batch Controller 共用同一個 Key)
        await client.query('SELECT pg_advisory_xact_lock(1)');

        // A. System ID
        // [FIX v17.1] 排除佔位記錄 (PLACEHOLDER-*) 以確保 ID 序列正確
        const sysIdRes = await client.query(`
            SELECT MAX(CAST(regexp_replace(system_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id 
            FROM tree_survey 
            WHERE (system_tree_id ~ '^ST-[0-9]+$')
            AND (is_placeholder IS NULL OR is_placeholder = false)
        `);
        let nextSysId = (sysIdRes.rows[0].max_id || 0) + 1;
        const systemTreeId = `ST-${nextSysId}`;

        // B. Project ID
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
        const projectTreeId = project_code ? `PT-${nextPrjId}` : `PT-${Date.now()}`;

        // ---------------------------------------------------------
        // Step 3: 寫入 tree_survey
        // ---------------------------------------------------------
        
        // 參數標準化 (相容前端 V1/V2 不同的命名慣例)
        const finalX = parseFloat(x_coord || lon || 0);
        const finalY = parseFloat(y_coord || lat || 0);
        const finalHeight = parseFloat(tree_height_m || height || 0);
        const finalDbh = parseFloat(dbh_cm || dbh || 0);
        const finalSurveyNote = survey_notes || survey_remark || '無';
        const computedCarbon = carbonCalculationService.calculateCarbonStorage(
            species_name,
            finalDbh,
            finalHeight,
        );
        const finalCarbon = computedCarbon != null
            ? computedCarbon
            : parseFloat(carbon_storage || 0) || null;
        const finalSequestration = parseFloat(carbon_sequestration_per_year || carbon_sequestration || 0);

        const insertSql = `
            INSERT INTO tree_survey 
            (project_code, system_tree_id, project_tree_id, species_id, 
            species_name, x_coord, y_coord, status, notes, tree_notes, tree_height_m, 
            dbh_cm, survey_notes, survey_time, carbon_storage, carbon_sequestration_per_year, project_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id;
        `;
        // project_name / project_location 由 trigger 09 自 projects + project_areas 覆蓋
        // species_name 在 species_id 對得到 tree_species 時也由 trigger 覆蓋，否則保留 caller 值

        const values = [
            project_code || '無',
            systemTreeId,
            projectTreeId,
            finalSpeciesId || '無',
            species_name || '無',
            finalX,
            finalY,
            status || '良好',
            note || '無',
            tree_remark || '無',
            finalHeight,
            finalDbh,
            finalSurveyNote,
            survey_time || new Date().toISOString(),
            finalCarbon,
            finalSequestration,
            projectId
        ];

        const result = await client.query(insertSql, values);
        const newTreeId = result.rows[0].id;
        
        await client.query('COMMIT');

        // Audit Log
        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'CREATE_TREE',
            resourceType: 'tree_survey',
            resourceId: newTreeId,
            details: { 
                systemTreeId, 
                projectTreeId, 
                projectCode: project_code, 
                speciesName: species_name 
            },
            req
        });

        res.status(201).json({
            success: true,
            message: '資料新增成功 (V2)',
            id: newTreeId,
            system_tree_id: systemTreeId,
            project_tree_id: projectTreeId
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('單筆新增失敗 (V2):', err);
        res.status(500).json({ 
            success: false, 
            message: '新增資料時發生錯誤', 
            error: err.message 
        });
    } finally {
        client.release();
    }
};

