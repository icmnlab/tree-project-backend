/**
 * contracts/tree_update_optimistic_lock.test.js — tree_survey update_v2 樂觀鎖契約（P1-1）
 *
 * 取代「兩台手機同時編輯同一棵樹」的人工驗證，對應前端：
 *   - tree_edit_page_v2（單棵編輯，409 → 三選一對話框）
 *   - tree_list_page 批次更新（逐棵帶 expected_updated_at，409 → 略過並回報）
 *
 * 後端 controllers/treeSurveyUpdateController：
 *   - 不帶 expected_updated_at → 跳過鎖（向後相容，後寫贏）。
 *   - 帶且毫秒級不符 → 409 CONFLICT + serverVersion。
 *
 * 不需兩台實機：以「A 先讀 → B 改 → A 用舊版本提交」重現。
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

/** 讀單棵樹的 updated_at（模擬使用者載入編輯頁/清單）。 */
async function readUpdatedAt(ctx, treeId) {
    const r = await ctx.api.get(`tree_survey/by_id/${treeId}`);
    ctx.assert.assertJsonOk(r, '讀樹');
    const data = r.body.data || r.body;
    const ts = data.updated_at;
    assert.ok(ts, `by_id 應回傳 updated_at：${JSON.stringify(data).slice(0, 200)}`);
    return ts;
}

module.exports = {
    section: 'contracts',
    cases: [
        {
            name: 'tree update_v2 樂觀鎖：B 先改 → A 用舊版本提交 → 409 CONFLICT + serverVersion；A 取新版本重送 → 200',
            run: async (ctx) => {
                const { api } = ctx;
                const treeId = await setupTree(ctx);

                // A、B 同時載入（同一版本 T0）
                const t0 = await readUpdatedAt(ctx, treeId);

                // B 先提交（帶正確 T0）→ 成功，版本前進到 T1
                const rB = await api.put(`tree_survey/update_v2/${treeId}`, {
                    tree_height_m: 11.1,
                    survey_notes: `B改_${TEST_ID}`,
                    expected_updated_at: t0,
                });
                ctx.assert.assertJsonOk(rB, 'B 以 T0 提交應成功');

                // A 仍用 T0 提交 → 409 CONFLICT（不可蓋掉 B 的修改）
                const rA = await api.put(`tree_survey/update_v2/${treeId}`, {
                    tree_height_m: 22.2,
                    survey_notes: `A改_${TEST_ID}`,
                    expected_updated_at: t0,
                });
                ctx.assert.assertStatus(rA, 409, 'A 用過期版本應 409');
                assert.strictEqual(rA.body.code, 'CONFLICT', '應回 code=CONFLICT');
                assert.ok(rA.body.serverVersion, '409 應附 serverVersion 供前端合併');

                // B 的修改不可被 A 蓋掉
                const rCheck = await api.get(`tree_survey/by_id/${treeId}`);
                ctx.assert.assertJsonOk(rCheck, '衝突後讀樹');
                const data = rCheck.body.data || rCheck.body;
                const notes = data['調查備註'] ?? data.survey_notes;
                assert.ok(String(notes).includes('B改'), `B 的修改應保留，實際=${notes}`);

                // A 重新載入取得 T1 後重送 → 200
                const t1 = await readUpdatedAt(ctx, treeId);
                const rA2 = await api.put(`tree_survey/update_v2/${treeId}`, {
                    tree_height_m: 22.2,
                    survey_notes: `A重送_${TEST_ID}`,
                    expected_updated_at: t1,
                });
                ctx.assert.assertJsonOk(rA2, 'A 以最新版本重送應成功');
            },
        },
        {
            name: 'tree update_v2 向後相容：不帶 expected_updated_at → 跳過鎖直接成功（後寫贏）',
            run: async (ctx) => {
                const { api } = ctx;
                const treeId = await setupTree(ctx);

                const r1 = await api.put(`tree_survey/update_v2/${treeId}`, {
                    survey_notes: `first_${TEST_ID}`,
                });
                ctx.assert.assertJsonOk(r1, '第一次無鎖更新');

                const r2 = await api.put(`tree_survey/update_v2/${treeId}`, {
                    survey_notes: `second_${TEST_ID}`,
                });
                ctx.assert.assertJsonOk(r2, '第二次無鎖更新（後寫贏）');
            },
        },
    ],
};
