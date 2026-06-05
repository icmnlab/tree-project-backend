-- [併發安全] tree_survey 樹木 ID 唯一約束（最後防線）
--
-- 背景：system_tree_id / project_tree_id 由應用層用 advisory lock 配號，
-- 但歷史上有多條寫入路徑（create_v2 / batch / transfer / CSV / 舊 XLSX import）
-- 鎖 key 不一致，併發時可能產生重複 ID。本檔加 DB 層唯一索引作為最後防線：
-- 即使應用層出錯，重複插入也會被 DB 擋下（23505）而非靜默寫入。
--
-- 安全性：
--  * 使用 partial unique index，排除 placeholder 佔位列。
--  * 全部包在 DO + EXCEPTION：若現有資料已有重複，僅 RAISE WARNING 不中斷部署，
--    讓維運者先清重複再重跑（避免 deploy 直接失敗）。
--  * IF NOT EXISTS 確保可重複執行（冪等）。

-- 1) system_tree_id 全域唯一（排除 placeholder）
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tree_survey_system_tree_id
      ON tree_survey (system_tree_id)
      WHERE (is_placeholder IS NULL OR is_placeholder = false);
    RAISE NOTICE 'uq_tree_survey_system_tree_id ready';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'uq_tree_survey_system_tree_id 未建立（可能有重複 system_tree_id，請先清重複）: %', SQLERRM;
  END;
END $$;

-- 2) (project_code, project_tree_id) 專案內唯一（排除 placeholder / 空值 / PT-0）
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tree_survey_project_tree_id
      ON tree_survey (project_code, project_tree_id)
      WHERE (is_placeholder IS NULL OR is_placeholder = false)
        AND project_code IS NOT NULL
        AND project_tree_id IS NOT NULL
        AND project_tree_id <> 'PT-0';
    RAISE NOTICE 'uq_tree_survey_project_tree_id ready';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'uq_tree_survey_project_tree_id 未建立（可能有重複 project_tree_id，請先清重複）: %', SQLERRM;
  END;
END $$;
