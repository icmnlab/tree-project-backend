/**
 * contracts/tree_statuses.test.js — 樹況選單目錄（內建 + 自訂可共享）契約
 *
 * 取代人工驗證：
 *   - GET  /api/tree-statuses 列出內建狀況；枯立木→dead、正常→active（是否活立木）。
 *   - POST /api/tree-statuses 新增自訂狀況（調查管理員以上）；含「枯立」字樣自動推導 dead。
 *   - 重複新增同名 → 200 created=false（多人並發以 UNIQUE+ON CONFLICT 收斂，不重複建立）。
 *   - 未登入 POST → 401（權限保護）。
 *
 * 端點：GET 任何已登入者可讀；POST requireRole('調查管理員')。
 */
'use strict';

const assert = require('assert');
const { TEST_ID } = require('../config');

function findByName(list, name) {
    return (list || []).find((o) => o && o.name === name);
}

module.exports = {
    section: 'contracts',
    cases: [
        {
            name: '樹況選單：GET 內建含 枯立木=dead、正常=active',
            run: async (ctx) => {
                const { api, assert: A } = ctx;
                await api.login('admin');

                const r = await api.get('tree-statuses');
                A.assertJsonOk(r, 'GET tree-statuses');
                A.assertArray(r.body.data, 'data 應為陣列');

                const normal = findByName(r.body.data, '正常');
                assert.ok(normal, '應含「正常」');
                assert.strictEqual(normal.lifecycle, 'active', '正常→active');

                const snag = findByName(r.body.data, '枯立木');
                assert.ok(snag, '應含「枯立木」');
                assert.strictEqual(snag.lifecycle, 'dead', '枯立木→dead（非活立木）');
            },
        },
        {
            name: '樹況選單：POST 自訂（含「枯立」→dead）；重複新增 → created=false 不重複',
            run: async (ctx) => {
                const { api, assert: A, db, cleanup } = ctx;
                await api.login('admin');

                const name = `枯立測試_${TEST_ID}`;
                // 測試結束清掉自訂狀況（若可直連 DB）
                cleanup.track('custom', null, async () => {
                    if (db && db.isAvailable()) {
                        await db.query('DELETE FROM tree_status_options WHERE name = $1', [name]);
                    }
                });

                const r1 = await api.post('tree-statuses', { name });
                A.assertStatus(r1, 201, '首次新增應 201');
                assert.strictEqual(r1.body.created, true, '首次 created=true');
                assert.strictEqual(r1.body.data.lifecycle, 'dead', '含「枯立」應推導 dead');

                // 重複新增同名 → 200 created=false（並發收斂）
                const r2 = await api.post('tree-statuses', { name });
                A.assertStatus(r2, 200, '重複新增應 200');
                assert.strictEqual(r2.body.created, false, '重複 created=false');
                assert.strictEqual(r2.body.data.name, name, '回傳同一筆');

                // 新增後 GET 應可見（共享給其他使用者）
                const rList = await api.get('tree-statuses');
                A.assertJsonOk(rList, 'GET 重抓');
                assert.ok(findByName(rList.body.data, name), '自訂狀況應出現在共用清單');
            },
        },
        {
            name: '樹況選單：未登入 POST → 401',
            run: async (ctx) => {
                const { api, assert: A } = ctx;
                const r = await api.post('tree-statuses', { name: `未授權_${TEST_ID}` }, { token: null });
                A.assertStatus(r, 401, '未登入應 401');
            },
        },
    ],
};
