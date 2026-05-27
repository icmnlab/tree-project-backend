/**
 * X-Request-Id 去重工具 smoke test（需 DATABASE_URL）
 */
const assert = require('assert');
const requestIdDedup = require('../../middleware/requestIdDedup');

async function run() {
  await requestIdDedup.ensureTable();
  const fakeReq = {
    headers: { 'x-request-id': `test-${Date.now()}` },
  };
  const route = 'test/route';
  const body = { success: true, n: 1 };

  const miss = await requestIdDedup.getCachedResponse(fakeReq, route);
  assert.strictEqual(miss, null);

  await requestIdDedup.storeResponse(fakeReq, route, 201, body);
  const hit = await requestIdDedup.getCachedResponse(fakeReq, route);
  assert.ok(hit);
  assert.strictEqual(hit.status_code, 201);
  assert.deepStrictEqual(hit.response_body, body);

  console.log('[requestIdDedup] ok');
}

run().catch((e) => {
  console.error('[requestIdDedup] failed', e);
  process.exit(1);
});
