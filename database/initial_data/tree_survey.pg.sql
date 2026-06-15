-- Drop existing objects for a clean run
DROP TRIGGER IF EXISTS trigger_tree_survey_updated_at ON tree_survey;
-- DROP FUNCTION IF EXISTS update_updated_at_column; -- Handled by 00_init_functions.pg.sql
DROP TABLE IF EXISTS tree_survey CASCADE;

--
-- 資料表結構 `tree_survey` for PostgreSQL
--
CREATE TABLE tree_survey (
    id SERIAL PRIMARY KEY,
    project_location VARCHAR(255),
    project_code VARCHAR(50),
    project_name VARCHAR(255),
    system_tree_id VARCHAR(50) NOT NULL,
    project_tree_id VARCHAR(50),
    is_placeholder BOOLEAN DEFAULT false,
    species_id VARCHAR(20),
    species_name VARCHAR(100),
    x_coord DOUBLE PRECISION,
    y_coord DOUBLE PRECISION,
    status TEXT,
    lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'active',
    retired_at TIMESTAMPTZ,
    retired_reason TEXT,
    notes TEXT,
    tree_notes TEXT,
    tree_height_m DOUBLE PRECISION,
    dbh_cm DOUBLE PRECISION,
    canopy_w_e VARCHAR(50),
    canopy_w_w VARCHAR(50),
    canopy_w_s VARCHAR(50),
    canopy_w_n VARCHAR(50),
    growth_status VARCHAR(50),
    canopy_density VARCHAR(50),
    height_under_branches VARCHAR(50),
    growth_space VARCHAR(100),
    survey_notes TEXT,
    survey_time TIMESTAMP,
    carbon_storage DOUBLE PRECISION,
    carbon_sequestration_per_year DOUBLE PRECISION,
    image_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add comments and indexes
COMMENT ON TABLE tree_survey IS '儲存樹木調查的主要資料';
CREATE INDEX idx_tree_survey_project_code ON tree_survey(project_code);
CREATE INDEX idx_tree_survey_species_name ON tree_survey(species_name);


-- Create the trigger
CREATE TRIGGER trigger_tree_survey_updated_at
BEFORE UPDATE ON tree_survey
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
