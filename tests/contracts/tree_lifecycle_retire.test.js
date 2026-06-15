/**
 * contracts/tree_lifecycle_retire.test.js — 樹木生命週期（淘汰/復原）契約
 *
 * 取代人工驗證：
 *   - POST /api/tree_survey/:id/retire  將樹標記為淘汰（dead/fallen/removed），
 *     不刪資料、設 retired_at/reason；by_id 回讀 lifecycle_status 已變更。
 *   - POST /api/tree_survey/:id/restore 復原為 active，清空 retired_at/reason。
 *   - retire 帶非法 lifecycle_status → 400（守住非預期值）。
 *
 * 端點需 requireRole('調查管理員') + projectAuth；admin（系統管理員）權限更高可用。
 */
'use strict';

const assert = require('assert');
const { TEST_ID } = require('../config');

async function setupTree(ctx) {
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

    const tree = factories.buildTree({
        project_code: projectCode,
        project_name: projBody.name,
        project_area: area.area_name,
    });
    const rTree = await api.post('tree_survey/create_v2', tree);
    A.assertJsonOk(rTree, '建樹 v2');
    const treeId = rTree.body.id || (rTree.body.data && rTree.body.data.id);
    assert.ok(treeId, '建樹應回傳 id');
    cleanup.track('tree', treeId);
    return treeId;
}

async function readTree(ctx, treeId) {
    const r = await ctx.api.get(`tree_survey/by_id/${treeId}`);
    ctx.assert.assertJsonOk(r, '讀樹');
    return r.body.data || r.body;
}

module.exports = {
    section: 'contracts',
    cases: [
        {
            name: '淘汰/復原：retire(dead) → by_id lifecycle=dead+retired_at；restore → active 清空',
            run: async (ctx) => {
                const { api } = ctx;
                const treeId = await setupTree(ctx);

                // 初始應為 active
                const before = await readTree(ctx, treeId);
                assert.strictEqual(before.lifecycle_status, 'active', '初始應為 active');

                // 淘汰（枯死）
                const rRetire = await api.post(`tree_survey/${treeId}/retire`, {
                    lifecycle_status: 'dead',
                    note: `枯死_${TEST_ID}`,
                });
                ctx.assert.assertJsonOk(rRetire, 'retire 應 200');

                const retired = await readTree(ctx, treeId);
                assert.strictEqual(retired.lifecycle_status, 'dead', '應變為 dead');
                assert.ok(retired.retired_at, '應寫入 retired_at');

                // 復原
                const rRestore = await api.post(`tree_survey/${treeId}/restore`, {});
                ctx.assert.assertJsonOk(rRestore, 'restore 應 200');

                const restored = await readTree(ctx, treeId);
                assert.strictEqual(restored.lifecycle_status, 'active', '應復原為 active');
                assert.ok(!restored.retired_at, 'retired_at 應清空');
            },
        },
        {
            name: '淘汰：非法 lifecycle_status（active/亂填）→ 400',
            run: async (ctx) => {
                const { api } = ctx;
                const treeId = await setupTree(ctx);

                const rBad = await api.post(`tree_survey/${treeId}/retire`, {
                    lifecycle_status: 'zombie',
                });
                ctx.assert.assertStatus(rBad, 400, '非法 lifecycle 應 400');

                const rActive = await api.post(`tree_survey/${treeId}/retire`, {
                    lifecycle_status: 'active',
                });
                ctx.assert.assertStatus(rActive, 400, 'active 非淘汰值應 400');
            },
        },
        {
            name: '新增：create_v2 status=枯立木 → lifecycle 自動為 dead（不靠維護流程）',
            run: async (ctx) => {
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

                const tree = factories.buildTree({
                    project_code: projectCode,
                    project_name: projBody.name,
                    project_area: area.area_name,
                    status: '枯立木',
                });
                const rTree = await api.post('tree_survey/create_v2', tree);
                A.assertJsonOk(rTree, '建枯立木');
                const treeId = rTree.body.id || (rTree.body.data && rTree.body.data.id);
                cleanup.track('tree', treeId);

                const created = await readTree(ctx, treeId);
                assert.strictEqual(created.lifecycle_status, 'dead', '枯立木新增即應為 dead');
                assert.ok(created.retired_at, '應寫入 retired_at');
            },
        },
        {
            name: '批次匯入：batch_import status=枯死 → lifecycle 自動為 dead；species_name 簡體入庫轉繁體',
            run: async (ctx) => {
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

                const rBatch = await api.post('tree_survey/batch_import', {
                    project_area: area.area_name,
                    project_code: projectCode,
                    project_name: projBody.name,
                    trees: [
                        {
                            species_name: '银枫树', // 簡體，應入庫為「銀楓樹」
                            lon: 121.5,
                            lat: 23.9,
                            status: '枯死',
                            height: 5,
                            dbh: 20,
                        },
                    ],
                });
                A.assertJsonOk(rBatch, 'batch_import 應 200/201');

                // 讀回該專案的樹，驗證 lifecycle + 繁體樹種名
                const rMap = await api.get('tree_survey/map', { query: { project_code: projectCode } });
                A.assertJsonOk(rMap, '讀專案樹');
                const trees = rMap.body.data || [];
                assert.ok(trees.length >= 1, '批次匯入後應至少 1 棵');
                const t = trees[0];
                const lc = t.lifecycle_status ?? t['生命週期'];
                assert.strictEqual(lc, 'dead', '批次匯入枯死應為 dead（非活立木）');
                const sp = t.species_name ?? t['樹種名稱'];
                assert.strictEqual(sp, '銀楓樹', 'species_name 應已簡轉繁為「銀楓樹」');
            },
        },
        {
            name: '編輯：update_v2 改 status=倒伏 → lifecycle 連動 fallen；改回正常 → active 清空',
            run: async (ctx) => {
                const { api } = ctx;
                const treeId = await setupTree(ctx);

                const before = await readTree(ctx, treeId);
                assert.strictEqual(before.lifecycle_status, 'active', '初始 active');

                const rUpd = await api.put(`tree_survey/update_v2/${treeId}`, { status: '倒伏' });
                ctx.assert.assertJsonOk(rUpd, '改倒伏');
                const fallen = await readTree(ctx, treeId);
                assert.strictEqual(fallen.lifecycle_status, 'fallen', '倒伏應連動 fallen');
                assert.ok(fallen.retired_at, '應寫入 retired_at');

                const rBack = await api.put(`tree_survey/update_v2/${treeId}`, { status: '正常' });
                ctx.assert.assertJsonOk(rBack, '改回正常');
                const active = await readTree(ctx, treeId);
                assert.strictEqual(active.lifecycle_status, 'active', '改回正常應 active');
                assert.ok(!active.retired_at, 'retired_at 應清空');
            },
        },
    ],
};
