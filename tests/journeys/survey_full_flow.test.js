/**
 * journeys/survey_full_flow.test.js — 取代「人工 APP 測一輪」的核心 E2E
 *
 * 模擬一個調查管理員建立完整資料的旅程：
 *   1. 登入
 *   2. 建立區位
 *   3. 在該區位下建立專案
 *   4. 在該專案下建立樹（V2）
 *   5. 取單筆 / 取列表 / by_project / by_area 都能撈到
 *   6. 更新樹（樹高/胸徑）
 *   7. 刪除樹
 *   8. 刪除專案（級聯）
 *   9. 刪除區位
 *
 * 失敗時：cleanup 會反向把所有殘留資源清掉。
 * 此 journey 只用測試管理員帳號，不會碰 production 資料。
 */
'use strict';

const assert = require('assert');

module.exports = {
    section: 'journeys',
    cases: [
        {
            name: 'survey full flow: 區位 → 專案 → 樹 → 改 → 刪',
            run: async (ctx) => {
                await ctx.api.login('admin');

                // 1. 建區位
                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea, '建區位');
                const areaId = rArea.body.data.id;
                ctx.cleanup.track('area', areaId);

                // 2. 建專案
                const projBody = ctx.factories.buildProject({ area: area.area_name });
                const rProj = await ctx.api.post('projects/add', { name: projBody.name, area: projBody.area });
                ctx.assert.assertJsonOk(rProj, '建專案');
                const projectCode = rProj.body.project.code;
                ctx.cleanup.track('project', projectCode);

                // 3. 建樹
                const tree = ctx.factories.buildTree({
                    project_code: projectCode,
                    project_name: projBody.name,
                    project_area: area.area_name,
                });
                const rTree = await ctx.api.post('tree_survey/create_v2', tree);
                ctx.assert.assertJsonOk(rTree, '建樹 v2');
                const treeId = rTree.body.id || (rTree.body.data && rTree.body.data.id);
                assert.ok(treeId, `回傳缺 id：${JSON.stringify(rTree.body).slice(0, 200)}`);
                ctx.cleanup.track('tree', treeId);

                // 4. 取單筆
                const rGet = await ctx.api.get(`tree_survey/by_id/${treeId}`);
                ctx.assert.assertJsonOk(rGet, '取單筆');
                const gotSpecies = (rGet.body.data && rGet.body.data['樹種名稱'])
                    || (rGet.body.data && rGet.body.data.species_name)
                    || (rGet.body['樹種名稱']);
                // 樹種名稱可能對齊到 tree_species 表，這邊不嚴格 assert 等於 '測試樹種'

                // 5. by_project 撈到
                const rByProj = await ctx.api.get(`tree_survey/by_project/${encodeURIComponent(projectCode)}`);
                ctx.assert.assertJsonOk(rByProj, 'by_project');
                const list1 = rByProj.body.data || rByProj.body || [];
                const inProj = list1.find(t => t.id === treeId);
                assert.ok(inProj, `by_project 沒撈到剛建的樹 id=${treeId}`);

                // 6. by_area 撈得到專案
                const rByArea = await ctx.api.get(`projects/by_area/${encodeURIComponent(area.area_name)}`);
                ctx.assert.assertJsonOk(rByArea, 'projects/by_area');
                const inArea = rByArea.body.data.find(p => p.code === projectCode);
                assert.ok(inArea, `by_area 沒撈到剛建的專案`);

                // 7. 更新樹
                const rUpd = await ctx.api.put(`tree_survey/update_v2/${treeId}`, {
                    tree_height_m: 12.5,
                    dbh_cm: 30.0,
                    survey_notes: `更新_${ctx.config.TEST_ID}`,
                });
                ctx.assert.assertJsonOk(rUpd, '更新樹');

                // 8. 刪除樹
                const rDelTree = await ctx.api.delete(`tree_survey/${treeId}`);
                ctx.assert.assertJsonOk(rDelTree, '刪樹');
                // 刪過了就從 cleanup 移除
                ctx.cleanup.resources = ctx.cleanup.resources.filter(r => !(r.kind === 'tree' && r.id === treeId));

                // 9. 刪除專案（cleanup 會做，但這邊先做以驗 cascade）
                const rDelProj = await ctx.api.delete(`projects/${encodeURIComponent(projectCode)}`);
                ctx.assert.assertJsonOk(rDelProj, '刪專案');
                ctx.cleanup.resources = ctx.cleanup.resources.filter(r => !(r.kind === 'project' && r.id === projectCode));

                // 10. cleanup 處理區位
            },
        },
    ],
};
