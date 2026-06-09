/**
 * contracts/batch_idempotency.test.js — 弱網冪等上傳契約（R1）
 *
 * 取代人工驗證：「同一 X-Request-Id 重送 POST /pending-measurements/batch，
 * 第二次回相同 inserted_ids，不重複插列」。
 *
 * 後端用 api_request_dedup(request_id, route_key) 快取回應；重放回放同一 status_code +
 * response_body。X-Request-Id 須 8–128 字、符合 /^[A-Za-z0-9._-]+$/。
 */
'use strict';

const assert = require('assert');
const { TEST_ID } = require('../config');

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '冪等：同 X-Request-Id 重送 batch → 相同 inserted_ids，不重複插列',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;
        await api.login('admin');

        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        const proj = factories.buildProject({ area: area.area_name });
        const rProj = await api.post('projects/add', { name: proj.name, area: proj.area });
        A.assertJsonOk(rProj, '建專案');
        const projectCode = rProj.body.project.code;
        cleanup.track('project', projectCode);

        const sessionId = `idem-${TEST_ID}-${Date.now()}`;
        cleanup.track('pendingSession', sessionId);
        const measurement = {
          session_id: sessionId,
          project_area: area.area_name,
          project_code: projectCode,
          project_name: proj.name,
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
        const body = { measurements: [measurement] };
        const reqId = `req-${TEST_ID}-${Date.now()}`; // 符合 8–128 + 字元集
        const headers = { 'X-Request-Id': reqId };

        const r1 = await api.post('pending-measurements/batch', body, { headers });
        A.assertJsonOk(r1, '首次上傳');
        const ids1 = r1.body.inserted_ids || [];
        assert.strictEqual(ids1.length, 1, `首次應插 1 筆，實得 ${ids1.length}`);

        // 重送相同 request id + 相同 body → 回放快取，不重複插列
        const r2 = await api.post('pending-measurements/batch', body, { headers });
        A.assertStatus(r2, 201, '重送應回放 201');
        const ids2 = r2.body.inserted_ids || [];
        assert.deepStrictEqual(ids2, ids1, '重送應回相同 inserted_ids（未重複插列）');

        // 旁證：該 session 的 trees 仍只有 1 筆（沒被插成 2 筆）
        const rTrees = await api.get('pending-measurements/trees', {
          query: { session_id: sessionId },
        });
        A.assertStatus(rTrees, 200, '查 session trees');
        // 此端點回傳「裸陣列」（非 {success,data}）
        const rows = Array.isArray(rTrees.body) ? rTrees.body : (rTrees.body.data || []);
        assert.strictEqual(rows.length, 1, `session 應只有 1 筆，實得 ${rows.length}`);
      },
    },
  ],
};
