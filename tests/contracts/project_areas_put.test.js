/**
 * contracts/project_areas_put.test.js — PUT /project_areas/:id 契約
 *
 * 驗證 Stage 2 commit 11：PUT 接受 xCoord/yCoord 重算 city，與 POST 行為一致。
 */
'use strict';

const assert = require('assert');

module.exports = {
    section: 'contracts',
    cases: [
        {
            name: 'PUT /project_areas/:id 帶 xCoord/yCoord → city 由座標重算 (花蓮 → 花蓮縣)',
            run: async (ctx) => {
                await ctx.api.login('admin');

                // 先建一個 city=台中市 的區位
                const area = ctx.factories.buildArea({
                    xCoord: 120.5318,
                    yCoord: 24.2879,
                    isSubmit: true,
                });
                const rPost = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rPost);
                const id = rPost.body.data.id;
                ctx.cleanup.track('area', id);
                assert.strictEqual(rPost.body.data.city, '台中市', 'POST 應 resolve 為台中市');

                // PUT 換到花蓮座標 (xCoord=121.5436, yCoord=23.9871) → 應變花蓮縣
                const rPut = await ctx.api.put(`project_areas/${id}`, {
                    area_name: area.area_name,
                    area_code: rPost.body.data.area_code,
                    description: 'updated',
                    xCoord: 121.5436,
                    yCoord: 23.9871,
                });
                ctx.assert.assertJsonOk(rPut);
                assert.strictEqual(rPut.body.data.city, '花蓮縣', 'PUT 帶座標應重算為花蓮縣');

                // 再讀回確認 DB 真的寫進去
                if (ctx.db.isAvailable()) {
                    const r = await ctx.db.query('SELECT city FROM project_areas WHERE id = $1', [id]);
                    assert.strictEqual(r.rows[0].city, '花蓮縣', 'DB city 已更新');
                }
            },
        },
        {
            name: 'PUT /project_areas/:id 不帶座標 → city 保留原值',
            run: async (ctx) => {
                await ctx.api.login('admin');

                const area = ctx.factories.buildArea({
                    xCoord: 120.1666,
                    yCoord: 23.3778,
                    isSubmit: true,
                });
                const rPost = await ctx.api.post('project_areas', area);
                ctx.assert.assertJsonOk(rPost);
                const id = rPost.body.data.id;
                ctx.cleanup.track('area', id);
                assert.strictEqual(rPost.body.data.city, '嘉義縣');

                const rPut = await ctx.api.put(`project_areas/${id}`, {
                    area_name: area.area_name + '_v2',
                    area_code: rPost.body.data.area_code,
                    description: 'no coords',
                });
                ctx.assert.assertJsonOk(rPut);
                assert.strictEqual(rPut.body.data.city, '嘉義縣', '不帶座標應保留原 city');
            },
        },
    ],
};
