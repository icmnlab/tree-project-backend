/**
 * contracts/project_boundary_by_code.test.js — 邊界 by_code 查詢契約（B2、B7）
 *
 * 取代人工驗證：
 *   B2 `GET /api/project-boundaries/by_code/{真實代碼}` → 200 + polygon（非 404）。
 *   B7 專案名稱含特殊字元（空格、括號）→ 建邊界後 by_code 仍可查到（不 404 / 不路由錯誤）。
 *   （附帶）不存在的代碼 → 404 hasBoundary:false。
 *
 * 建邊界需 requireRole('專案管理員')；admin 角色更高可建。座標格式 [[lat,lng],...]。
 */
'use strict';

const assert = require('assert');
const { TEST_ID } = require('../config');

function polygonAround(lat, lng, d = 0.001) {
  return [
    [lat - d, lng - d],
    [lat - d, lng + d],
    [lat + d, lng + d],
    [lat + d, lng - d],
  ];
}

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '邊界 by_code：建邊界後查到 200 + boundary_coordinates；不存在代碼 → 404',
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
        const code = rProj.body.project.code;
        cleanup.track('project', code);

        const coords = polygonAround(23.86, 121.51);
        const rBnd = await api.post('project-boundaries', {
          projectName: proj.name,
          projectCode: code,
          projectArea: area.area_name,
          coordinates: coords,
        });
        A.assertJsonOk(rBnd, '建邊界');
        cleanup.track('custom', `bnd-${code}`, async (cApi) => {
          await cApi.delete(`project-boundaries/by_code/${encodeURIComponent(code)}`);
        });

        // B2：by_code → 200 + polygon
        const rGet = await api.get(`project-boundaries/by_code/${encodeURIComponent(code)}`);
        A.assertJsonOk(rGet, 'by_code 應 200');
        assert.strictEqual(rGet.body.hasBoundary, true, 'hasBoundary 應 true');
        const polygon = rGet.body.data && rGet.body.data.boundary_coordinates;
        assert.ok(Array.isArray(polygon) && polygon.length >= 3, '應回傳 ≥3 頂點 polygon');
        assert.strictEqual(rGet.body.data.project_code, code, 'project_code 應一致');

        // 不存在的代碼 → 404
        const rMiss = await api.get(`project-boundaries/by_code/${encodeURIComponent('NO-SUCH-' + TEST_ID)}`);
        A.assertStatus(rMiss, 404, '不存在代碼應 404');
        assert.strictEqual(rMiss.body.hasBoundary, false, '404 應 hasBoundary:false');
      },
    },
    {
      name: '邊界 by_code：專案名稱含空格/括號，建邊界後仍可正確查到（B7）',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;
        await api.login('admin');

        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        // 名稱刻意含空格與括號
        const specialName = `測試 專案 (B7) ${TEST_ID}`;
        const rProj = await api.post('projects/add', { name: specialName, area: area.area_name });
        A.assertJsonOk(rProj, '建特殊名稱專案');
        const code = rProj.body.project.code;
        cleanup.track('project', code);

        const rBnd = await api.post('project-boundaries', {
          projectName: specialName,
          projectCode: code,
          projectArea: area.area_name,
          coordinates: polygonAround(23.86, 121.51),
        });
        A.assertJsonOk(rBnd, '建邊界（特殊名稱）');
        cleanup.track('custom', `bnd-${code}`, async (cApi) => {
          await cApi.delete(`project-boundaries/by_code/${encodeURIComponent(code)}`);
        });

        const rGet = await api.get(`project-boundaries/by_code/${encodeURIComponent(code)}`);
        A.assertJsonOk(rGet, '特殊名稱專案 by_code 應 200（不 404）');
        assert.strictEqual(rGet.body.hasBoundary, true, 'hasBoundary 應 true');
      },
    },
  ],
};
