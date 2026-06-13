/**
 * contracts/project_boundary_import.test.js — 邊界輸入擴充契約（方式 1+3）
 *
 * 取代人工驗證：
 *   - 自相交多邊形 POST /api/project-boundaries → 400 SELF_INTERSECTING（守住非預期範圍）。
 *   - source 欄位可寫入並由列表回讀（draw|coords|kml|geojson|suggest 溯源）。
 *   - POST /api/project-boundaries/import 上傳 GeoJSON → 200 預覽（含 coordinates，不寫庫）。
 *
 * 建邊界 / 匯入需 requireRole('專案管理員')；admin 角色更高可用。座標 [[lat,lng],...]。
 */
'use strict';

const assert = require('assert');

function buildMultipartGeoJson(filename, geojsonString) {
  const boundary = '----treeaiBoundaryTest' + Date.now();
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    'Content-Type: application/geo+json\r\n\r\n';
  const tail = `\r\n--${boundary}--\r\n`;
  const payload = Buffer.concat([
    Buffer.from(head, 'utf8'),
    Buffer.from(geojsonString, 'utf8'),
    Buffer.from(tail, 'utf8'),
  ]);
  return {
    body: payload.toString('binary'),
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
  };
}

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '邊界儲存：自相交多邊形 → 400 SELF_INTERSECTING',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;
        await api.login('admin');

        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        const rProj = await api.post('projects/add', {
          name: factories.buildProject({ area: area.area_name }).name,
          area: area.area_name,
        });
        A.assertJsonOk(rProj, '建專案');
        const code = rProj.body.project.code;
        const projName = rProj.body.project.name;
        cleanup.track('project', code);

        // 蝴蝶結（自相交）[[lat,lng],...]
        const bowtie = [
          [23.860, 121.510],
          [23.862, 121.512],
          [23.862, 121.510],
          [23.860, 121.512],
        ];
        const r = await api.post('project-boundaries', {
          projectName: projName,
          projectCode: code,
          coordinates: bowtie,
        });
        A.assertStatus(r, 400, '自相交應 400');
        assert.strictEqual(r.body.code, 'SELF_INTERSECTING', '應回 SELF_INTERSECTING');
      },
    },
    {
      name: '邊界儲存：source 欄位可寫入並由列表回讀',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;
        await api.login('admin');

        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        const rProj = await api.post('projects/add', {
          name: factories.buildProject({ area: area.area_name }).name,
          area: area.area_name,
        });
        A.assertJsonOk(rProj, '建專案');
        const code = rProj.body.project.code;
        const projName = rProj.body.project.name;
        cleanup.track('project', code);

        const square = [
          [23.860, 121.510],
          [23.860, 121.512],
          [23.862, 121.512],
          [23.862, 121.510],
        ];
        const rBnd = await api.post('project-boundaries', {
          projectName: projName,
          projectCode: code,
          coordinates: square,
          source: 'coords',
        });
        A.assertJsonOk(rBnd, '建邊界（source=coords）');
        cleanup.track('custom', `bnd-${code}`, async (cApi) => {
          await cApi.delete(`project-boundaries/by_code/${encodeURIComponent(code)}`);
        });

        const rList = await api.get('project-boundaries');
        A.assertJsonOk(rList, '取得邊界列表');
        const found = (rList.body.data || []).find((b) => b.project_name === projName);
        assert.ok(found, '列表應含新建邊界');
        assert.strictEqual(found.source, 'coords', 'source 應為 coords');
      },
    },
    {
      name: '邊界匯出：GET export.kml 回 KML（lng,lat 序、可於 Google Earth 開啟）',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;
        await api.login('admin');

        const area = factories.buildArea();
        const rArea = await api.post('project_areas', area);
        A.assertJsonOk(rArea, '建區位');
        cleanup.track('area', rArea.body.data.id);

        const rProj = await api.post('projects/add', {
          name: factories.buildProject({ area: area.area_name }).name,
          area: area.area_name,
        });
        A.assertJsonOk(rProj, '建專案');
        const code = rProj.body.project.code;
        const projName = rProj.body.project.name;
        cleanup.track('project', code);

        const square = [
          [23.860, 121.510],
          [23.860, 121.512],
          [23.862, 121.512],
          [23.862, 121.510],
        ];
        const rBnd = await api.post('project-boundaries', {
          projectName: projName,
          projectCode: code,
          coordinates: square,
          source: 'coords',
        });
        A.assertJsonOk(rBnd, '建邊界');
        cleanup.track('custom', `bnd-${code}`, async (cApi) => {
          await cApi.delete(`project-boundaries/by_code/${encodeURIComponent(code)}`);
        });

        const r = await api.get('project-boundaries/export.kml', {
          query: { project: projName },
        });
        A.assertStatus(r, 200, '匯出 KML 應 200');
        const ct = r.headers['content-type'] || '';
        assert.ok(ct.includes('kml'), `content-type 應含 kml，實得 ${ct}`);
        const kml = typeof r.body === 'string' ? r.body : String(r.body);
        assert.ok(kml.includes('<kml'), '應為 KML 文件');
        assert.ok(kml.includes('<Polygon>'), '應含 Polygon');
        // KML 用 lng,lat,0 序，且環需閉合（首點重複）
        assert.ok(kml.includes('121.51,23.86,0'), '座標應為 lng,lat,0 序');
      },
    },
    {
      name: '邊界匯出：不存在的專案 → 404',
      run: async (ctx) => {
        const { api, assert: A } = ctx;
        await api.login('admin');
        const r = await api.get('project-boundaries/export.kml', {
          query: { project: '__不存在的專案__' + Date.now() },
        });
        A.assertStatus(r, 404, '無邊界應 404');
      },
    },
    {
      name: '邊界匯入：上傳 GeoJSON → 200 預覽（不寫庫）',
      run: async (ctx) => {
        const { api, assert: A } = ctx;
        await api.login('admin');

        const geojson = JSON.stringify({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [121.510, 23.860],
              [121.512, 23.860],
              [121.512, 23.862],
              [121.510, 23.862],
              [121.510, 23.860],
            ]],
          },
        });
        const { body, headers } = buildMultipartGeoJson('test.geojson', geojson);
        const r = await api.post('project-boundaries/import', body, { headers });
        A.assertJsonOk(r, '匯入 GeoJSON 應 200');
        assert.strictEqual(r.body.preview, true, '應為預覽（不寫庫）');
        assert.ok(Array.isArray(r.body.coordinates) && r.body.coordinates.length >= 3, '應回 ≥3 頂點');
        assert.strictEqual(r.body.format, 'geojson', 'format 應為 geojson');
      },
    },
  ],
};
