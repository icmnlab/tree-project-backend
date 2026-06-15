-- Drop dependent objects first
DROP TRIGGER IF EXISTS trigger_project_areas_updated_at ON project_areas;
-- DROP FUNCTION IF EXISTS update_updated_at_column; -- This is now handled by 00_init_functions.pg.sql

-- Drop the table if it exists
DROP TABLE IF EXISTS project_areas CASCADE;

--
-- 資料表結構 `project_areas` for PostgreSQL
--
CREATE TABLE project_areas (
  id SERIAL PRIMARY KEY,
  area_name VARCHAR(50) NOT NULL UNIQUE,
  area_code VARCHAR(10) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  city VARCHAR(20),
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION
);

-- 加上註解
COMMENT ON TABLE project_areas IS '專案區位資料表';
COMMENT ON COLUMN project_areas.area_name IS '區位名稱';
COMMENT ON COLUMN project_areas.area_code IS '區位代碼';
COMMENT ON COLUMN project_areas.description IS '區位描述';
COMMENT ON COLUMN project_areas.city IS '所屬縣市';
COMMENT ON COLUMN project_areas.center_lat IS '中心點緯度';
COMMENT ON COLUMN project_areas.center_lng IS '中心點經度';

-- 建立一個觸發器，在每次更新 project_areas 資料表時調用共用函數
CREATE TRIGGER trigger_project_areas_updated_at
BEFORE UPDATE ON project_areas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 註：本檔僅建立結構（schema-only），不含任何種子資料，正式環境啟動後為空表。
-- 版控（GitHub）中沒有任何示範區位資料。若需本機開發示範港區，可自行放置
-- dev-fixtures/project_areas_seed.pg.sql（該目錄 .sql 已被 .gitignore 忽略，僅本機用）；
-- scripts/migrate.js 會在未設定 SKIP_CSV_IMPORT 時自動載入（檔案不存在則略過）。
-- 與邊界種子（dev-fixtures/06_project_boundaries_seed.pg.sql）同模式。
