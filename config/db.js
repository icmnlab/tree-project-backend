const { Pool } = require('pg');
require('dotenv').config();
const { resolvePgSsl } = require('./pgSsl');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolvePgSsl(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('成功連接到 PostgreSQL 資料庫');
});

pool.on('error', (err) => {
  console.error('資料庫連接發生非預期錯誤:', err);
  // 優雅關閉而非強制退出
  if (err.message && err.message.includes('Connection terminated unexpectedly')) {
    console.error('資料庫連接異常中斷，pool 將自動重連');
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};

// PM2 cluster mode: 優雅關閉連接池
process.on('SIGINT', () => {
  pool.end().then(() => {
    console.log('[DB] Pool closed (SIGINT)');
    process.exit(0);
  });
});
process.on('SIGTERM', () => {
  pool.end().then(() => {
    console.log('[DB] Pool closed (SIGTERM)');
    process.exit(0);
  });
});