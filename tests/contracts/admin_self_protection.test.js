/**
 * contracts/admin_self_protection.test.js — 管理員自我保護契約
 *
 * 防止管理員把自己鎖在系統外（多人協作安全）：
 *   - PUT /users/:id/status 停用自己 → 400
 *   - PUT /users/:id 停用自己 / 變更自己角色 → 400
 *   - DELETE /users/:id 刪除自己 → 400
 *   - 對照：改自己暱稱（非破壞性）仍可成功
 */
'use strict';

const assert = require('assert');

module.exports = {
    section: 'contracts',
    cases: [
        {
            name: '自我保護：管理員不能停用/降級/刪除自己；改暱稱仍可',
            run: async (ctx) => {
                const { api, assert: A } = ctx;
                const loginBody = await api.login('admin');
                const myId = (loginBody.user && loginBody.user.user_id) || (api.user && api.user.user_id);
                assert.ok(myId, '應取得 admin 自己的 user_id');

                // 1) 停用自己（status 端點）→ 400
                const rStatus = await api.put(`users/${myId}/status`, { isActive: false });
                A.assertStatus(rStatus, 400, '停用自己 (PUT status) 應 400');

                // 2) 停用自己（一般編輯端點）→ 400
                const rDeact = await api.put(`users/${myId}`, { is_active: false });
                A.assertStatus(rDeact, 400, '停用自己 (PUT user) 應 400');

                // 3) 變更自己的角色 → 400
                const rDemote = await api.put(`users/${myId}`, { role: '一般使用者' });
                A.assertStatus(rDemote, 400, '變更自己角色 應 400');

                // 4) 刪除自己 → 400
                const rDel = await api.delete(`users/${myId}`);
                A.assertStatus(rDel, 400, '刪除自己 應 400');

                // 對照：改自己暱稱（非破壞性）仍應成功
                const rName = await api.put(`users/${myId}`, { display_name: '系統管理員' });
                A.assertJsonOk(rName, '改自己暱稱應成功');

                // 確認自己仍為啟用、仍是系統管理員（沒被前述操作破壞）
                const rMe = await api.get(`users/${myId}`).catch(() => null);
                if (rMe && rMe.statusCode === 200) {
                    const u = rMe.body.data || rMe.body;
                    if (u && typeof u.is_active !== 'undefined') {
                        assert.strictEqual(!!u.is_active, true, 'admin 應仍為啟用');
                    }
                }
            },
        },
    ],
};
