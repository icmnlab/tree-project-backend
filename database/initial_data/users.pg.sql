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

-- 種子帳號：僅在 username 不存在時插入
INSERT INTO users (user_id, username, password_hash, display_name, role, associated_projects, is_active, pending_approval, login_attempts, last_attempt_time, created_at, updated_at) VALUES
(1, 'admin', '$2b$10$F1aGiPLUChLipFEHOzxMpO8kFXjyGszCfRfJdOBOWOIsqX9HEyYna', '維護測試', '系統管理員', '3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19,20,21,22,23,24,25,26,27,36,48,51,52,53,54,55,57,60,61', true, false, 0, NULL, '2025-04-29 00:06:21', '2025-05-16 23:50:48'),
(4, 'Taichung', '$2b$10$mCjx/dDQHRMYA/WdlCMM7eJzo5aXf6FoQtnufVzK6rLb7.tTmLdHW', '林柔安', '業務管理員', '61', true, false, 0, NULL, '2025-05-01 19:48:31', '2025-05-17 11:22:09'),
(5, 'Kyleliu', '$2b$10$fCT7E2dUfWGsbFQXTkq5t.nYy0WxX2R5mio3BomTZPgeV1ulVzPrW', '劉旻豪', '系統管理員', '52', true, false, 0, NULL, '2025-05-16 20:03:59', '2025-05-16 23:51:03'),
(6, 'test', '$2b$10$GIiFeRlzTayWlVOhg5tmo.HT3b8s4I0xfGVPkoAR4Lj7ECWpz4oFu', '測試', '調查管理員', '48', true, false, 0, NULL, '2025-05-16 20:33:18', '2025-05-16 23:51:13'),
(7, 'tt2', '$2b$10$7gQw9b1o8n2T8wbbGXcMh.09GXqOMtyGGBP23yIJYVAKqDAog8Mlm', 'tt2', '專案管理員', NULL, true, false, 0, NULL, '2025-05-17 11:22:43', '2025-05-17 11:22:43')
ON CONFLICT (username) DO NOTHING;

SELECT setval(
    pg_get_serial_sequence('users', 'user_id'),
    GREATEST(8, COALESCE((SELECT MAX(user_id) FROM users), 0)),
    true
);
