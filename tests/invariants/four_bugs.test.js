/**
 * invariants/four_bugs.test.js — May 3 四個 bug 的永久回歸防護
 *
 * Bug 1: 「?」亂碼（U+FFFD）— 待後端 textValidation.js 補上時加，目前 SKIP
 * Bug 2: test 專案無法刪除 — 改 DELETE /projects/:code 用 projects 表存在性
 * Bug 3: 區位流程斷裂 — 改 GET /projects/by_area/:area 用 project_id JOIN
 * Bug 4: 地圖 city 過濾無效 — 改 GET /tree_survey/map?city= 用 _city 標註
 */
'use strict';

const assert = require('assert');

module.exports = {
    section: 'invariants',
    cases: [
        // ─── Bug 1 ──────────────────────────────────────────────────
        {
            name: 'Bug 1 (TODO): CSV 含 U+FFFD 應被後端拒絕',
            skip: 'pending: utils/textValidation.js + DB CHECK constraint 尚未實作',
            run: async () => {},
        },

        // ─── Bug 2 ──────────────────────────────────────────────────
        {
            name: 'Bug 2: 建立空 projects 列（無樹）→ 應能 DELETE 200',
            run: async (ctx) => {
                await ctx.api.login('admin');

                // 先建區位（DELETE area 不需專案存在）
                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea, 'create area');
                const areaId = rArea.body.data.id;
                ctx.cleanup.track('area', areaId);

                // 建空專案
                const proj = ctx.factories.buildProject({ area: area.area_name });
                const rProj = await ctx.api.post('projects/add', { name: proj.name, area: proj.area });
                ctx.assert.assertJsonOk(rProj, 'create project');
                const code = rProj.body.project.code;
                // 不 track，下面手動驗 DELETE

                // DELETE 必須回 200（修 Bug 2 之後）
                const rDel = await ctx.api.delete(`projects/${encodeURIComponent(code)}`);
                ctx.assert.assertJsonOk(rDel, 'delete empty project');

                // 再 GET 應 404
                const rGet = await ctx.api.get(`projects/by_code/${encodeURIComponent(code)}`);
                ctx.assert.assertStatus(rGet, 404, 'project should be gone');
            },
        },
        {
            name: 'Bug 2: 帶樹的專案刪除 → 級聯清除 tree_survey',
            run: async (ctx) => {
                await ctx.api.login('admin');

                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea);
                ctx.cleanup.track('area', rArea.body.data.id);

                const projBody = ctx.factories.buildProject({ area: area.area_name });
                const rProj = await ctx.api.post('projects/add', { name: projBody.name, area: projBody.area });
                ctx.assert.assertJsonOk(rProj);
                const code = rProj.body.project.code;

                // 建一棵樹
                const tree = ctx.factories.buildTree({ project_code: code, project_name: projBody.name });
                const rTree = await ctx.api.post('tree_survey/create_v2', tree);
                if (rTree.statusCode !== 200 && rTree.statusCode !== 201) {
                    // 部分後端 deploy 還沒有 create_v2 通用入口，試一次 batch_import 先建一棵
                    const rBatch = await ctx.api.post('tree_survey/batch_import', {
                        project_code: code,
                        project_name: projBody.name,
                        trees: [tree],
                    });
                    ctx.assert.assertJsonOk(rBatch, 'create one tree via batch fallback');
                } else {
                    ctx.assert.assertJsonOk(rTree, 'create tree');
                }

                // DELETE project 應級聯刪掉樹
                const rDel = await ctx.api.delete(`projects/${encodeURIComponent(code)}`);
                ctx.assert.assertJsonOk(rDel, 'delete project with tree');
                assert.ok(rDel.body.details && rDel.body.details.trees >= 1,
                    `details.trees 應 ≥ 1，實得 ${JSON.stringify(rDel.body.details)}`);
            },
        },

        // ─── Bug 3 ──────────────────────────────────────────────────
        {
            name: 'Bug 3: GET /projects/by_area/:area 用 project_id JOIN，含「（B1）」suffix 不會斷',
            run: async (ctx) => {
                await ctx.api.login('admin');

                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea);
                ctx.cleanup.track('area', rArea.body.data.id);

                // 建兩個專案，名稱含「（B1）」suffix（模擬 May 3 漂移情境）
                const namedSuffix = `${ctx.factories.buildProject({ area: area.area_name }).name}（B1）`;
                const rP1 = await ctx.api.post('projects/add', { name: namedSuffix, area: area.area_name });
                ctx.assert.assertJsonOk(rP1);
                const code1 = rP1.body.project.code;
                ctx.cleanup.track('project', code1);

                // 透過 by_area 應撈到此專案
                const r = await ctx.api.get(`projects/by_area/${encodeURIComponent(area.area_name)}`);
                ctx.assert.assertJsonOk(r);
                ctx.assert.assertArray(r.body.data);
                const found = r.body.data.find(p => p.code === code1);
                assert.ok(found, `by_area 沒撈到剛建的專案（含 B1 suffix），data=${JSON.stringify(r.body.data).slice(0, 200)}`);
            },
        },
        {
            name: 'Bug 3: by_area?city=異體字 應與台/臺等價',
            run: async (ctx) => {
                await ctx.api.login('admin');

                const area = ctx.factories.buildArea({
                    area_name: `安平港_${ctx.config.TEST_ID}`,
                    city: '台南市',
                });
                const rArea = await ctx.api.post('project_areas', { ...area, isSubmit: false });
                ctx.assert.assertJsonOk(rArea);
                ctx.cleanup.track('area', rArea.body.data.id);

                const proj = ctx.factories.buildProject({ area: area.area_name });
                const rP = await ctx.api.post('projects/add', { name: proj.name, area: area.area_name });
                ctx.assert.assertJsonOk(rP);
                ctx.cleanup.track('project', rP.body.project.code);

                // 用「臺南市」查 → 必須撈到（台/臺等價）
                const r = await ctx.api.get(`projects/by_area/${encodeURIComponent(area.area_name)}`,
                    { query: { city: '臺南市' } });
                ctx.assert.assertJsonOk(r);
                const found = r.body.data.find(p => p.code === rP.body.project.code);
                assert.ok(found,
                    `by_area?city=臺南市 應撈到 area.city=台南市 的專案。data=${JSON.stringify(r.body.data).slice(0, 200)}`);
            },
        },

        // ─── Bug 4 ──────────────────────────────────────────────────
        {
            name: 'Bug 4: GET /tree_survey/map?city=花蓮縣 結果全為花蓮（_city 服務端標註）',
            run: async (ctx) => {
                await ctx.api.login('admin');
                const r = await ctx.api.get('tree_survey/map', { query: { city: '花蓮縣' } });
                ctx.assert.assertJsonOk(r);
                ctx.assert.assertArray(r.body.data);
                for (const t of r.body.data) {
                    assert.ok(
                        t._city === '花蓮縣' || t._city === '花蓮市',
                        `tree id=${t.id} _city='${t._city}' 不是花蓮，但出現在 city=花蓮縣 結果中`
                    );
                }
            },
        },
        {
            name: 'Bug 4: GET /tree_survey/map?city=臺中市 應與台中市等價',
            run: async (ctx) => {
                await ctx.api.login('admin');
                const r1 = await ctx.api.get('tree_survey/map', { query: { city: '台中市' } });
                const r2 = await ctx.api.get('tree_survey/map', { query: { city: '臺中市' } });
                ctx.assert.assertJsonOk(r1);
                ctx.assert.assertJsonOk(r2);
                assert.strictEqual(r1.body.data.length, r2.body.data.length,
                    `台中市/臺中市結果應筆數相等，得 ${r1.body.data.length} vs ${r2.body.data.length}`);
            },
        },
    ],
};
