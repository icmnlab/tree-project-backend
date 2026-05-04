-- ============================================
-- Stage 2 / commit 9: projects rename cascade
--
-- 配合 09 號 BEFORE trigger 把 tree_survey cache cols 同步化。本檔處理
-- 「canonical 端 (projects) 改了之後，cache 端 (tree_survey,
-- pending_tree_measurements) 同步追上」這個方向。
--
-- 為什麼需要：
--   - 09 號 BEFORE trigger 只在 tree_survey INSERT/UPDATE 時觸發；
--     若僅改 projects.name 不動 tree_survey，所有舊 row 的 project_name
--     仍會停在舊值 → drift 重現。
--   - 將來會新增 PUT /projects/:code 改名 API；本 cascade trigger 確保
--     只要 canonical 動，所有 cache 一律自動跟。
--
-- 設計：
--   * AFTER UPDATE OF (name, project_code, area_id) ON projects
--   * 只有真正變動 (IS DISTINCT FROM) 才執行 UPDATE，避免無謂 IO
--   * 同時更新 tree_survey 與 pending_tree_measurements
--     (pending 表的 cache 欄位稱呼是 project_area / project_name / project_code，
--      與 tree_survey 的 project_location / project_name / project_code 對應)
--   * 不更新 user_projects (它是 FK by project_code 不存任何字串)
--   * 不在這 trigger 動 species_name (commit 10 處理)
-- ============================================

CREATE OR REPLACE FUNCTION cascade_projects_rename()
RETURNS TRIGGER AS $$
DECLARE
    new_area_name TEXT;
BEGIN
    -- 解析新的 area_name (供 cache 同步)
    IF NEW.area_id IS NOT NULL THEN
        SELECT area_name INTO new_area_name
        FROM project_areas WHERE id = NEW.area_id LIMIT 1;
    END IF;

    -- tree_survey: cache 三欄
    IF (OLD.name IS DISTINCT FROM NEW.name)
       OR (OLD.project_code IS DISTINCT FROM NEW.project_code)
       OR (OLD.area_id IS DISTINCT FROM NEW.area_id)
    THEN
        UPDATE tree_survey
        SET project_name     = NEW.name,
            project_code     = NEW.project_code,
            project_location = COALESCE(new_area_name, project_location)
        WHERE project_id = NEW.id
          AND (
                project_name IS DISTINCT FROM NEW.name
             OR project_code IS DISTINCT FROM NEW.project_code
             OR (new_area_name IS NOT NULL AND project_location IS DISTINCT FROM new_area_name)
          );
    END IF;

    -- pending_tree_measurements: 用 project_code 對映 (此表沒有 project_id FK)
    IF (OLD.name IS DISTINCT FROM NEW.name)
       OR (OLD.project_code IS DISTINCT FROM NEW.project_code)
       OR (OLD.area_id IS DISTINCT FROM NEW.area_id)
    THEN
        UPDATE pending_tree_measurements
        SET project_name = NEW.name,
            project_code = NEW.project_code,
            project_area = COALESCE(new_area_name, project_area)
        WHERE project_code = OLD.project_code
          AND (
                project_name IS DISTINCT FROM NEW.name
             OR project_code IS DISTINCT FROM NEW.project_code
             OR (new_area_name IS NOT NULL AND project_area IS DISTINCT FROM new_area_name)
          );
    END IF;

    RETURN NULL;  -- AFTER trigger 回傳值被忽略
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_cascade_projects_rename ON projects;
CREATE TRIGGER trigger_cascade_projects_rename
AFTER UPDATE OF name, project_code, area_id ON projects
FOR EACH ROW
EXECUTE FUNCTION cascade_projects_rename();

COMMENT ON FUNCTION cascade_projects_rename()
    IS 'Stage 2 commit 9: projects 改名 / 改 code / 改 area_id 時自動同步 tree_survey + pending_tree_measurements 的 denormalized cache 欄位';
