/**
 * 開發／CI 用帳號種子（**勿用於正式環境**）
 *
 * 用途：在「空 users 表」的開發庫或 GitHub Actions CI 建立契約測試所需的最小帳號。
 * 正式部署請改用 `create_lab_admin.js` 建立管理員（部署者自訂帳密）。
 *
 * 用法：
 *   node scripts/seed_dev_users.js
 *
 * 環境：需已執行 migrate（users 表存在）。冪等：ON CONFLICT (username) DO NOTHING。
 */
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

/** @type {Array<{username:string, password:string, display:string, role:string}>} */
const DEV_USERS = [
  { username: 'admin', password: '12345', display: '系統管理員', role: '系統管理員' },
  { username: 'test', password: 'test123', display: '調查管理員測試', role: '調查管理員' },
  { username: 'tt2', password: 'tt2123', display: '專案管理員測試', role: '專案管理員' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('拒絕在 NODE_ENV=production 執行 seed_dev_users（請改用 create_lab_admin.js）');
    process.exit(1);
  }

  let created = 0;
  for (const u of DEV_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const { rowCount } = await db.query(
      `INSERT INTO users (username, password_hash, display_name, role, is_active, pending_approval)
       VALUES ($1, $2, $3, $4, true, false)
       ON CONFLICT (username) DO NOTHING`,
      [u.username, hash, u.display, u.role],
    );
    if (rowCount > 0) {
      created++;
      console.log(`已建立開發帳號: ${u.username} (${u.role})`);
    }
  }
  console.log(`seed_dev_users 完成（新建 ${created} 筆，其餘已存在則略過）`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
