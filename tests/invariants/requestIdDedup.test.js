/**
 * invariants/requestIdDedup.test.js — X-Request-Id 去重工具 smoke test（需 DB）
 *
 * 無 DATABASE_URL / TEST_DB_URL 時自動 skip，避免在無 DB 環境炸掉 runner。
 */
'use strict';

const assert = require('assert');
const requestIdDedup = require('../../middleware/requestIdDedup');

const noDb = !process.env.DATABASE_URL && !process.env.TEST_DB_URL;

module.exports = {
    section: 'invariants',
    cases: [
        {
            name: 'requestIdDedup: miss → store → hit（同 X-Request-Id 回放快取）',
            skip: noDb ? 'no DATABASE_URL/TEST_DB_URL' : false,
            run: async () => {
                await requestIdDedup.ensureTable();
                const fakeReq = { headers: { 'x-request-id': `test-${Date.now()}-${Math.random()}` } };
                const route = 'test/route';
                const body = { success: true, n: 1 };

                const miss = await requestIdDedup.getCachedResponse(fakeReq, route);
                assert.strictEqual(miss, null);

                await requestIdDedup.storeResponse(fakeReq, route, 201, body);
                const hit = await requestIdDedup.getCachedResponse(fakeReq, route);
                assert.ok(hit);
                assert.strictEqual(hit.status_code, 201);
                assert.deepStrictEqual(hit.response_body, body);
            },
        },
    ],
};
