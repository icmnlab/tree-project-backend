/**
 * contracts/instrument_traceability.test.js — 儀器溯源契約測試
 *
 * 取代「實機：pending → transfer → GET 歷次量測，確認帶儀器欄位」的人工驗證（A4 / P0-9）。
 *
 * 不變量：現場以 VLGEO2 量測（measurement_type 決定 instrument_type、
 *         instrument_dbh_cm 為遠端徑量值）建立的 pending，轉移成正式樹後，
 *         歷次量測 API 必須把 instrument_type / instrument_dbh_cm 一併回傳，
 *         確保儀器資料可被後續查詢／稽核（溯源）。
 *
 * 流程：
 *   1. 建區位 + 專案
 *   2. POST /pending-measurements/batch 直接以 status='completed' 寫入一筆，帶儀器欄位
 *   3. POST /pending-measurements/transfer 轉成正式 tree_survey（同步寫歷次量測）
 *   4. GET /tree_survey/by_id/:id/measurements → 斷言最新一筆含 instrument_type / instrument_dbh_cm
 *
 * 全部資料用 TEST_ID 前綴；結束反向清理（tree / pendingSession / project / area）。
 */
'use strict';

const assert = require('assert');
const { TEST_ID } = require('../config');

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '儀器溯源：pending(completed) → transfer → 歷次量測 GET 帶 instrument_type/instrument_dbh_cm',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;

        await api.login('admin');

        // ── 建區位 + 專案 ──
        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        const projBody = factories.buildProject({ area: area.area_name });
        const rProj = await api.post('projects/add', { name: projBody.name, area: projBody.area });
        A.assertJsonOk(rProj, '建專案');
        const projectCode = rProj.body.project.code;
        cleanup.track('project', projectCode);

        // ── 建 pending（status=completed，帶儀器欄位）──
        const sessionId = `pend-${TEST_ID}-${Date.now()}`;
        const INSTRUMENT_TYPE = 'DME'; // measurement_type → resolveInstrumentType → instrument_type
        const INSTRUMENT_DBH = 12.3;   // VLGEO2 Remote Diameter 量測值
        const measurement = {
          session_id: sessionId,
          project_area: area.area_name,
          project_code: projectCode,
          project_name: projBody.name,
          species_name: '測試樹種',
          // 以下皆為 pending 表 NOT NULL 欄位
          tree_height: 9.5,
          tree_latitude: 23.86,
          tree_longitude: 121.51,
          station_latitude: 23.8601,
          station_longitude: 121.5101,
          horizontal_distance: 12.0,
          slope_distance: 12.2,
          azimuth: 95.0,
          pitch: 5.0,
          // 一般 / 儀器欄位
          dbh_cm: 20.1,
          altitude: 30.0,
          measurement_type: INSTRUMENT_TYPE,
          instrument_dbh_cm: INSTRUMENT_DBH,
          dbh_source: 'remote_diameter',
          // gps_source='tree' → 直接採用 tree_lat/lng，不會被 transfer 的 GPS 守門擋下
          gps_source: 'tree',
          status: 'completed',
        };

        const rBatch = await api.post('pending-measurements/batch', { measurements: [measurement] });
        A.assertJsonOk(rBatch, '建 pending');
        cleanup.track('pendingSession', sessionId);

        // ── 轉移 ──
        const rTransfer = await api.post('pending-measurements/transfer', { session_id: sessionId });
        A.assertJsonOk(rTransfer, 'transfer');
        const treeIds = rTransfer.body.transferred_tree_ids || [];
        assert.strictEqual(
          treeIds.length,
          1,
          `應轉移 1 筆，實得 ${treeIds.length}：${JSON.stringify(rTransfer.body).slice(0, 200)}`,
        );
        const treeId = treeIds[0];
        cleanup.track('tree', treeId);

        // ── 查歷次量測，斷言儀器欄位被回傳 ──
        const rHist = await api.get(`tree_survey/by_id/${treeId}/measurements`);
        A.assertJsonOk(rHist, '查歷次量測');
        const rows = rHist.body.data || [];
        assert.ok(rows.length >= 1, `歷次量測應 ≥1 筆，實得 ${rows.length}`);

        const latest = rows[0];
        assert.ok(
          Object.prototype.hasOwnProperty.call(latest, 'instrument_type'),
          `歷次量測缺 instrument_type 欄位：${JSON.stringify(latest).slice(0, 200)}`,
        );
        assert.strictEqual(
          latest.instrument_type,
          INSTRUMENT_TYPE,
          `instrument_type 應為 ${INSTRUMENT_TYPE}，實得 ${latest.instrument_type}`,
        );
        assert.strictEqual(
          Number(latest.instrument_dbh_cm),
          INSTRUMENT_DBH,
          `instrument_dbh_cm 應為 ${INSTRUMENT_DBH}，實得 ${latest.instrument_dbh_cm}`,
        );
      },
    },
  ],
};
