const db = require('../config/db');
const AuditLogService = require('../services/auditLogService');
const carbonCalculationService = require('../services/carbonCalculationService');
const { lifecycleFromStatus } = require('../utils/treeLifecycle');
const { toTraditional } = require('../utils/chineseConvert');

/**
 * 更新單筆樹木調查資料 (v2)
 *
 * 特性：
 * 1. 兼容 V2 命名慣例 (snake_case)。
 * 2. 動態生成 UPDATE 語句，只更新提供的欄位。
 * 3. 包含基本的錯誤處理和存在性檢查。
 */
exports.updateTreeV2 = async (req, res) => {
    const { id } = req.params;
    const client = await db.pool.connect();

    try {
        const {
            project_area,
            project_code,
            project_name,
            species_id,
            species_name,
            x_coord,
            y_coord,
            status,
            note,
            tree_remark,
            tree_height_m,
            dbh_cm,
            survey_notes,
            survey_time,
            carbon_storage,
            carbon_sequestration_per_year,
            expected_updated_at, // [T6] 樂觀鎖：前端編輯前讀到的 updated_at
        } = req.body;

        // [T6] expected_updated_at 不算「要更新的欄位」
        const bodyKeys = Object.keys(req.body).filter(k => k !== 'expected_updated_at');
        if (bodyKeys.length === 0) {
            return res.status(400).json({ success: false, message: '沒有提供要更新的資料' });
        }

        await client.query('BEGIN');

        // [T6] 取整列 + updated_at，用於樂觀鎖比對 + 衝突時回傳 server 版本給前端
        const checkExist = await client.query('SELECT * FROM tree_survey WHERE id = $1', [id]);
        if (checkExist.rows.length === 0) {
            await client.query('ROLLBACK');
            // S5：A 刪了 / B 改 → 410 Gone（前端應提示「資料已被刪除」）
            return res.status(410).json({ success: false, message: '資料已不存在或已被刪除', code: 'DELETED' });
        }
        const existingTree = checkExist.rows[0];

        const finalDbhEarly = dbh_cm ?? req.body.dbh;
        if (finalDbhEarly !== undefined && finalDbhEarly !== null) {
            const { assertHandbookDbhWrite } = require('../utils/handbookDbhGuard');
            const meta = req.body.v3_metadata || {};
            const method = req.body.measurement_method ?? meta.measurement_method;
            let dbhSource = req.body.dbh_source || 'manual';
            if (method === 'remote_diameter') dbhSource = 'remote_diameter';
            else if (method && /vision/i.test(String(method))) dbhSource = 'vision';

            const dbhCheck = assertHandbookDbhWrite({
                dbhSource,
                researchMode: req.body.research_mode === true,
                measuredDbhCm: finalDbhEarly,
            });
            if (!dbhCheck.ok) {
                await client.query('ROLLBACK');
                return res.status(422).json({
                    success: false,
                    code: 'HANDBOOK_DBH',
                    message: dbhCheck.message,
                });
            }
        }

        // [T6][S1] 樂觀鎖：毫秒 pre-check；通過後僅用 id 更新（避免微秒 WHERE 假 409）
        if (expected_updated_at) {
            const serverUpdatedAt = existingTree.updated_at;
            const serverTs = new Date(serverUpdatedAt).getTime();
            const clientTs = new Date(expected_updated_at).getTime();
            if (Number.isFinite(serverTs) && Number.isFinite(clientTs) && serverTs !== clientTs) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    code: 'CONFLICT',
                    message: '資料已被其他人修改，請重新整理',
                    serverVersion: existingTree,
                });
            }
        }

        // 準備專案關聯 (如果提供了 project_code)
        let projectId = null;
        if (project_code) {
            try {
                const prjRes = await client.query(
                    'SELECT id FROM projects WHERE project_code = $1',
                    [project_code]
                );
                if (prjRes.rows.length > 0) {
                    projectId = prjRes.rows[0].id;
                }
            } catch (err) {
                // projects table might not exist, skip silently
                console.warn('Project association skipped in updateV2:', err.message);
            }
        }


        // 欄位別名容錯（相容 V1/V2 不同命名）
        const finalX = x_coord ?? req.body.lon;
        const finalY = y_coord ?? req.body.lat;
        const finalHeight = tree_height_m ?? req.body.height;
        const finalDbh = dbh_cm ?? req.body.dbh;
        const finalSurveyNotes = survey_notes ?? req.body.survey_remark;

        // 如果 project_tree_id 有提供且專案已變更，需要驗證唯一性
        let finalProjectTreeId = req.body.project_tree_id;
        const targetProjectCode = project_code ?? existingTree.project_code;
        if (finalProjectTreeId && targetProjectCode) {
            try {
                const dupCheck = await client.query(
                    `SELECT id FROM tree_survey 
                     WHERE project_code = $1 AND project_tree_id = $2 AND id != $3
                     AND (is_placeholder IS NULL OR is_placeholder = false)`,
                    [targetProjectCode, finalProjectTreeId, id]
                );
                if (dupCheck.rows.length > 0) {
                    // 編號已被佔用，用 advisory lock 生成新的
                    await client.query('SELECT pg_advisory_xact_lock(1)');
                    const prjIdRes = await client.query(`
                        SELECT MAX(CAST(regexp_replace(project_tree_id, '[^0-9]', '', 'g') AS INTEGER)) as max_id 
                        FROM tree_survey 
                        WHERE project_code = $1 
                        AND (project_tree_id ~ '^PT-[0-9]+$' OR project_tree_id ~ '^[0-9]+$')
                        AND project_tree_id != 'PT-0'
                        AND (is_placeholder IS NULL OR is_placeholder = false)
                    `, [targetProjectCode]);
                    const nextPrjId = (prjIdRes.rows[0].max_id ?? 0) + 1;
                    finalProjectTreeId = `PT-${nextPrjId}`;
                    console.log(`[UpdateV2] project_tree_id collision resolved: ${req.body.project_tree_id} -> ${finalProjectTreeId}`);
                }
            } catch (err) {
                console.warn('[UpdateV2] project_tree_id validation skipped:', err.message);
            }
        }

        // 樹種名統一台灣繁體（避免第三方辨識回傳簡體入庫造成繁簡混雜）
        const normSpeciesName = species_name !== undefined ? toTraditional(species_name) : undefined;
        const effSpecies = normSpeciesName !== undefined ? normSpeciesName : existingTree.species_name;
        const effDbh = finalDbh !== undefined ? parseFloat(finalDbh) : parseFloat(existingTree.dbh_cm);
        const effHeight = finalHeight !== undefined
            ? parseFloat(finalHeight)
            : parseFloat(existingTree.tree_height_m);
        let resolvedCarbon = carbon_storage;
        const dimTouched =
            species_name !== undefined
            || finalDbh !== undefined
            || finalHeight !== undefined;
        if (dimTouched) {
            const computed = carbonCalculationService.calculateCarbonStorage(
                effSpecies,
                effDbh,
                effHeight,
            );
            if (computed != null) resolvedCarbon = computed;
        }

        // 動態構建 SET 子句
        const updates = [];
        const values = [];
        let queryIndex = 1;

        const fieldMapping = {
            // project_location / project_name 由 trigger 09 自 projects + project_areas 覆蓋
            // 若 caller 改了 project_code/project_id，trigger 會自動重抓對應 cache
            project_code: project_code,
            species_id: species_id,
            species_name: normSpeciesName,
            x_coord: finalX,
            y_coord: finalY,
            status: status,
            notes: note,
            tree_notes: tree_remark,
            tree_height_m: finalHeight,
            dbh_cm: finalDbh,
            survey_notes: finalSurveyNotes,
            survey_time: survey_time,
            carbon_storage: resolvedCarbon,
            carbon_sequestration_per_year: carbon_sequestration_per_year,
            project_id: projectId,
            project_tree_id: finalProjectTreeId
        };
        
        for (const [dbField, value] of Object.entries(fieldMapping)) {
            if (value !== undefined) {
                updates.push(`${dbField} = $${queryIndex++}`);
                values.push(value);
            }
        }

        // [生命週期] 編輯時若有更改樹況，連動 lifecycle_status（與新增/維護流程一致）：
        // 標記枯死/倒塌/移除 → 設淘汰並記 retired_at/reason；改回存活字樣 → 清空淘汰欄位。
        if (status !== undefined) {
            const lifecycle = lifecycleFromStatus(status) ?? 'active';
            updates.push(`lifecycle_status = $${queryIndex++}`);
            values.push(lifecycle);
            if (lifecycle !== 'active') {
                updates.push(`retired_at = COALESCE(retired_at, $${queryIndex++})`);
                values.push(survey_time || new Date().toISOString());
                updates.push(`retired_reason = $${queryIndex++}`);
                values.push(status);
            } else {
                updates.push('retired_at = NULL');
                updates.push('retired_reason = NULL');
            }
        }

        if (updates.length === 0) {
            // 雖然 body 有 key，但都不是我們要更新的欄位
            // [併發] 已 BEGIN，必須先 ROLLBACK 釋放交易，否則連線停在 open transaction
            // 直到 timeout，高併發下會耗盡連線池。
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: '沒有有效的更新欄位' });
        }
        
        values.push(id); // 倒數第二個參數是 WHERE 條件的 id
        const idIndex = queryIndex++;

        // [T6][S5] 用 RETURNING 取得新 updated_at；若 rowCount=0 視為被刪 → 410
        const sql = `UPDATE tree_survey SET ${updates.join(', ')} WHERE id = $${idIndex} RETURNING id, updated_at`;

        const updateRes = await client.query(sql, values);
        if (updateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            // SELECT 後 UPDATE 前，資料被改或被刪
            const reCheck = await db.query('SELECT * FROM tree_survey WHERE id = $1', [id]);
            if (reCheck.rows.length === 0) {
                return res.status(410).json({ success: false, code: 'DELETED', message: '資料已不存在或已被刪除' });
            }
            return res.status(409).json({
                success: false,
                code: 'CONFLICT',
                message: '資料已被其他人修改，請重新整理',
                serverVersion: reCheck.rows[0],
            });
        }
        const newUpdatedAt = updateRes.rows[0].updated_at;
        await client.query('COMMIT');

        // Audit Log
        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'UPDATE_TREE',
            resourceType: 'tree_survey',
            resourceId: id,
            details: { 
                updatedFields: Object.keys(fieldMapping).filter(k => fieldMapping[k] !== undefined),
                projectCode: project_code || existingTree.project_code
            },
            req
        });

        res.status(200).json({
            success: true,
            message: '樹木資料更新成功 (V2)',
            data: { id: id, ...req.body, updated_at: newUpdatedAt }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('更新樹木資料失敗 (V2):', err);
        res.status(500).json({
            success: false,
            message: '更新資料時發生錯誤',
            error: err.message
        });
    } finally {
        client.release();
    }
};
