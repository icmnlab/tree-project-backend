--
-- 注意：system_settings 表已於 migration 25 移除（無任何程式讀寫；JWT 過渡期設定已不使用）。
-- 本檔僅保留 audit_logs。檔名維持 system_settings_and_audit 以相容既有 schema_migrations 紀錄。
--

--
-- Audit Logs Table
-- Records critical actions for security and accountability
--
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    username VARCHAR(50), -- De-normalized in case user is deleted
    action VARCHAR(50) NOT NULL, -- e.g., 'LOGIN', 'CREATE_TREE', 'DELETE_PROJECT'
    resource_type VARCHAR(50), -- e.g., 'tree_survey', 'users'
    resource_id VARCHAR(50), -- Target ID
    details TEXT, -- JSON or description
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

COMMENT ON TABLE audit_logs IS '系統審計日誌 (安全性與操作紀錄)';
