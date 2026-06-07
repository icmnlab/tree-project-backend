#!/usr/bin/env bash
# 清空 PostgreSQL 並重建 schema（正式環境慎用）
# 用法（Ubuntu）:
#   cd /opt/tree-app/backend
#   CONFIRM=YES ./scripts/reset_fresh_db.sh
#
# 環境變數:
#   SKIP_CSV_IMPORT=1  — 不匯入港務 7063 筆測試樹（正式部署建議）
#   CONFIRM=YES        — 必須設定才會執行 DROP

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${CONFIRM:-}" != "YES" ]]; then
  echo "拒絕執行：請設定 CONFIRM=YES 以確認清空全部資料"
  echo "例: CONFIRM=YES SKIP_CSV_IMPORT=1 ./scripts/reset_fresh_db.sh"
  exit 1
fi

echo "[reset] DROP SCHEMA public CASCADE + 重建…"
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await pool.connect();
  try {
    await c.query('DROP SCHEMA public CASCADE');
    await c.query('CREATE SCHEMA public');
    await c.query('GRANT ALL ON SCHEMA public TO public');
    console.log('[reset] schema cleared');
  } finally {
    c.release();
    await pool.end();
  }
})();
"

export SKIP_CSV_IMPORT="${SKIP_CSV_IMPORT:-1}"
echo "[reset] migrate.js (SKIP_CSV_IMPORT=$SKIP_CSV_IMPORT)…"
node scripts/migrate.js

echo "[reset] run_pending_migrations…"
node scripts/run_pending_migrations.js

echo "[reset] 完成。請 pm2 reload tree-backend"
