-- ============================================================
-- 31_tree_lifecycle_status.pg.sql
-- 樹木「生命週期狀態」(lifecycle_status) — 與既有健康狀態 status 分離
-- ============================================================
-- 值：
--   active  = 存活（預設，納入活立木碳儲量與維護待辦）
--   dead    = 枯死
--   fallen  = 倒塌
--   removed = 移除 / 砍除
--
-- 淘汰木（dead/fallen/removed）依政府「活立木生物量法」(環境部 AR-TMS0001、
-- 林業署森林碳匯調查與監測手冊 表6-4) 不屬活立木 → 不計入活立木碳儲量總計；
-- 軟性淘汰：保留歷史與照片、不列入維護待辦、地圖以灰階呈現、可復原。
-- ============================================================

ALTER TABLE tree_survey ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE tree_survey ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE tree_survey ADD COLUMN IF NOT EXISTS retired_reason TEXT;

-- 既有資料回填：依健康 status 文字保守判斷明確的淘汰字樣（只認明確關鍵字）
UPDATE tree_survey
   SET lifecycle_status = 'removed',
       retired_at = COALESCE(retired_at, updated_at, CURRENT_TIMESTAMP),
       retired_reason = COALESCE(retired_reason, status)
 WHERE lifecycle_status = 'active'
   AND status IS NOT NULL
   AND (status LIKE '%移除%' OR status LIKE '%砍除%' OR status LIKE '%砍伐%');

UPDATE tree_survey
   SET lifecycle_status = 'dead',
       retired_at = COALESCE(retired_at, updated_at, CURRENT_TIMESTAMP),
       retired_reason = COALESCE(retired_reason, status)
 WHERE lifecycle_status = 'active'
   AND status IS NOT NULL
   AND (status LIKE '%枯死%' OR status LIKE '%死亡%');

UPDATE tree_survey
   SET lifecycle_status = 'fallen',
       retired_at = COALESCE(retired_at, updated_at, CURRENT_TIMESTAMP),
       retired_reason = COALESCE(retired_reason, status)
 WHERE lifecycle_status = 'active'
   AND status IS NOT NULL
   AND status LIKE '%倒塌%';

CREATE INDEX IF NOT EXISTS idx_tree_survey_lifecycle ON tree_survey(lifecycle_status);

COMMENT ON COLUMN tree_survey.lifecycle_status IS '生命週期 active|dead|fallen|removed；淘汰木不計入活立木碳儲量總計（活立木生物量法）';
COMMENT ON COLUMN tree_survey.retired_at IS '淘汰（死亡/倒塌/移除）時間；可復原後清空';
COMMENT ON COLUMN tree_survey.retired_reason IS '淘汰原因備註（沿用當時樹況或人工輸入）';
