-- ============================================================
-- 34_text_no_replacement_char.pg.sql
-- 亂碼防線：禁止 U+FFFD（REPLACEMENT CHARACTER）寫入關鍵文字欄位
-- ============================================================
-- U+FFFD（chr(65533)，顯示為「�」）是「以錯誤編碼解碼位元組」時的替代字元，
-- 一旦寫入便永久損毀且無法還原。第一道防線在 API 層（utils/textValidation.js），
-- 此 CHECK 為資料庫層第二道防線（defense in depth）。
--
-- 以 NOT VALID 加入：僅強制套用於新的 INSERT/UPDATE，不掃描既有列，
-- 交接安全（既有資料若已含亂碼不會導致 migration 失敗，可日後清理後再 VALIDATE）。
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_tree_survey_no_replacement_char'
  ) THEN
    ALTER TABLE tree_survey
      ADD CONSTRAINT chk_tree_survey_no_replacement_char
      CHECK (
        position(chr(65533) IN COALESCE(species_name, '')) = 0
        AND position(chr(65533) IN COALESCE(status, '')) = 0
        AND position(chr(65533) IN COALESCE(notes, '')) = 0
        AND position(chr(65533) IN COALESCE(tree_notes, '')) = 0
        AND position(chr(65533) IN COALESCE(survey_notes, '')) = 0
        AND position(chr(65533) IN COALESCE(project_name, '')) = 0
        AND position(chr(65533) IN COALESCE(project_location, '')) = 0
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT chk_tree_survey_no_replacement_char ON tree_survey
  IS '禁止 U+FFFD 亂碼寫入關鍵文字欄位（編碼錯誤防護；API 層 textValidation.js 為第一道防線）';
