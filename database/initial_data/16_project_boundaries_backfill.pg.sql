-- [2NF] 回填 project_boundaries.project_code，對齊 projects / tree_survey
-- 冪等：僅更新 NULL 或空字串；不變更既有 code

-- 1) 依 projects.name 對齊
UPDATE project_boundaries pb
SET project_code = p.project_code,
    updated_at = NOW()
FROM projects p
WHERE pb.project_name = p.name
  AND (pb.project_code IS NULL OR TRIM(pb.project_code) = '' OR pb.project_code = '無')
  AND p.project_code IS NOT NULL
  AND TRIM(p.project_code) <> '';

-- 2) 依 tree_survey 最常見的 code（專案名稱快照）
UPDATE project_boundaries pb
SET project_code = sub.project_code,
    updated_at = NOW()
FROM (
    SELECT project_name, MODE() WITHIN GROUP (ORDER BY project_code) AS project_code
    FROM tree_survey
    WHERE project_name IS NOT NULL
      AND TRIM(project_name) <> ''
      AND project_code IS NOT NULL
      AND TRIM(project_code) <> ''
      AND project_code <> '無'
    GROUP BY project_name
) sub
WHERE pb.project_name = sub.project_name
  AND (pb.project_code IS NULL OR TRIM(pb.project_code) = '' OR pb.project_code = '無');

-- 3) 診斷：仍缺 code 的邊界（僅 COMMENT，不阻斷 migrate）
COMMENT ON TABLE project_boundaries IS
  '專案邊界；主鍵語意仍為 project_name UNIQUE。project_code 應與 projects.project_code 一致（見 migration 16 回填）。';
