/**
 * contracts/maintenance_locks.test.js — 維護重測互斥鎖契約測試
 *
 * 取代「兩台手機現場互搶同一棵樹」的人工驗證：
 *   1. A（系統管理員）取得樹 X 的鎖 → 200
 *   2. A 同樹再取一次 → 200 renewed（同人可重入）
 *   3. B（自建業務管理員）查清單 → 看得到 A 的鎖
 *   4. B 搶同一棵 X → 409 LOCKED，且回傳持有者為 A
 *   5. A 釋放 → 200
 *   6. 釋放後 B 再搶 → 200（鎖換手給 B）
 *
 * A 與 B 都是「管理員級」角色，皆繞過 projectFilter，
 * 因此 B 被擋一定是因為「鎖」而非「無專案權限(403)」——這正是要驗的不變量。
 *
 * 所有資料用 TEST_ID 前綴，結束一律 cleanup（含鎖）。
 */
'use strict';

const assert = require('assert');
const { Api } = require('../helpers/apiClient');

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '維護鎖：acquire → 重入 → 他人 409 → release → 他人可 acquire',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;

        // ── A = 系統管理員 ──
        await api.login('admin');

        // 建 區位 / 專案 / 樹（皆 A 建立）
        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        const projBody = factories.buildProject({ area: area.area_name });
        const rProj = await api.post('projects/add', { name: projBody.name, area: projBody.area });
        A.assertJsonOk(rProj, '建專案');
        const projectCode = rProj.body.project.code;
        cleanup.track('project', projectCode);

        const tree = factories.buildTree({
          project_code: projectCode,
          project_name: projBody.name,
          project_area: area.area_name,
        });
        const rTree = await api.post('tree_survey/create_v2', tree);
        A.assertJsonOk(rTree, '建樹 v2');
        const treeId = rTree.body.id || (rTree.body.data && rTree.body.data.id);
        assert.ok(treeId, `回傳缺 id：${JSON.stringify(rTree.body).slice(0, 200)}`);
        cleanup.track('tree', treeId);

        // ── B = 自建業務管理員，獨立登入 ──
        const bUser = factories.buildUser({ role: '業務管理員' });
        const rUser = await api.post('users', bUser);
        A.assertJsonOk(rUser, '建使用者 B');
        cleanup.track('user', rUser.body.userId);

        const apiB = new Api();
        const rLoginB = await apiB.post('login', {
          account: bUser.username,
          password: bUser.password,
          loginType: 'admin',
        });
        A.assertJsonOk(rLoginB, 'B 登入');
        apiB.setToken(rLoginB.body.token);
        const bUserId = rLoginB.body.user && rLoginB.body.user.user_id;

        // 不論成敗，結束時用 A（管理員）把鎖清掉，避免污染後續測試
        cleanup.track('custom', `lock-${treeId}`, async (cleanupApi) => {
          await cleanupApi.delete(`maintenance-locks/${treeId}`);
        });

        // 1. A 取鎖 → 200，鎖屬於 A
        const rAcq = await api.post(`maintenance-locks/${treeId}`, { session_hint: 'A-測試' });
        A.assertJsonOk(rAcq, 'A 取鎖');
        const aLockUserId = rAcq.body.lock.user_id;
        assert.ok(aLockUserId, 'A 鎖缺 user_id');

        // 2. A 重入 → 200 renewed
        const rReentrant = await api.post(`maintenance-locks/${treeId}`, {});
        A.assertJsonOk(rReentrant, 'A 重入');
        assert.strictEqual(rReentrant.body.renewed, true, 'A 同人再取應 renewed=true');

        // 3. B 查清單看得到 A 的鎖
        const rList = await apiB.get('maintenance-locks', { query: { project_code: projectCode } });
        A.assertJsonOk(rList, 'B 查鎖清單');
        const locks = rList.body.locks || [];
        assert.ok(locks.some((l) => l.tree_id === treeId), `B 清單應含 tree ${treeId}`);

        // 4. B 搶同一棵 → 409 LOCKED，持有者為 A
        const rConflict = await apiB.post(`maintenance-locks/${treeId}`, {});
        A.assertStatus(rConflict, 409, 'B 應被鎖擋');
        assert.strictEqual(rConflict.body.code, 'LOCKED', '應回 code=LOCKED');
        assert.strictEqual(
          rConflict.body.lock && rConflict.body.lock.user_id,
          aLockUserId,
          '409 應顯示 A 為持有者'
        );

        // 5. A 釋放 → 200
        const rRelease = await api.delete(`maintenance-locks/${treeId}`);
        A.assertJsonOk(rRelease, 'A 釋放鎖');

        // 6. 釋放後 B 可取鎖 → 200，鎖換手給 B
        const rAcqB = await apiB.post(`maintenance-locks/${treeId}`, {});
        A.assertJsonOk(rAcqB, 'B 在 A 釋放後取鎖');
        assert.notStrictEqual(rAcqB.body.lock.user_id, aLockUserId, '鎖應已換手（不再是 A）');
        if (bUserId) {
          assert.strictEqual(rAcqB.body.lock.user_id, bUserId, '鎖現應屬於 B');
        }
      },
    },
  ],
};
