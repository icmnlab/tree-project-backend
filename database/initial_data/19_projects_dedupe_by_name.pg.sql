-- [P0 / 資料品質] 同名 projects 收斂為單一 canonical project_code
-- 例：「吳全1區」同時有 code 102、103 → 保留 tree_survey 筆數較多者
-- 冪等：可重複執行；僅處理 is_active=TRUE 的重複名稱

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
            RAISE WARNING 'projects dedupe: 無法決定 canonical name=%', rec.name;
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
            SET project_code = canon_code,
                updated_at = NOW()
            WHERE project_code = dup_code;

            UPDATE pending_tree_measurements
            SET project_code = canon_code,
                updated_at = NOW()
            WHERE project_code = dup_code;

            UPDATE project_boundaries
            SET project_code = canon_code,
                updated_at = NOW()
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

            RAISE NOTICE 'projects dedupe: name=% dup=% → canon=%',
                rec.name, dup_code, canon_code;
        END LOOP;
    END LOOP;
END $$;

COMMENT ON TABLE projects IS
  '專案主檔；project_code UNIQUE 為業務主鍵。name 歷史上可重複，migration 19 將重複名收斂並停用冗餘列。';
