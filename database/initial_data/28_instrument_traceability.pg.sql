-- [P1 儀器模式] transfer / 歷次 / raw 保留 TYPE 與 Remote Diameter

ALTER TABLE tree_measurement_raw
  ADD COLUMN IF NOT EXISTS instrument_dbh_cm DOUBLE PRECISION;

COMMENT ON COLUMN tree_measurement_raw.instrument_dbh_cm IS
  'VLGEO2 Remote Diameter (cm)；正式 dbh_cm 仍由手冊／人工決定';

ALTER TABLE tree_survey_measurements
  ADD COLUMN IF NOT EXISTS instrument_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS instrument_dbh_cm DOUBLE PRECISION;

COMMENT ON COLUMN tree_survey_measurements.instrument_type IS
  '韌體 CSV TYPE 或 LIVE 場次 height_method：1P / 3P / DME / LIVE';
COMMENT ON COLUMN tree_survey_measurements.instrument_dbh_cm IS
  '該次量測 Remote Diameter (cm)，非碳匯正式 DBH';
