-- 29_pending_created_by.pg.sql
-- [稽核#1/#3] pending 任務擁有權：記錄建立者，供 PATCH/transfer/刪除/改專案做擁有權檢查。
-- 舊資料 created_by_user_id 為 NULL（legacy）→ 沿用既有「專案權限」行為，不破壞回溯相容。
-- 使用者刪除時 SET NULL（列退化為 legacy 行為）。

ALTER TABLE pending_tree_measurements
    ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pending_created_by
    ON pending_tree_measurements(created_by_user_id);

COMMENT ON COLUMN pending_tree_measurements.created_by_user_id IS
    '建立者 user_id（擁有權檢查：本人或 系統管理員/業務管理員 才能改/轉移/刪除；NULL=legacy 列沿用專案權限）';
