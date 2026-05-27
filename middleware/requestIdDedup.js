/**
 * X-Request-Id 冪等去重（TTL 24h）
 * 用於 POST 批次寫入等可重試端點，避免弱網重送造成重複列。
 */

const db = require('../config/db');
const pool = db.pool;

const TTL_HOURS = 24;
let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_request_dedup (
      request_id VARCHAR(128) NOT NULL,
      route_key VARCHAR(128) NOT NULL,
      status_code INT NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (request_id, route_key)
    );
    CREATE INDEX IF NOT EXISTS idx_api_request_dedup_created
      ON api_request_dedup(created_at);
  `);
  await pool.query(`
    DELETE FROM api_request_dedup
    WHERE created_at < NOW() - INTERVAL '${TTL_HOURS} hours'
  `);
  tableReady = true;
}

function getRequestId(req) {
  const raw = req.headers['x-request-id'];
  if (!raw || typeof raw !== 'string') return null;
  const id = raw.trim();
  if (id.length < 8 || id.length > 128) return null;
  if (!/^[A-Za-z0-9._\-]+$/.test(id)) return null;
  return id;
}

/**
 * @returns {Promise<{status_code:number, response_body:object}|null>}
 */
async function getCachedResponse(req, routeKey) {
  const requestId = getRequestId(req);
  if (!requestId) return null;
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT status_code, response_body FROM api_request_dedup
     WHERE request_id = $1 AND route_key = $2`,
    [requestId, routeKey]
  );
  if (rows.length === 0) return null;
  return {
    status_code: rows[0].status_code,
    response_body: rows[0].response_body,
  };
}

async function storeResponse(req, routeKey, statusCode, responseBody) {
  const requestId = getRequestId(req);
  if (!requestId) return;
  await ensureTable();
  await pool.query(
    `INSERT INTO api_request_dedup (request_id, route_key, status_code, response_body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (request_id, route_key) DO NOTHING`,
    [requestId, routeKey, statusCode, responseBody]
  );
}

module.exports = {
  ensureTable,
  getRequestId,
  getCachedResponse,
  storeResponse,
};
