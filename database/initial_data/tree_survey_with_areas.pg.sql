-- Drop the view if it exists
DROP VIEW IF EXISTS tree_survey_with_areas;

--
-- 檢視表結構 `tree_survey_with_areas` for PostgreSQL
--
-- [Stage 1 commit 4] 改用 project_id → projects.area_id JOIN（之前用
--   ts.project_location = pa.area_name 字串相等，遇到 projects.name 含
--   「（B1）」suffix 而 tree_survey 不含時整段斷掉）。
--   tree_survey.project_id 已是 FK 並有 trigger 自動填，projects.area_id
--   已 backfill，兩個 JOIN 皆穩定。
--
CREATE VIEW tree_survey_with_areas AS
SELECT
    ts.id,
    ts.project_location,
    ts.project_code,
    ts.project_name,
    ts.system_tree_id,
    ts.project_tree_id,
    ts.species_id,
    ts.species_name,
    ts.x_coord,
    ts.y_coord,
    ts.status,
    ts.notes,
    ts.tree_notes,
    ts.tree_height_m,
    ts.dbh_cm,
    ts.survey_notes,
    ts.survey_time,
    ts.carbon_storage,
    ts.carbon_sequestration_per_year,
    pa.id AS area_id,
    pa.area_code,
    pa.description AS area_description
FROM
    tree_survey ts
LEFT JOIN
    projects p ON ts.project_id = p.id
LEFT JOIN
    project_areas pa ON p.area_id = pa.id;

COMMENT ON VIEW tree_survey_with_areas IS '一個將 tree_survey 和 project_areas 結合的檢視表，方便查詢區域資訊。Stage 1 改用 project_id → projects.area_id JOIN，避免 area_name 字串漂移。';
