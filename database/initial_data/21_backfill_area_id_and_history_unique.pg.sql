-- Migration 21: backfill orphaned projects.area_id + history pending_id uniqueness
-- Date: 2026-06-07

-- 1) Backfill area_id from project_boundaries (migration 20 stubs may lack area_id)
UPDATE projects p
SET area_id = pa.id
FROM project_boundaries pb
JOIN project_areas pa ON TRIM(pa.area_name) = TRIM(pb.project_area)
WHERE p.is_active IS NOT DISTINCT FROM TRUE
  AND p.area_id IS NULL
  AND TRIM(p.name) = TRIM(pb.project_name)
  AND pb.project_area IS NOT NULL
  AND TRIM(pb.project_area) <> '';

-- 2) Fallback: tree_survey.project_location (same as migration 07)
UPDATE projects p
SET area_id = pa.id
FROM (
    SELECT DISTINCT ON (ts.project_code)
           ts.project_code,
           ts.project_location
    FROM tree_survey ts
    WHERE ts.project_code IS NOT NULL
      AND ts.project_location IS NOT NULL
      AND TRIM(ts.project_location) <> ''
    ORDER BY ts.project_code, ts.id
) ts
JOIN project_areas pa ON TRIM(pa.area_name) = TRIM(ts.project_location)
WHERE p.project_code = ts.project_code
  AND p.area_id IS NULL;

-- 3) Dedupe measurement history: keep earliest row per pending_id before UNIQUE
DELETE FROM tree_survey_measurements a
USING tree_survey_measurements b
WHERE a.pending_id IS NOT NULL
  AND b.pending_id IS NOT NULL
  AND a.pending_id = b.pending_id
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tsm_pending_id_unique
  ON tree_survey_measurements (pending_id)
  WHERE pending_id IS NOT NULL;
