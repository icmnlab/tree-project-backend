-- =============================================================
-- 08_text_integrity_check.pg.sql
-- L3 防再犯：對使用者可見的關鍵字串欄位禁止 U+FFFD (REPLACEMENT CHARACTER)
--
-- Rationale: Buffer.toString('utf-8') 對非 UTF-8 byte sequence 會靜默
-- 替換成 U+FFFD，導致前端顯示 "?"。L1 (utils/textValidation.js) 已在
-- 入口攔截，此 constraint 是最後一道防線——萬一未來新增 import 路徑
-- 沒走 L1，DB 直接拒絕寫入而不是默默變成 "?"。
--
-- Idempotent: 重複執行安全 (DROP IF EXISTS + ADD)。
-- =============================================================

DO $$
DECLARE
    target RECORD;
BEGIN
    FOR target IN
        SELECT * FROM (VALUES
            ('tree_survey',      'project_name',     'tree_survey_project_name_no_replacement_char'),
            ('tree_survey',      'project_location', 'tree_survey_project_location_no_replacement_char'),
            ('tree_survey',      'species_name',     'tree_survey_species_name_no_replacement_char'),
            ('tree_species',     'name',             'tree_species_name_no_replacement_char'),
            ('projects',         'name',             'projects_name_no_replacement_char'),
            ('project_areas',    'area_name',        'project_areas_area_name_no_replacement_char')
        ) AS t(table_name, column_name, constraint_name)
    LOOP
        -- Drop existing constraint (if any) for idempotency
        EXECUTE format(
            'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
            target.table_name, target.constraint_name
        );

        -- Add NOT VALID first to avoid blocking deploy on legacy dirty rows.
        -- After scripts/fix_replacement_chars.js cleans them up, future
        -- inserts/updates will be checked by NOT VALID constraints just like
        -- normal ones. We don't VALIDATE here so deploy never fails on
        -- pre-existing dirty rows.
        BEGIN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR position(chr(65533) IN %I) = 0) NOT VALID',
                target.table_name, target.constraint_name, target.column_name, target.column_name
            );
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Skipping %.%: table not found', target.table_name, target.column_name;
            WHEN undefined_column THEN
                RAISE NOTICE 'Skipping %.%: column not found', target.table_name, target.column_name;
        END;
    END LOOP;
END $$;

COMMENT ON CONSTRAINT tree_survey_project_name_no_replacement_char ON tree_survey
    IS 'L3 防線：禁止 U+FFFD 寫入 (見 utils/textValidation.js)';
