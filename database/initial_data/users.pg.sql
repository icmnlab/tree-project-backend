-- Idempotent users schema — 生產環境啟動時不可 DROP，避免清空帳號與待審核狀態
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('系統管理員', '業務管理員', '專案管理員', '調查管理員', '一般使用者');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  role user_role NOT NULL DEFAULT '一般使用者',
  associated_projects TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  pending_approval BOOLEAN NOT NULL DEFAULT FALSE,
  login_attempts INT DEFAULT 0,
  last_attempt_time TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT FALSE;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE users IS '儲存應用程式使用者帳號資訊';
COMMENT ON COLUMN users.pending_approval IS '邀請碼註冊待管理員審核（與 is_active=false 搭配；管理員禁用帳號不應設為 true）';

-- 種子帳號：僅在 username 不存在時插入（去個人化：已移除真人帳號）。
-- 保留 bootstrap `admin`（CI／首次登入）與兩個通用角色測試帳號；正式部署
-- 建議改以部署腳本建立管理員、由部署者輸入帳密（見 WORK_STATUS 去個人化 worklist）。
INSERT INTO users (user_id, username, password_hash, display_name, role, associated_projects, is_active, pending_approval, login_attempts, last_attempt_time, created_at, updated_at) VALUES
(1, 'admin', '$2b$10$F1aGiPLUChLipFEHOzxMpO8kFXjyGszCfRfJdOBOWOIsqX9HEyYna', '系統管理員', '系統管理員', NULL, true, false, 0, NULL, '2025-04-29 00:06:21', '2025-05-16 23:50:48'),
(6, 'test', '$2b$10$GIiFeRlzTayWlVOhg5tmo.HT3b8s4I0xfGVPkoAR4Lj7ECWpz4oFu', '調查管理員測試', '調查管理員', NULL, true, false, 0, NULL, '2025-05-16 20:33:18', '2025-05-16 23:51:13'),
(7, 'tt2', '$2b$10$7gQw9b1o8n2T8wbbGXcMh.09GXqOMtyGGBP23yIJYVAKqDAog8Mlm', '專案管理員測試', '專案管理員', NULL, true, false, 0, NULL, '2025-05-17 11:22:43', '2025-05-17 11:22:43')
ON CONFLICT (username) DO NOTHING;

SELECT setval(
    pg_get_serial_sequence('users', 'user_id'),
    GREATEST(8, COALESCE((SELECT MAX(user_id) FROM users), 0)),
    true
);
