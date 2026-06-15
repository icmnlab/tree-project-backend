-- ============================================================
-- 35_backfill_lifecycle_alignment.pg.sql
-- 生命週期回填對齊：讓既有資料與 utils/treeLifecycle.lifecycleFromStatus 一致
-- ============================================================
-- 背景：
--   - migration 31 僅認「枯死/死亡」「倒塌」「移除/砍除/砍伐」。
--   - migration 33 補上「枯立木」→ dead。
--   - 但 runtime 另認「倒伏」→ fallen；且早期 create_v2/update_v2 未由樹況
--     推導 lifecycle_status，可能殘留「樹況為枯死/倒塌/移除，但 lifecycle 仍 active」的列。
--
-- 本檔一次性、冪等地補齊：只處理 lifecycle_status='active' 但樹況明確為非活立木者，
-- 不覆寫人工已設定的淘汰/復原狀態（只認 active→retired，不會把 retired 改回 active）。
-- 關鍵字與 lifecycleFromStatus 完全一致：
--   removed: 移除 / 砍除 / 砍伐
--   dead:    枯死 / 死亡 / 枯立
--   fallen:  倒塌 / 倒伏
-- 優先序與 runtime 相同（removed > dead > fallen）。
-- ============================================================

UPDATE tree_survey
   SET lifecycle_status = 'removed',
       retired_at     = COALESCE(retired_at, updated_at, CURRENT_TIMESTAMP),
       retired_reason = COALESCE(retired_reason, status)
 WHERE lifecycle_status = 'active'
   AND status IS NOT NULL
   AND (status LIKE '%移除%' OR status LIKE '%砍除%' OR status LIKE '%砍伐%');

UPDATE tree_survey
   SET lifecycle_status = 'dead',
       retired_at     = COALESCE(retired_at, updated_at, CURRENT_TIMESTAMP),
       retired_reason = COALESCE(retired_reason, status)
 WHERE lifecycle_status = 'active'
   AND status IS NOT NULL
   AND (status LIKE '%枯死%' OR status LIKE '%死亡%' OR status LIKE '%枯立%');

UPDATE tree_survey
   SET lifecycle_status = 'fallen',
       retired_at     = COALESCE(retired_at, updated_at, CURRENT_TIMESTAMP),
       retired_reason = COALESCE(retired_reason, status)
 WHERE lifecycle_status = 'active'
   AND status IS NOT NULL
   AND (status LIKE '%倒塌%' OR status LIKE '%倒伏%');
