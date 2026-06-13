-- 06a_project_boundaries_schema.pg.sql
-- project_boundaries 表「結構」（schema-only，不含任何種子資料）。
--
-- 為什麼獨立成檔：
--   舊的 06_project_boundaries_seed.pg.sql 同時建表＋灌入港務 convex-hull 邊界，
--   因含開發種子資料而被移出 migration 清單（正式邊界由 App 繪製／匯入）。
--   但 migration 16/18/20 會操作 project_boundaries，全新空庫若沒有此表會直接失敗
--   （migrate.js / 全新 production DB 皆然）。故把「建表」抽出來，確保任何全新庫都有此表。
--
-- 開發／CI 若需要港務種子邊界：node scripts/seed_dev_boundaries.js（不在本檔）。
-- 對既有庫為 no-op（IF NOT EXISTS）；對全新 production 只建空表、不灌資料。

CREATE TABLE IF NOT EXISTS project_boundaries (
    id SERIAL PRIMARY KEY,
    project_name VARCHAR(255) NOT NULL UNIQUE,
    project_code VARCHAR(50),
    project_area VARCHAR(50),
    boundary_coordinates JSONB NOT NULL,
    source VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_boundaries_name ON project_boundaries(project_name);
CREATE INDEX IF NOT EXISTS idx_project_boundaries_code ON project_boundaries(project_code);
-- Legacy upgrade: ensure newer columns exist on pre-existing tables
ALTER TABLE project_boundaries ADD COLUMN IF NOT EXISTS project_code VARCHAR(50);
ALTER TABLE project_boundaries ADD COLUMN IF NOT EXISTS project_area VARCHAR(50);
ALTER TABLE project_boundaries ADD COLUMN IF NOT EXISTS source VARCHAR(20);
