-- [P2 歷史紀錄] 每棵樹保留歷次量測快照
--
-- tree_survey：仍為「最新一筆」業務快照（地圖、列表、碳計算）
-- tree_survey_measurements：每次 transfer（初測 new / 維護 maintenance）追加一列歷次
--
-- 冪等：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS

CREATE TABLE IF NOT EXISTS tree_survey_measurements (
    id BIGSERIAL PRIMARY KEY,
    tree_id BIGINT NOT NULL REFERENCES tree_survey(id) ON DELETE CASCADE,
    pending_id BIGINT,

    survey_time TIMESTAMPTZ NOT NULL,
    tree_height_m DOUBLE PRECISION,
    dbh_cm DOUBLE PRECISION,
    species_name VARCHAR(100),
    species_id VARCHAR(20),
    status TEXT,
    survey_notes TEXT,
    carbon_storage DOUBLE PRECISION,

    x_coord DOUBLE PRECISION,
    y_coord DOUBLE PRECISION,

    survey_mode VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tsm_tree_id
    ON tree_survey_measurements(tree_id);

CREATE INDEX IF NOT EXISTS idx_tsm_tree_time
    ON tree_survey_measurements(tree_id, survey_time DESC);

COMMENT ON TABLE tree_survey_measurements IS '樹木歷次量測紀錄（初測與維護每次 transfer 追加一筆）';
COMMENT ON COLUMN tree_survey_measurements.survey_mode IS 'new = 初測建樹；maintenance = 維護重測';
