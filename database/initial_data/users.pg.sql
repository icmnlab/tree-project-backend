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

-- 本檔僅建立結構（schema-only），不含任何使用者種子。
-- 正式環境：部署後執行 `node scripts/create_lab_admin.js --username ... --password ...`
-- 開發／CI：執行 `node scripts/seed_dev_users.js`（勿用於 production）
