/**
 * contracts/optimistic_lock.test.js — 樂觀併發鎖契約（L1–L5）
 *
 * 取代「兩支手機同帳號專案：A 開任務不提交；B 同任務提交；A 再提交 → 409」的人工驗證。
 *
 * 後端以 body.expected_updated_at 做樂觀鎖（PATCH /api/pending-measurements/:id）：
 *   - 不帶 expected_updated_at → 跳過鎖（向後相容）。
 *   - 帶且與伺服器現值不符 → 409 CONFLICT + serverVersion。
 *   - 帶且 row 已被刪除 → 410 DELETED。
 *
 * 不需兩台實機：用同一顆 pending 的「新舊 updated_at」即可重現衝突。
 */
'use strict';

const assert = require('assert');
const { TEST_ID } = require('../config');

function baseMeasurement({ sessionId, area, projectCode, projectName }) {
  return {
    session_id: sessionId,
    project_area: area,
    project_code: projectCode,
    project_name: projectName,
    species_name: '測試樹種',
    tree_height: 9.5,
    tree_latitude: 23.86,
    tree_longitude: 121.51,
    station_latitude: 23.8601,
    station_longitude: 121.5101,
    horizontal_distance: 12.0,
    slope_distance: 12.2,
    azimuth: 95.0,
    pitch: 5.0,
    dbh_cm: 20.1,
    gps_source: 'tree',
    status: 'pending',
  };
}

async function setupPending(ctx, sessionId) {
  const { api, factories, assert: A, cleanup } = ctx;
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

  const m = baseMeasurement({
    sessionId,
    area: area.area_name,
    projectCode,
    projectName: projBody.name,
  });
  const rBatch = await api.post('pending-measurements/batch', { measurements: [m] });
  A.assertJsonOk(rBatch, '建 pending');
  cleanup.track('pendingSession', sessionId);
  const id = (rBatch.body.inserted_ids || [])[0];
  assert.ok(id, '應回傳 inserted id');
  return id;
}

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '樂觀鎖：過期 expected_updated_at 提交 → 409 CONFLICT + serverVersion；新值 → 200',
      run: async (ctx) => {
        const { api, assert: A } = ctx;
        const sessionId = `optlock-${TEST_ID}-${Date.now()}`;
        const id = await setupPending(ctx, sessionId);

        // 不帶鎖：設 in_progress（取得 T1）
        const r1 = await api.patch(`pending-measurements/${id}`, { status: 'in_progress' });
        A.assertJsonOk(r1, '設 in_progress');
        const t1 = r1.body.data && r1.body.data.updated_at;
        assert.ok(t1, '回傳應含 updated_at');

        // 帶正確 T1：完成（取得 T2，且 T2 應更新）
        const r2 = await api.patch(`pending-measurements/${id}`, {
          status: 'completed',
          expected_updated_at: t1,
        });
        A.assertJsonOk(r2, '以 T1 完成');
        const t2 = r2.body.data && r2.body.data.updated_at;
        assert.ok(t2, '回傳應含新 updated_at');
        assert.notStrictEqual(
          new Date(t2).getTime(),
          new Date(t1).getTime(),
          'updated_at 應隨更新改變',
        );

        // 用過期 T1 再提交 → 409
        const r3 = await api.patch(`pending-measurements/${id}`, {
          status: 'completed',
          expected_updated_at: t1,
        });
        A.assertStatus(r3, 409, '過期版本應 409');
        assert.strictEqual(r3.body.code, 'CONFLICT', '應回 code=CONFLICT');
        assert.ok(r3.body.serverVersion, '409 應附 serverVersion 供合併');

        // 用最新 T2 提交 → 200（衝突解除後可成功）
        const r4 = await api.patch(`pending-measurements/${id}`, {
          status: 'completed',
          expected_updated_at: t2,
        });
        A.assertJsonOk(r4, '以最新版本提交應成功');
      },
    },
    {
      name: '樂觀鎖：對已刪除的 pending 帶 expected_updated_at 更新 → 410 DELETED',
      run: async (ctx) => {
        const { api, assert: A } = ctx;
        const sessionId = `optlock-del-${TEST_ID}-${Date.now()}`;
        const id = await setupPending(ctx, sessionId);

        const rDel = await api.delete(`pending-measurements/session/${encodeURIComponent(sessionId)}`);
        A.assertJsonOk(rDel, '刪除 session');

        const r = await api.patch(`pending-measurements/${id}`, {
          status: 'completed',
          expected_updated_at: new Date().toISOString(),
        });
        A.assertStatus(r, 410, '已刪除應 410');
        assert.strictEqual(r.body.code, 'DELETED', '應回 code=DELETED');
      },
    },
  ],
};
