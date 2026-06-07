-- [P1-2 / P0] 邊界-only 樣區補 projects stub、再次收斂同名 active、禁止未來重複
-- 冪等：可重複執行

-- 1) 再次收斂同名 active projects（migration 19 之後可能又新增，如 104）
DO $$
DECLARE
    rec RECORD;
    canon_code TEXT;
    dup_code TEXT;
BEGIN
    FOR rec IN
        SELECT p.name
        FROM projects p
        WHERE p.is_active IS NOT DISTINCT FROM TRUE
        GROUP BY p.name
        HAVING COUNT(*) > 1
    LOOP
        SELECT p.project_code INTO canon_code
        FROM projects p
        LEFT JOIN tree_survey ts ON ts.project_code = p.project_code
        WHERE p.name = rec.name
          AND p.is_active IS NOT DISTINCT FROM TRUE
        GROUP BY p.id, p.project_code
        ORDER BY COUNT(ts.id) DESC, p.id ASC
        LIMIT 1;

        IF canon_code IS NULL THEN
            CONTINUE;
        END IF;

        FOR dup_code IN
            SELECT p.project_code
            FROM projects p
            WHERE p.name = rec.name
              AND p.project_code <> canon_code
              AND p.is_active IS NOT DISTINCT FROM TRUE
        LOOP
            UPDATE tree_survey
            SET project_code = canon_code, updated_at = NOW()
            WHERE project_code = dup_code;

            UPDATE pending_tree_measurements
            SET project_code = canon_code, updated_at = NOW()
            WHERE project_code = dup_code;

            UPDATE project_boundaries
            SET project_code = canon_code, updated_at = NOW()
            WHERE project_code = dup_code;

            INSERT INTO user_projects (user_id, project_code, assigned_at)
            SELECT up.user_id, canon_code, up.assigned_at
            FROM user_projects up
            WHERE up.project_code = dup_code
            ON CONFLICT (user_id, project_code) DO NOTHING;

            DELETE FROM user_projects WHERE project_code = dup_code;

            UPDATE projects
            SET is_active = FALSE,
                description = COALESCE(description, '') ||
                    ' [merged→' || canon_code || ' ' || to_char(NOW(), 'YYYY-MM-DD') || ']',
                updated_at = NOW()
            WHERE project_code = dup_code;

            RAISE NOTICE 'projects dedupe(20): name=% dup=% → canon=%', rec.name, dup_code, canon_code;
        END LOOP;
    END LOOP;
END $$;

-- 2) 為僅存在於 project_boundaries 的樣區建立 projects stub
DO $$
DECLARE
    rec RECORD;
    area_id_val INT;
    code_val TEXT;
    max_num INT;
BEGIN
    FOR rec IN
        SELECT DISTINCT ON (TRIM(pb.project_name))
            TRIM(pb.project_name) AS pname,
            NULLIF(TRIM(pb.project_code), '') AS pcode,
            NULLIF(TRIM(pb.project_area), '') AS parea
        FROM project_boundaries pb
        WHERE pb.project_name IS NOT NULL AND TRIM(pb.project_name) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM projects p
            WHERE p.is_active IS NOT DISTINCT FROM TRUE
              AND TRIM(p.name) = TRIM(pb.project_name)
          )
        ORDER BY TRIM(pb.project_name),
                 COALESCE(NULLIF(TRIM(pb.project_code), ''), pb.project_name)
    LOOP
        area_id_val := NULL;
        IF rec.parea IS NOT NULL THEN
            SELECT id INTO area_id_val
            FROM project_areas
            WHERE area_name = rec.parea
            LIMIT 1;
        END IF;

        code_val := rec.pcode;
        IF code_val IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM projects WHERE project_code = code_val) THEN
                code_val := NULL;
            END IF;
        END IF;

        IF code_val IS NULL THEN
            SELECT GREATEST(
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM tree_survey WHERE project_code ~ '^[0-9]+$'), 0),
                COALESCE((SELECT MAX(CAST(project_code AS INTEGER)) FROM projects WHERE project_code ~ '^[0-9]+$'), 0)
            ) INTO max_num;
            code_val := (max_num + 1)::TEXT;
            WHILE EXISTS (SELECT 1 FROM projects WHERE project_code = code_val) LOOP
                max_num := max_num + 1;
                code_val := max_num::TEXT;
            END LOOP;
        END IF;

        INSERT INTO projects (project_code, name, area_id, is_active, description)
        VALUES (code_val, rec.pname, area_id_val, TRUE, '由邊界 seed 同步建立 (migration 20)')
        ON CONFLICT (project_code) DO NOTHING;

        RAISE NOTICE 'boundary stub: name=% code=%', rec.pname, code_val;
    END LOOP;
END $$;

-- 3) active 專案名稱唯一（防止 POST /add 或 ensureProjectForBoundary 再長出同名）
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_name_unique
    ON projects (name)
    WHERE is_active IS NOT DISTINCT FROM TRUE;
