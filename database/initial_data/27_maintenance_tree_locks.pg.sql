-- 維護量測：現場重測樹木互斥鎖（Phase A 多人協作）
-- 一樹同時僅一人可進入 BLE 重測；過期自動失效。

CREATE TABLE IF NOT EXISTS maintenance_tree_locks (
    tree_id INTEGER PRIMARY KEY REFERENCES tree_survey(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    display_name VARCHAR(100),
    project_code VARCHAR(50),
    session_hint VARCHAR(200),
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_maint_locks_project_expires
    ON maintenance_tree_locks (project_code, expires_at);

COMMENT ON TABLE maintenance_tree_locks IS '維護重測互斥鎖：防止多人同時量同一棵樹';
