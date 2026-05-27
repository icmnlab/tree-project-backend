-- 待審核旗標（與 is_active 分離，避免與管理員「禁用」混淆）
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT false;

-- 回填：曾透過邀請碼註冊且仍停用者
UPDATE users u
SET pending_approval = true
WHERE u.is_active = false
  AND COALESCE(u.pending_approval, false) = false
  AND EXISTS (
      SELECT 1 FROM audit_logs a
      WHERE a.user_id = u.user_id
        AND a.action = 'REGISTER_INVITE'
  );
