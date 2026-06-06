/**
 * 執行單一 migration SQL（生產環境增量部署用，不重新匯入 CSV）。
 *
 * 用法：
 *   node scripts/run_migration_file.js 18_project_boundaries_fk.pg.sql
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('用法: node scripts/run_migration_file.js <檔名>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const filePath = path.join(__dirname, '../database/initial_data', fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`找不到: ${filePath}`);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const script = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    console.log(`執行 ${fileArg} ...`);
    await client.query(script);
    console.log(`${fileArg} 完成`);
  } catch (err) {
    console.error('執行失敗:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
