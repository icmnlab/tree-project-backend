/**
 * contracts/pending_ownership.test.js — pending 任務擁有權契約測試（稽核#1/#3）
 *
 * 取代「兩台手機互改對方待測批次」的人工驗證：
 *   1. A、B 都是調查管理員且擁有同一專案權限（projectFilter 都放行）
 *   2. A 建立 pending 批次（batch 自動寫入 created_by_user_id = A）
 *   3. B PATCH A 的單筆 → 403 NOT_OWNER（被擋一定是擁有權，不是專案權限）
 *   4. B 刪除 A 的 session → 403 NOT_OWNER
 *   5. B 改 A session 的專案 → 403 NOT_OWNER
 *   6. A 改自己的單筆 → 200
 *   7. 系統管理員刪 A 的 session → 200（管理員可代管）
 *
 * 所有資料用 TEST_ID 前綴，結束一律 cleanup。
 */
'use strict';

const assert = require('assert');
const { Api } = require('../helpers/apiClient');

function buildPendingMeasurement(sessionId, project) {
  return {
    session_id: sessionId,
    original_record_id: 'T-OWN-1',
    project_area: project.area,
    project_code: project.code,
    project_name: project.name,
    species_name: '測試樹種',
    tree_height: 10.5,
    dbh_cm: 20,
    tree_latitude: 23.86,
    tree_longitude: 121.51,
    station_latitude: 23.8601,
    station_longitude: 121.5101,
    horizontal_distance: 5.0,
    slope_distance: 5.1,
    azimuth: 90.0,
    pitch: 2.0,
    status: 'pending',
    gps_source: 'tree',
  };
}

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: 'pending 擁有權：A 建批次 → B 改/刪/轉專案 403 → A 可改 → 管理員可刪',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;

        // ── 管理員建基礎資料 ──
        await api.login('admin');

        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        const projBody = factories.buildProject({ area: area.area_name });
        const rProj = await api.post('projects/add', { name: projBody.name, area: projBody.area });
        A.assertJsonOk(rProj, '建專案');
        const projectCode = rProj.body.project.code;
        cleanup.track('project', projectCode);
        const project = { code: projectCode, name: projBody.name, area: area.area_name };

        // ── 建 A、B 兩位調查管理員，並指派同一專案 ──
        const makeSurveyor = async (label) => {
          const u = factories.buildUser({ role: '調查管理員' });
          const rU = await api.post('users', u);
          A.assertJsonOk(rU, `建使用者 ${label}`);
          cleanup.track('user', rU.body.userId);
          const rAssign = await api.put(`users/${rU.body.userId}/projects`, {
            projects: [projectCode],
          });
          A.assertJsonOk(rAssign, `${label} 指派專案`);
          const client = new Api();
          const rLogin = await client.post('login', {
            account: u.username,
            password: u.password,
            loginType: 'admin',
          });
          A.assertJsonOk(rLogin, `${label} 登入`);
          client.setToken(rLogin.body.token);
          return client;
        };

        const apiA = await makeSurveyor('A');
        const apiB = await makeSurveyor('B');

        // ── A 建 pending 批次 ──
        const sessionId = `MS-TEST-OWN-${Date.now()}`;
        const rBatch = await apiA.post('pending-measurements/batch', {
          measurements: [buildPendingMeasurement(sessionId, project)],
        });
        A.assertJsonOk(rBatch, 'A 建批次');
        const pendingId = rBatch.body.inserted_ids[0];
        assert.ok(pendingId, `批次回傳缺 inserted_ids：${JSON.stringify(rBatch.body).slice(0, 200)}`);

        // 不論成敗，最後由管理員清掉 session
        cleanup.track('custom', `pending-session-${sessionId}`, async (cleanupApi) => {
          await cleanupApi.delete(`pending-measurements/session/${sessionId}`);
        });

        // 1. B PATCH A 的單筆 → 403 NOT_OWNER
        const rPatchB = await apiB.patch(`pending-measurements/${pendingId}`, {
          measurement_notes: 'B 嘗試亂改',
        });
        A.assertStatus(rPatchB, 403, 'B 改 A 的 pending 應 403');
        assert.strictEqual(rPatchB.body.code, 'NOT_OWNER', '應回 code=NOT_OWNER');

        // 2. B 刪 A 的 session → 403 NOT_OWNER
        const rDelB = await apiB.delete(`pending-measurements/session/${sessionId}`);
        A.assertStatus(rDelB, 403, 'B 刪 A 的 session 應 403');
        assert.strictEqual(rDelB.body.code, 'NOT_OWNER', '應回 code=NOT_OWNER');

        // 3. B 改 A session 的專案 → 403 NOT_OWNER
        const rProjB = await apiB.patch(`pending-measurements/session/${sessionId}/project`, {
          project_area: project.area,
          project_code: project.code,
          project_name: project.name,
        });
        A.assertStatus(rProjB, 403, 'B 改 A session 專案應 403');
        assert.strictEqual(rProjB.body.code, 'NOT_OWNER', '應回 code=NOT_OWNER');

        // 4. A 改自己的單筆 → 200
        const rPatchA = await apiA.patch(`pending-measurements/${pendingId}`, {
          measurement_notes: '擁有者修改 OK',
        });
        A.assertJsonOk(rPatchA, 'A 改自己的 pending 應成功');

        // 5. 系統管理員刪 A 的 session → 200（bypass 角色可代管）
        const rDelAdmin = await api.delete(`pending-measurements/session/${sessionId}`);
        A.assertJsonOk(rDelAdmin, '管理員刪 session 應成功');
        assert.ok(rDelAdmin.body.deleted_count >= 1, '管理員刪除應 ≥1 筆');
      },
    },
  ],
};
