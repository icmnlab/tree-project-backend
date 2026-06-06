-- [P1 / 2NF] project_boundaries.project_code → projects.project_code FK
-- 冪等：可重複執行 migrate

-- 1) 為僅存在於邊界表、尚無 projects 列的專案建立 stub（現場手繪邊界如「吳全1區」）
INSERT INTO projects (project_code, name, is_active)
SELECT
    'FIELD-BDRY-' || pb.id::text,
    pb.project_name,
    TRUE
FROM project_boundaries pb
WHERE pb.project_name IS NOT NULL
  AND TRIM(pb.project_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.name = pb.project_name
  )
  AND NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE pb.project_code IS NOT NULL
      AND TRIM(pb.project_code) <> ''
      AND pb.project_code <> '無'
      AND p.project_code = pb.project_code
  )
ON CONFLICT (project_code) DO NOTHING;

-- 2) 將仍缺 code 的邊界對齊至 projects（依 name 優先）
UPDATE project_boundaries pb
SET project_code = p.project_code,
    updated_at = NOW()
FROM projects p
WHERE p.name = pb.project_name
  AND (pb.project_code IS NULL OR TRIM(pb.project_code) = '' OR pb.project_code = '無');

-- 3) 清除無法對齊的孤立 code（避免 FK 失敗；保留邊界幾何）
UPDATE project_boundaries pb
SET project_code = NULL,
    updated_at = NOW()
WHERE pb.project_code IS NOT NULL
  AND TRIM(pb.project_code) <> ''
  AND pb.project_code <> '無'
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.project_code = pb.project_code
  );

-- 4) FK：邊界 project_code 必須存在於 projects（NULL 允許）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_project_boundaries_project_code'
  ) THEN
    ALTER TABLE project_boundaries
      ADD CONSTRAINT fk_project_boundaries_project_code
      FOREIGN KEY (project_code) REFERENCES projects(project_code)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

COMMENT ON CONSTRAINT fk_project_boundaries_project_code ON project_boundaries IS
  '2NF：邊界 project_code 參照 projects.project_code；刪除專案時邊界 code 設為 NULL';
