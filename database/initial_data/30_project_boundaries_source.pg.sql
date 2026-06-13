-- 30_project_boundaries_source.pg.sql
-- [稽核] 記錄邊界來源輸入方式，供除錯與資料溯源。
-- 純擴充、冪等：對既有庫為 no-op（IF NOT EXISTS），不更動既有資料。
--
-- source 值：
--   draw    = 地圖手繪點選
--   coords  = 直接貼上座標清單
--   kml     = 匯入 KML/KMZ（Google Earth）
--   geojson = 匯入 GeoJSON
--   suggest = 由樹木 GPS 自動建議
--   NULL    = 既有資料（來源未知）

ALTER TABLE project_boundaries ADD COLUMN IF NOT EXISTS source VARCHAR(20);

COMMENT ON COLUMN project_boundaries.source IS
  '邊界輸入來源：draw|coords|kml|geojson|suggest；NULL=既有/未知';
