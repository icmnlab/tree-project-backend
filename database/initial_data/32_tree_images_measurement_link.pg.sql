-- ============================================================
-- 32_tree_images_measurement_link.pg.sql
-- 讓照片可選綁定到「某一次量測歷史」(tree_survey_measurements)
-- ============================================================
-- 目的：重測時拍的照片能跟隨該次歷史紀錄，歷史面板可逐次顯示縮圖；
--      樹木詳情頁可依 captured_at 取「最新照片」。
-- 設計：軟連結（不加硬 FK）。原因：
--   1) tree_images 為多型 owner（survey|pending），照片常先於 transfer 上傳；
--   2) measurement 於 transfer 當下才建立，故以 id + index 軟連結最有彈性。
-- ============================================================

ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS measurement_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_tree_images_measurement ON tree_images(measurement_id);

COMMENT ON COLUMN tree_images.measurement_id IS '可選：對應 tree_survey_measurements.id，串起「該次量測拍的照片」';
