/**
 * CSV 匯入控制器
 * 
 * 兩步驟 API（防止意外覆蓋）：
 * 1. preview — 上傳 CSV，回傳分析結果（不寫入）
 * 2. execute — 確認後執行匯入
 */

const db = require('../config/db');
const { parse } = require('csv-parse/sync');
const AuditLogService = require('../services/auditLogService');
const { decodeBufferAuto, assertCleanUtf8, EncodingError } = require('../utils/textValidation');

// ================================================================
// 欄位映射表：支援中英文欄位名
// ================================================================
const FIELD_MAP = {
    'project_location': 'project_location',
    '專案區位': 'project_location',
    'project_code': 'project_code',
    '專案代碼': 'project_code',
    'project_name': 'project_name',
    '專案名稱': 'project_name',
    'system_tree_id': 'system_tree_id',
    '系統樹木': 'system_tree_id',
    'project_tree_id': 'project_tree_id',
    '專案樹木': 'project_tree_id',
    'species_id': 'species_id',
    '樹種編號': 'species_id',
    'species_name': 'species_name',
    '樹種名稱': 'species_name',
    'x_coord': 'x_coord',
    'X坐標': 'x_coord',
    '經度': 'x_coord',
    'y_coord': 'y_coord',
    'Y坐標': 'y_coord',
    '緯度': 'y_coord',
    'status': 'status',
    '狀況': 'status',
    'tree_height_m': 'tree_height_m',
    '樹高（公尺）': 'tree_height_m',
    '樹高': 'tree_height_m',
    'dbh_cm': 'dbh_cm',
    '胸徑（公分）': 'dbh_cm',
    '胸徑': 'dbh_cm',
    'notes': 'notes',
    '註記': 'notes',
    'tree_notes': 'tree_notes',
    '樹木備註': 'tree_notes',
    'survey_notes': 'survey_notes',
    '調查備註': 'survey_notes',
    'survey_time': 'survey_time',
    '調查時間': 'survey_time',
    'carbon_storage': 'carbon_storage',
    '碳儲存量': 'carbon_storage',
    'carbon_sequestration_per_year': 'carbon_sequestration_per_year',
    '推估年碳吸存量': 'carbon_sequestration_per_year',
};

// 必要欄位
const REQUIRED_FIELDS = ['project_code', 'project_name', 'species_name'];

// ================================================================
// 極端值偵測閾值
// ================================================================
const OUTLIER_RULES = {
    dbh_cm: { min: 1, max: 200, label: '胸徑 (cm)' },
    tree_height_m: { min: 0.5, max: 50, label: '樹高 (m)' },
    x_coord: { min: 119.0, max: 122.5, label: 'X 座標（經度）' },
    y_coord: { min: 21.5, max: 25.5, label: 'Y 座標（緯度）' },
};

// ================================================================
// Preview API
// ================================================================
async function preview(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '請上傳 CSV 檔案' });
        }

        // [L1 reject] Strict encoding validation: detect non-UTF8 (BIG5/GBK/...)
        // and decode safely. Refuse anything that still contains U+FFFD so we
        // never write "?" placeholders into the database.
        let csvString;
        let detectedEncoding;
        try {
            const decoded = decodeBufferAuto(req.file.buffer, { contextLabel: 'CSV 檔案' });
            csvString = decoded.text;
            detectedEncoding = decoded.encoding;
        } catch (encErr) {
            if (encErr instanceof EncodingError) {
                return res.status(400).json({
                    success: false,
                    message: encErr.message,
                    detected: encErr.detected,
                    sample: encErr.sample,
                });
            }
            throw encErr;
        }

        let records;
        try {
            records = parse(csvString, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
            });
        } catch (parseErr) {
            return res.status(400).json({
                success: false,
                message: `CSV 解析失敗: ${parseErr.message}`
            });
        }

        if (records.length === 0) {
            return res.status(400).json({ success: false, message: 'CSV 檔案無有效資料' });
        }

        // 1. 欄位映射
        const csvHeaders = Object.keys(records[0]);
        const mappedFields = {};
        const unmappedFields = [];

        for (const header of csvHeaders) {
            const mapped = FIELD_MAP[header.trim()];
            if (mapped) {
                mappedFields[header] = mapped;
            } else {
                unmappedFields.push(header);
            }
        }

        // 檢查必要欄位
        const mappedValues = Object.values(mappedFields);
        const missingFields = REQUIRED_FIELDS.filter(f => !mappedValues.includes(f));

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `缺少必要欄位: ${missingFields.join(', ')}`,
                mappedFields,
                unmappedFields,
                missingFields
            });
        }

        // 2. 標準化資料
        const normalizedRecords = records.map((row, idx) => {
            const normalized = { _rowIndex: idx + 2 }; // CSV row number (header = 1)
            for (const [csvKey, dbKey] of Object.entries(mappedFields)) {
                const val = row[csvKey];
                normalized[dbKey] = val === '' || val === undefined ? null : val;
            }
            // 數值欄位轉換
            for (const numField of ['x_coord', 'y_coord', 'tree_height_m', 'dbh_cm', 'carbon_storage', 'carbon_sequestration_per_year']) {
                if (normalized[numField] !== null && normalized[numField] !== undefined) {
                    const num = parseFloat(normalized[numField]);
                    normalized[numField] = isNaN(num) ? null : num;
                }
            }
            return normalized;
        });

        // 3. 驗證 & 分類
        const errors = [];
        const outliers = [];
        const validRecords = [];

        for (const row of normalizedRecords) {
            const rowErrors = [];

            // 必填欄位驗證
            if (!row.project_code) rowErrors.push('缺少專案代碼');
            if (!row.species_name) rowErrors.push('缺少樹種名稱');

            if (rowErrors.length > 0) {
                errors.push({ row: row._rowIndex, errors: rowErrors, data: row });
                continue;
            }

            // 極端值偵測
            const rowOutliers = [];
            for (const [field, rule] of Object.entries(OUTLIER_RULES)) {
                const val = row[field];
                if (val !== null && val !== undefined) {
                    if (val < rule.min || val > rule.max) {
                        rowOutliers.push({
                            field: rule.label,
                            value: val,
                            range: `${rule.min} ~ ${rule.max}`
                        });
                    }
                }
            }

            if (rowOutliers.length > 0) {
                outliers.push({ row: row._rowIndex, outliers: rowOutliers, data: row });
            }

            validRecords.push(row);
        }

        // 4. 重複偵測 — 與 DB 現有資料比對
        const projectCodes = [...new Set(validRecords.map(r => r.project_code).filter(Boolean))];
        let existingByCoord = [];
        let existingByTreeId = [];

        if (projectCodes.length > 0) {
            // 以 (project_code, x_coord, y_coord) 比對
            const { rows: coordRows } = await db.query(`
                SELECT id, project_code, x_coord, y_coord, project_tree_id, species_name
                FROM tree_survey
                WHERE project_code = ANY($1::text[])
                  AND (is_placeholder IS NULL OR is_placeholder = false)
            `, [projectCodes]);
            existingByCoord = coordRows;

            // 以 (project_code, project_tree_id) 比對
            existingByTreeId = coordRows.filter(r => r.project_tree_id);
        }

        const duplicates = [];
        const newRecords = [];
        const updatedRecords = [];

        for (const row of validRecords) {
            let isDuplicate = false;

            // 方法 1: project_tree_id 精確比對
            if (row.project_tree_id) {
                const match = existingByTreeId.find(
                    e => e.project_code === row.project_code && e.project_tree_id === row.project_tree_id
                );
                if (match) {
                    updatedRecords.push({ row: row._rowIndex, existingId: match.id, data: row, matchType: 'project_tree_id' });
                    isDuplicate = true;
                }
            }

            // 方法 2: 座標距離 < 2m 比對（同專案）
            if (!isDuplicate && row.x_coord && row.y_coord) {
                for (const existing of existingByCoord) {
                    if (existing.project_code !== row.project_code) continue;
                    if (!existing.x_coord || !existing.y_coord) continue;

                    const dist = haversineDistance(
                        row.y_coord, row.x_coord,
                        parseFloat(existing.y_coord), parseFloat(existing.x_coord)
                    );
                    if (dist < 2) { // 2 公尺以內視為同一棵樹
                        duplicates.push({
                            row: row._rowIndex,
                            existingId: existing.id,
                            distance: Math.round(dist * 100) / 100,
                            data: row,
                            existingData: existing
                        });
                        isDuplicate = true;
                        break;
                    }
                }
            }

            if (!isDuplicate) {
                newRecords.push(row);
            }
        }

        // 回傳預覽結果
        const previewData = {
            totalRows: records.length,
            newRecords: newRecords.map(r => ({ row: r._rowIndex, data: r })),
            updatedRecords,
            duplicates,
            outliers,
            errors,
            missingFields: missingFields.length > 0 ? missingFields : undefined,
            unmappedFields: unmappedFields.length > 0 ? unmappedFields : undefined,
            fieldMapping: mappedFields,
            summary: {
                total: records.length,
                new: newRecords.length,
                update: updatedRecords.length,
                duplicate: duplicates.length,
                outlier: outliers.length,
                error: errors.length,
            }
        };

        res.json({ success: true, preview: previewData });

    } catch (err) {
        console.error('[CSV Import] Preview error:', err);
        res.status(500).json({ success: false, message: '預覽匯入時發生錯誤' });
    }
}

// ================================================================
// Execute API
// ================================================================
async function execute(req, res) {
    const client = await db.pool.connect();
    try {
        const { newRecords, updatedRecords, skipDuplicates, outlierAction } = req.body;

        if (!newRecords && !updatedRecords) {
            return res.status(400).json({ success: false, message: '無匯入資料' });
        }

        await client.query('BEGIN');
        // [併發] 統一用 key 1：所有「產生 tree_survey 的 system_tree_id / project_tree_id」
        // 的路徑（create_v2、batch、transfer、CSV execute）必須共用同一把 advisory lock，
        // 否則併發時各自 MAX+1 會產生相同 ID。配合 DB 唯一約束作最後防線。
        await client.query('SELECT pg_advisory_xact_lock(1)');

        let insertedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        const importErrors = [];

        // 自動建立不存在的 projects 記錄
        const allRecords = [...(newRecords || []), ...(updatedRecords || [])];
        const projectCodesInBatch = [...new Set(allRecords.map(r => {
            const data = r.data || r;
            return data.project_code;
        }).filter(Boolean))];

        for (const code of projectCodesInBatch) {
            const record = allRecords.find(r => (r.data || r).project_code === code);
            const data = record?.data || record;
            try {
                await client.query(`
                    INSERT INTO projects (project_code, name, description)
                    VALUES ($1, $2, '由 CSV 匯入自動建立')
                    ON CONFLICT (project_code) DO NOTHING
                `, [code, data?.project_name || '未命名專案']);

                // 嘗試關聯 area_id
                if (data?.project_location) {
                    const { rows: areaRows } = await client.query(
                        'SELECT id FROM project_areas WHERE area_name = $1 LIMIT 1',
                        [data.project_location]
                    );
                    if (areaRows.length > 0) {
                        await client.query(
                            'UPDATE projects SET area_id = $1 WHERE project_code = $2 AND area_id IS NULL',
                            [areaRows[0].id, code]
                        );
                    }
                }
            } catch (e) {
                console.warn(`[CSV Import] 自動建立專案 ${code} 失敗:`, e.message);
            }
        }

        // 查詢現有的最大 system_tree_id
        const { rows: sysIdRows } = await client.query(`
            SELECT MAX(CAST(regexp_replace(system_tree_id, '[^0-9]', '', 'g') AS INTEGER)) AS max_id
            FROM tree_survey
            WHERE system_tree_id ~ '^ST-[0-9]+$'
              AND (is_placeholder IS NULL OR is_placeholder = false)
        `);
        let nextSysId = (sysIdRows[0].max_id ?? 0) + 1;

        // 預查各專案的最大 project_tree_id
        const projectMaxIds = {};
        for (const code of projectCodesInBatch) {
            const { rows: pidRows } = await client.query(`
                SELECT MAX(CAST(regexp_replace(project_tree_id, '[^0-9]', '', 'g') AS INTEGER)) AS max_id
                FROM tree_survey
                WHERE project_code = $1
                  AND (project_tree_id ~ '^PT-[0-9]+$' OR project_tree_id ~ '^[0-9]+$')
                  AND project_tree_id != 'PT-0'
                  AND (is_placeholder IS NULL OR is_placeholder = false)
            `, [code]);
            projectMaxIds[code] = pidRows[0].max_id ?? 0;
        }

        // 插入新記錄
        if (newRecords && newRecords.length > 0) {
            for (const record of newRecords) {
                const data = record.data || record;
                try {
                    // 自動生成 ID
                    const sysId = data.system_tree_id || `ST-${nextSysId++}`;
                    let projTreeId = data.project_tree_id;
                    if (!projTreeId && data.project_code) {
                        projectMaxIds[data.project_code] = (projectMaxIds[data.project_code] || 0) + 1;
                        projTreeId = `PT-${projectMaxIds[data.project_code]}`;
                    }

                    await client.query(`
                        INSERT INTO tree_survey (
                            project_code,
                            system_tree_id, project_tree_id,
                            species_id, species_name,
                            x_coord, y_coord, status,
                            notes, tree_notes, survey_notes,
                            tree_height_m, dbh_cm,
                            carbon_storage, carbon_sequestration_per_year,
                            survey_time
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                    `, [
                        data.project_code,
                        sysId, projTreeId,
                        data.species_id, data.species_name,
                        data.x_coord, data.y_coord, data.status || '正常',
                        data.notes, data.tree_notes, data.survey_notes,
                        data.tree_height_m, data.dbh_cm,
                        data.carbon_storage, data.carbon_sequestration_per_year,
                        data.survey_time || null
                    ]);
                    // project_location / project_name 由 trigger 09 自 projects + project_areas 覆蓋
                    insertedCount++;
                } catch (insertErr) {
                    importErrors.push({
                        row: record.row,
                        error: insertErr.message,
                        data
                    });
                }
            }
        }

        // 更新現有記錄
        if (updatedRecords && updatedRecords.length > 0) {
            for (const record of updatedRecords) {
                const data = record.data || record;
                const existingId = record.existingId;
                if (!existingId) {
                    skippedCount++;
                    continue;
                }

                try {
                    const updateFields = [];
                    const updateValues = [];
                    let idx = 1;

                    const updatableFields = [
                        'species_name', 'species_id', 'x_coord', 'y_coord',
                        'tree_height_m', 'dbh_cm', 'status',
                        'notes', 'tree_notes', 'survey_notes',
                        'carbon_storage', 'carbon_sequestration_per_year',
                        'survey_time'
                        // project_location 由 trigger 09 自 projects + project_areas 覆蓋
                    ];

                    for (const field of updatableFields) {
                        if (data[field] !== null && data[field] !== undefined) {
                            updateFields.push(`${field} = $${idx}`);
                            updateValues.push(data[field]);
                            idx++;
                        }
                    }

                    if (updateFields.length > 0) {
                        updateValues.push(existingId);
                        await client.query(
                            `UPDATE tree_survey SET ${updateFields.join(', ')} WHERE id = $${idx}`,
                            updateValues
                        );
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (updateErr) {
                    importErrors.push({
                        row: record.row,
                        error: updateErr.message,
                        existingId
                    });
                }
            }
        }

        if (importErrors.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: `匯入失敗 ${importErrors.length} 筆，已全部復原`,
                report: {
                    inserted: 0,
                    updated: 0,
                    skipped: skippedCount,
                    errors: importErrors,
                },
            });
        }

        await client.query('COMMIT');

        // 審計日誌
        await AuditLogService.log({
            userId: req.user?.user_id,
            username: req.user?.username,
            action: 'CSV_IMPORT',
            resourceType: 'tree_survey',
            details: {
                inserted: insertedCount,
                updated: updatedCount,
                skipped: skippedCount,
                errors: 0,
                projects: projectCodesInBatch
            },
            req
        });

        res.json({
            success: true,
            message: '匯入完成',
            report: {
                inserted: insertedCount,
                updated: updatedCount,
                skipped: skippedCount,
                errors: importErrors,
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CSV Import] Execute error:', err);
        res.status(500).json({ success: false, message: '執行匯入時發生錯誤' });
    } finally {
        client.release();
    }
}

// ================================================================
// 輔助函數
// ================================================================

/**
 * Haversine 距離公式（公尺）
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { preview, execute };
