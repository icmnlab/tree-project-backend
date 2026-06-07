/**
 * 列出 prod/dev 上可能已廢棄的 legacy 表（RAG / 舊碳匯）。
 * 用法：node scripts/list_legacy_tables.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

const PATTERNS = ['%embed%', '%carbon%', '%emission%', '%knowledge%', '%region_score%'];

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND (${PATTERNS.map((_, i) => `tablename LIKE $${i + 1}`).join(' OR ')})
       ORDER BY 1`,
      PATTERNS,
    );
    if (rows.length === 0) {
      console.log('[legacy] 無符合條件的表');
      return;
    }
    for (const { tablename } of rows) {
      const cnt = await client.query(`SELECT COUNT(*)::int AS n FROM "${tablename}"`);
      console.log(`${tablename}\trows=${cnt.rows[0].n}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
