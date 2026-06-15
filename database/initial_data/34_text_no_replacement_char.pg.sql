-- ============================================================
-- 34_text_no_replacement_char.pg.sql
-- 亂碼防線（補充）：延伸 08_text_integrity_check 的 U+FFFD CHECK 到其餘自由文字欄位
-- ============================================================
-- 08_text_integrity_check.pg.sql 已涵蓋身分欄位：
--   tree_survey.project_name / project_location / species_name、
--   tree_species.name、projects.name、project_areas.area_name。
-- 本檔僅「補上」08 未涵蓋的 tree_survey 自由文字欄位（status/notes/tree_notes/
-- survey_notes），不重複既有約束。第一道防線在 API 層（utils/textValidation.js
-- 的 findReplacementCharField，已接於 create_v2 / batch_import）。
--
-- 與 08 相同：以 NOT VALID 加入，只強制新 INSERT/UPDATE、不掃描既有列（交接安全）。
-- 冪等：DROP IF EXISTS + ADD。
-- ============================================================

DO $$
DECLARE
    target RECORD;
BEGIN
    FOR target IN
        SELECT * FROM (VALUES
            ('tree_survey', 'status',       'tree_survey_status_no_replacement_char'),
            ('tree_survey', 'notes',        'tree_survey_notes_no_replacement_char'),
            ('tree_survey', 'tree_notes',   'tree_survey_tree_notes_no_replacement_char'),
            ('tree_survey', 'survey_notes', 'tree_survey_survey_notes_no_replacement_char')
        ) AS t(table_name, column_name, constraint_name)
    LOOP
        EXECUTE format(
            'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
            target.table_name, target.constraint_name
        );
        BEGIN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR position(chr(65533) IN %I) = 0) NOT VALID',
                target.table_name, target.constraint_name, target.column_name, target.column_name
            );
        EXCEPTION
            WHEN undefined_column THEN
                RAISE NOTICE 'Skipping %.%: column not found', target.table_name, target.column_name;
        END;
    END LOOP;
END $$;
