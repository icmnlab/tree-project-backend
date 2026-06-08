-- Migration 26: 專案／區 UI 語意 — 欄位 COMMENT（表名與欄位名不變）
-- UI「專案」= 港區／計畫層；UI「區」= 樣區／調查區塊；project_code = 穩定主鍵

COMMENT ON COLUMN tree_survey.project_location IS
  'UI:專案（港區／計畫層）。Authority: projects.area_id → project_areas.area_name；此欄為快取。';

COMMENT ON COLUMN tree_survey.project_name IS
  'UI:區（樣區／調查區塊名）。Authority: projects.name；此欄為快取。';

COMMENT ON COLUMN tree_survey.project_code IS
  'Stable PK → projects.project_code。寫入與權限一律用此欄，勿以 name 當鍵。';

COMMENT ON COLUMN pending_tree_measurements.project_area IS
  'UI:專案 — 對應 tree_survey.project_location / project_areas.area_name。';

COMMENT ON COLUMN pending_tree_measurements.project_name IS
  'UI:區 — 對應 tree_survey.project_name / projects.name。';

COMMENT ON COLUMN pending_tree_measurements.project_code IS
  'Stable PK → projects.project_code。';

COMMENT ON COLUMN project_boundaries.project_area IS
  'Legacy/cache: 常與 UI「專案」(project_location) 同值；≠ UI「區」(project_name)。';

COMMENT ON COLUMN project_boundaries.project_name IS
  'Polygon 所屬樣區名；應與 UI「區」及 projects.name 一致。';

COMMENT ON COLUMN projects.name IS 'UI:區（樣區／調查區塊）。';

COMMENT ON COLUMN project_areas.area_name IS 'UI:專案（港區／計畫層）。';
