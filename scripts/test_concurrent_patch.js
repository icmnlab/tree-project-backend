#!/usr/bin/env node
/**
 * 簡易多人 PATCH 樂觀鎖測試：第二人帶過期 expected_updated_at 應得 409
 * 用法: node scripts/test_concurrent_patch.js [pending_id]
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');

const base = process.env.TEST_API_BASE || 'http://127.0.0.1:3000/api';
const pendingId = process.argv[2] || process.env.TEST_PENDING_ID;
const secret = process.env.JWT_SECRET;

if (!secret) {
  console.error('需要 JWT_SECRET');
  process.exit(1);
}

function token(userId = 1) {
  return jwt.sign({ id: userId, username: 'test', role: '調查員' }, secret, { expiresIn: '1h' });
}

async function patch(id, body, t) {
  const res = await fetch(`${base}/pending-measurements/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${t}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  if (!pendingId) {
    console.log('用法: node scripts/test_concurrent_patch.js <pending_id>');
    process.exit(0);
  }
  const t = token();
  const stale = '2020-01-01T00:00:00.000Z';
  const r1 = await patch(pendingId, { status: 'in_progress', expected_updated_at: stale }, t);
  console.log('stale PATCH →', r1.status, r1.json.code || r1.json.message);
  if (r1.status === 409) {
    console.log('[PASS] 樂觀鎖 409 正常');
  } else {
    console.log('[WARN] 預期 409，實際', r1.status);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
