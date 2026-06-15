/**
 * 建立系統管理員（正式環境首次部署用）
 *
 * 用法：
 *   node scripts/create_lab_admin.js --username labadmin --password 'YourSecurePass1' --display '實驗室管理員'
 *
 * 注意：
 *   - 僅在 users 表為空或需新增管理員時使用；username 重複會回錯誤。
 *   - 正式庫請勿使用 seed_dev_users.js（該腳本僅供開發／CI）。
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

function parseArgs() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--username') out.username = argv[++i];
    else if (argv[i] === '--password') out.password = argv[++i];
    else if (argv[i] === '--display') out.display = argv[++i];
  }
  return out;
}

async function main() {
  const { username, password, display } = parseArgs();
  if (!username || !password) {
    console.error('需要 --username 與 --password');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('密碼至少 8 字元');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await db.query(
    `INSERT INTO users (username, password_hash, display_name, role, is_active)
     VALUES ($1, $2, $3, '系統管理員', true)
     RETURNING user_id, username`,
    [username, hash, display || username],
  );

  console.log('已建立實驗室管理員:', rows[0]);
  process.exit(0);
}

main().catch((e) => {
  if (e.code === '23505') {
    console.error('帳號已存在');
  } else {
    console.error(e);
  }
  process.exit(1);
});
