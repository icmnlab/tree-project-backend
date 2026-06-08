/**
 * contracts/transfer_gps_guard.test.js — 轉移前 GPS 守門契約測試
 *
 * 取代「實機：GPS 未確認的資料不可被轉入正式 tree_survey」的人工驗證（P0-8 的一部分）。
 *
 * 不變量：pending 若 GPS 尚未確認，transfer 必須擋下（HTTP 400 + blocked_pending_ids），
 *         且整批 ROLLBACK——不可有任何半套資料進 tree_survey。守門條件（任一成立即擋）：
 *           1. gps_source = 'mixed_pending'（站點/樹點來源混用，尚未由使用者裁決）
 *           2. raw_data_snapshot.requires_gps_fix = true（明確標記待補 GPS）
 *           3. 缺 tree_latitude / tree_longitude（本表為 NOT NULL，故此路徑由 DB 保證，不在此測）
 *
 * 兩個 case 各自獨立建資料、各自 transfer，結束反向清理。
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
    status: 'completed',
  };
}

async function setupProject(ctx) {
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

  return { areaName: area.area_name, projectCode, projectName: projBody.name };
}

async function assertBlocked(ctx, measurement, sessionId, label) {
  const { api, assert: A, cleanup } = ctx;

  const rBatch = await api.post('pending-measurements/batch', { measurements: [measurement] });
  A.assertJsonOk(rBatch, `${label} 建 pending`);
  cleanup.track('pendingSession', sessionId);
  const pendingId = (rBatch.body.inserted_ids || [])[0];
  assert.ok(pendingId, `${label} 應回傳 inserted id`);

  const rTransfer = await api.post('pending-measurements/transfer', { session_id: sessionId });
  A.assertStatus(rTransfer, 400, `${label} transfer 應被 GPS 守門擋下`);
  assert.strictEqual(rTransfer.body.success, false, `${label} 應 success=false`);
  const blocked = rTransfer.body.blocked_pending_ids || [];
  assert.ok(
    blocked.includes(pendingId),
    `${label} blocked_pending_ids 應含 ${pendingId}，實得 ${JSON.stringify(blocked)}`,
  );
  // 整批 ROLLBACK：不可有 transferred_tree_ids
  assert.ok(
    !rTransfer.body.transferred_tree_ids || rTransfer.body.transferred_tree_ids.length === 0,
    `${label} 不該轉移任何樹`,
  );
}

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '轉移守門：gps_source=mixed_pending 的 pending 不可轉移（400 + ROLLBACK）',
      run: async (ctx) => {
        const { projectCode, projectName, areaName } = await setupProject(ctx);
        const sessionId = `gpsguard-mixed-${TEST_ID}-${Date.now()}`;
        const m = baseMeasurement({ sessionId, area: areaName, projectCode, projectName });
        m.gps_source = 'mixed_pending';
        await assertBlocked(ctx, m, sessionId, 'mixed_pending');
      },
    },
    {
      name: '轉移守門：raw_data_snapshot.requires_gps_fix=true 的 pending 不可轉移（400 + ROLLBACK）',
      run: async (ctx) => {
        const { projectCode, projectName, areaName } = await setupProject(ctx);
        const sessionId = `gpsguard-fix-${TEST_ID}-${Date.now()}`;
        const m = baseMeasurement({ sessionId, area: areaName, projectCode, projectName });
        m.gps_source = 'tree'; // 來源本身合法，靠 requires_gps_fix 旗標觸發守門
        m.raw_data_snapshot = { requires_gps_fix: true };
        await assertBlocked(ctx, m, sessionId, 'requires_gps_fix');
      },
    },
  ],
};
