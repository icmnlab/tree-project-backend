-- [歷史紀錄] 將既有 tree_survey 最新快照回填為第一筆歷次（僅無歷次者）
-- 部署前已存在的樹木，transfer 啟用後才有新歷次；此腳本補一筆 baseline。

INSERT INTO tree_survey_measurements (
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
    survey_mode
)
SELECT
    ts.id,
    NULL,
    COALESCE(ts.survey_time, CURRENT_TIMESTAMP),
    ts.tree_height_m,
    ts.dbh_cm,
    ts.species_name,
    ts.species_id,
    ts.status,
    COALESCE(NULLIF(TRIM(ts.survey_notes), ''), '[baseline] 自 tree_survey 快照回填'),
    ts.carbon_storage,
    ts.x_coord,
    ts.y_coord,
    'snapshot'
FROM tree_survey ts
WHERE NOT EXISTS (
    SELECT 1 FROM tree_survey_measurements tsm WHERE tsm.tree_id = ts.id
);

COMMENT ON COLUMN tree_survey_measurements.survey_mode IS
  'new=初測；maintenance=維護重測；snapshot=部署前快照回填';
