/**
 * invariants/triggers.test.js — Stage 2 commit 8 BEFORE trigger 同步驗證
 *
 * 驗證 sync_tree_survey_project_id() 擴充版本：呼叫端傳的 cache 欄位
 * (project_name, project_location, species_name) 應被 canonical tables
 * 強制覆蓋為一致的值。
 *
 * 後續 commit (9 projects cascade, 10 species cascade, 11 PUT pa city)
 * 的測試會接著加進這支檔。
 */
'use strict';

const assert = require('assert');

module.exports = {
    section: 'invariants',
    cases: [
        {
            name: 'BEFORE trigger: INSERT 傳錯 project_name → 被 canonical 覆蓋',
            run: async (ctx) => {
                await ctx.api.login('admin');

                // 建區位 + 專案 (canonical name = projBody.name)
                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea);
                ctx.cleanup.track('area', rArea.body.data.id);

                const projBody = ctx.factories.buildProject({ area: area.area_name });
                const rProj = await ctx.api.post('projects/add', { name: projBody.name, area: projBody.area });
                ctx.assert.assertJsonOk(rProj);
                const code = rProj.body.project.code;
                ctx.cleanup.track('project', code);

                // 故意傳錯的 project_name / project_location，預期 trigger 覆蓋
                const tree = ctx.factories.buildTree({
                    project_code: code,
                    project_name: 'WRONG_NAME_FROM_CLIENT',
                    project_area: 'WRONG_AREA_FROM_CLIENT',
                });
                const rTree = await ctx.api.post('tree_survey/create_v2', tree);
                ctx.assert.assertJsonOk(rTree, 'create tree');
                const treeId = rTree.body.data?.id || rTree.body.id;

                const rGet = await ctx.api.get(`tree_survey/by_id/${treeId}`);
                ctx.assert.assertJsonOk(rGet);
                const row = rGet.body.data;

                // 經 trigger 覆蓋後應為 canonical 值
                assert.strictEqual(row['專案名稱'], projBody.name, 'project_name should be canonical');
                assert.strictEqual(row['專案區位'], area.area_name, 'project_location should be canonical');
            },
        },
        {
            name: 'BEFORE trigger: INSERT 不傳 species_id 但傳 species_name → 保留 caller 值 (degraded mode)',
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
                ctx.cleanup.track('project', code);

                const uniqueSpeciesName = `_未登錄樹種_${ctx.config.TEST_ID}`;
                const tree = ctx.factories.buildTree({
                    project_code: code,
                    project_name: projBody.name,
                    project_area: area.area_name,
                    species_id: '無',  // 對不到 tree_species
                    species_name: uniqueSpeciesName,
                });
                const rTree = await ctx.api.post('tree_survey/create_v2', tree);
                ctx.assert.assertJsonOk(rTree);
                const treeId = rTree.body.data?.id || rTree.body.id;

                const rGet = await ctx.api.get(`tree_survey/by_id/${treeId}`);
                ctx.assert.assertJsonOk(rGet);
                // 對不到 species_id 時應保留 caller 傳的 species_name
                assert.strictEqual(rGet.body.data['樹種名稱'], uniqueSpeciesName,
                    'species_name preserved when species_id not found');
            },
        },
        {
            name: 'BEFORE trigger: 直連 DB INSERT 帶錯 project_code → cache 仍以 projects 為準',
            run: async (ctx) => {
                if (!ctx.db.isAvailable()) {
                    throw new Error('SKIP: TEST_DB_URL not set');
                }
                await ctx.api.login('admin');

                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea);
                ctx.cleanup.track('area', rArea.body.data.id);

                const projBody = ctx.factories.buildProject({ area: area.area_name });
                const rProj = await ctx.api.post('projects/add', { name: projBody.name, area: projBody.area });
                ctx.assert.assertJsonOk(rProj);
                const code = rProj.body.project.code;
                ctx.cleanup.track('project', code);

                // 直接 INSERT 跳過 controller 防護，驗證 trigger 仍生效
                const ins = await ctx.db.query(`
                    INSERT INTO tree_survey
                      (project_location, project_code, project_name,
                       system_tree_id, project_tree_id, species_id, species_name,
                       x_coord, y_coord, status, notes, tree_notes,
                       tree_height_m, dbh_cm, survey_notes, survey_time)
                    VALUES ('BAD_LOC', $1, 'BAD_NAME',
                            'ST-TRGTEST-' || $2, 'PT-TRGTEST-' || $2, '無', '測試樹種',
                            121.51, 23.86, '良好', '無', '無',
                            10.0, 25.0, 'trigger_test', NOW())
                    RETURNING id, project_name, project_location, project_id
                `, [code, Date.now()]);

                const row = ins.rows[0];
                ctx.cleanup.track('tree', row.id);

                assert.strictEqual(row.project_name, projBody.name,
                    'trigger overrode bogus project_name');
                assert.strictEqual(row.project_location, area.area_name,
                    'trigger filled project_location from project_areas');
                if (!row.project_id) throw new Error('project_id should be linked');
            },
        },
        {
            name: 'BEFORE trigger: UPDATE 改 project_code → cache 重新從新 project 拉',
            run: async (ctx) => {
                if (!ctx.db.isAvailable()) {
                    throw new Error('SKIP: TEST_DB_URL not set');
                }
                await ctx.api.login('admin');

                // 建兩個專案 A / B
                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea);
                ctx.cleanup.track('area', rArea.body.data.id);

                const projA = ctx.factories.buildProject({ area: area.area_name });
                const rA = await ctx.api.post('projects/add', { name: projA.name, area: projA.area });
                ctx.assert.assertJsonOk(rA);
                ctx.cleanup.track('project', rA.body.project.code);

                const projB = ctx.factories.buildProject({ area: area.area_name });
                const rB = await ctx.api.post('projects/add', { name: projB.name, area: projB.area });
                ctx.assert.assertJsonOk(rB);
                ctx.cleanup.track('project', rB.body.project.code);

                // 在 A 建一棵樹 (走 API 確保所有預設 ID 都填好)
                const tree = ctx.factories.buildTree({
                    project_code: rA.body.project.code,
                    project_name: projA.name,
                    project_area: area.area_name,
                });
                const rTree = await ctx.api.post('tree_survey/create_v2', tree);
                ctx.assert.assertJsonOk(rTree);
                const treeId = rTree.body.data?.id || rTree.body.id;
                ctx.cleanup.track('tree', treeId);

                // 直連 DB UPDATE project_code = B 的 code → trigger 應重新拉 cache
                await ctx.db.query(
                    `UPDATE tree_survey SET project_code = $1 WHERE id = $2`,
                    [rB.body.project.code, treeId]
                );

                const after = await ctx.db.query(
                    `SELECT project_code, project_name, project_id FROM tree_survey WHERE id = $1`,
                    [treeId]
                );
                const row = after.rows[0];
                assert.strictEqual(row.project_code, rB.body.project.code, 'project_code switched');
                assert.strictEqual(row.project_name, projB.name, 'project_name re-pulled from B');
            },
        },
        {
            name: 'AFTER cascade: UPDATE projects.name → tree_survey.project_name 同步',
            run: async (ctx) => {
                if (!ctx.db.isAvailable()) {
                    throw new Error('SKIP: TEST_DB_URL not set');
                }
                await ctx.api.login('admin');

                const area = ctx.factories.buildArea();
                const rArea = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rArea);
                ctx.cleanup.track('area', rArea.body.data.id);

                const projBody = ctx.factories.buildProject({ area: area.area_name });
                const rProj = await ctx.api.post('projects/add', { name: projBody.name, area: projBody.area });
                ctx.assert.assertJsonOk(rProj);
                const code = rProj.body.project.code;
                ctx.cleanup.track('project', code);

                const tree = ctx.factories.buildTree({
                    project_code: code,
                    project_name: projBody.name,
                    project_area: area.area_name,
                });
                const rTree = await ctx.api.post('tree_survey/create_v2', tree);
                ctx.assert.assertJsonOk(rTree);
                const treeId = rTree.body.data?.id || rTree.body.id;
                ctx.cleanup.track('tree', treeId);

                // 直連 DB rename projects (尚無 PUT API)
                const newName = projBody.name + '_renamed';
                await ctx.db.query(
                    `UPDATE projects SET name = $1 WHERE project_code = $2`,
                    [newName, code]
                );

                const after = await ctx.db.query(
                    `SELECT project_name FROM tree_survey WHERE id = $1`, [treeId]
                );
                assert.strictEqual(after.rows[0].project_name, newName,
                    'tree_survey.project_name should follow projects.name');
            },
        },
        {
            name: 'AFTER cascade: UPDATE projects.area_id → tree_survey.project_location 同步',
            run: async (ctx) => {
                if (!ctx.db.isAvailable()) {
                    throw new Error('SKIP: TEST_DB_URL not set');
                }
                await ctx.api.login('admin');

                // 建兩個區位 A1 / A2
                const a1 = ctx.factories.buildArea();
                const rA1 = await ctx.api.post('project_areas', a1);
                ctx.assert.assertJsonOk(rA1);
                ctx.cleanup.track('area', rA1.body.data.id);

                const a2 = ctx.factories.buildArea();
                const rA2 = await ctx.api.post('project_areas', a2);
                ctx.assert.assertJsonOk(rA2);
                ctx.cleanup.track('area', rA2.body.data.id);

                const projBody = ctx.factories.buildProject({ area: a1.area_name });
                const rProj = await ctx.api.post('projects/add', { name: projBody.name, area: a1.area_name });
                ctx.assert.assertJsonOk(rProj);
                const code = rProj.body.project.code;
                ctx.cleanup.track('project', code);

                const tree = ctx.factories.buildTree({
                    project_code: code,
                    project_name: projBody.name,
                    project_area: a1.area_name,
                });
                const rTree = await ctx.api.post('tree_survey/create_v2', tree);
                ctx.assert.assertJsonOk(rTree);
                const treeId = rTree.body.data?.id || rTree.body.id;
                ctx.cleanup.track('tree', treeId);

                // 改 projects.area_id → A2
                await ctx.db.query(
                    `UPDATE projects SET area_id = $1 WHERE project_code = $2`,
                    [rA2.body.data.id, code]
                );

                const after = await ctx.db.query(
                    `SELECT project_location FROM tree_survey WHERE id = $1`, [treeId]
                );
                assert.strictEqual(after.rows[0].project_location, a2.area_name,
                    'tree_survey.project_location should follow new area');
            },
        },
    ],
};
