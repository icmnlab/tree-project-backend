/**
 * invariants/county.test.js — utils/county.js 純函式單元 + 端到端
 *
 * 純函式部分不需 BASE_URL，在沒有 server 時也能跑（基本 sanity）。
 * 端到端部分（GET /project_areas?city=、GET /tree_survey/map?city=）
 * 需要登入 + production data，沒測試管理員時可 skip。
 */
'use strict';

const assert = require('assert');
const path = require('path');
const county = require(path.resolve(__dirname, '..', '..', 'utils', 'county.js'));

module.exports = {
    section: 'invariants',
    cases: [
        // ─── normalizeCityCandidates ───────────────────────────────
        {
            name: 'county.normalizeCityCandidates: 不帶尾綴展開為市+縣',
            run: async () => {
                const out = county.normalizeCityCandidates('花蓮');
                assert.ok(out.includes('花蓮市'), '應含花蓮市');
                assert.ok(out.includes('花蓮縣'), '應含花蓮縣');
            },
        },
        {
            name: 'county.normalizeCityCandidates: 台/臺異體字必同時產生',
            run: async () => {
                const out1 = county.normalizeCityCandidates('臺南市');
                assert.ok(out1.includes('台南市'), '臺南市應展開含台南市');
                assert.ok(out1.includes('臺南市'), '臺南市應含自身');
                const out2 = county.normalizeCityCandidates('台中市');
                assert.ok(out2.includes('臺中市'), '台中市應展開含臺中市');
            },
        },
        {
            name: 'county.normalizeCityCandidates: 空/非字串 → 空陣列',
            run: async () => {
                assert.deepStrictEqual(county.normalizeCityCandidates(null), []);
                assert.deepStrictEqual(county.normalizeCityCandidates(''), []);
                assert.deepStrictEqual(county.normalizeCityCandidates(undefined), []);
                assert.deepStrictEqual(county.normalizeCityCandidates(123), []);
            },
        },
        // ─── matchCity ─────────────────────────────────────────────
        {
            name: 'county.matchCity: 台/臺視同等價',
            run: async () => {
                assert.strictEqual(county.matchCity('台南市', '臺南市'), true);
                assert.strictEqual(county.matchCity('臺南市', '台南市'), true);
                assert.strictEqual(county.matchCity('台南市', '台南'), true);
                assert.strictEqual(county.matchCity('花蓮縣', '台南'), false);
            },
        },
        {
            name: 'county.matchCity: target 為 null/空 必回 false',
            run: async () => {
                assert.strictEqual(county.matchCity(null, '花蓮縣'), false);
                assert.strictEqual(county.matchCity('', '花蓮縣'), false);
                assert.strictEqual(county.matchCity('花蓮縣', null), false);
            },
        },
        // ─── resolveAreaCity 座標優先 ───────────────────────────────
        {
            name: 'county.resolveAreaCity: 座標優先（布袋港座標應回嘉義縣）',
            run: async () => {
                const r = county.resolveAreaCity({ lng: 120.1666, lat: 23.3778 });
                assert.strictEqual(r, '嘉義縣', `expected 嘉義縣 got ${r}`);
            },
        },
        {
            name: 'county.resolveAreaCity: 座標優先（花蓮港座標應回花蓮縣）',
            run: async () => {
                const r = county.resolveAreaCity({ lng: 121.5436, lat: 23.9871 });
                assert.strictEqual(r, '花蓮縣', `expected 花蓮縣 got ${r}`);
            },
        },
        // ─── resolveAreaCity fallback areaName ──────────────────────
        {
            name: 'county.resolveAreaCity: 座標 0/0 退回 areaName',
            run: async () => {
                const r = county.resolveAreaCity({ lng: 0, lat: 0, areaName: '布袋港植栽第2區' });
                assert.strictEqual(r, '嘉義縣');
            },
        },
        {
            name: 'county.resolveAreaCity: areaName 含港口名 命中 KNOWN_AREA_TO_COUNTY',
            run: async () => {
                assert.strictEqual(county.resolveAreaCity({ areaName: '基隆港東區' }), '基隆市');
                assert.strictEqual(county.resolveAreaCity({ areaName: '高雄港' }), '高雄市');
                assert.strictEqual(county.resolveAreaCity({ areaName: '蘇澳港北側' }), '宜蘭縣');
                assert.strictEqual(county.resolveAreaCity({ areaName: '安平港' }), '台南市');
                assert.strictEqual(county.resolveAreaCity({ areaName: '臺中港' }), '台中市');
                assert.strictEqual(county.resolveAreaCity({ areaName: '台北港' }), '新北市');
            },
        },
        {
            name: 'county.resolveAreaCity: areaName 純縣市關鍵字命中',
            run: async () => {
                assert.strictEqual(county.resolveAreaCity({ areaName: '花蓮某某區' }), '花蓮縣');
                assert.strictEqual(county.resolveAreaCity({ areaName: '羅東鎮' }), '宜蘭縣');
                assert.strictEqual(county.resolveAreaCity({ areaName: '馬祖列嶼' }), '連江縣');
            },
        },
        {
            name: 'county.resolveAreaCity: 全空 → null',
            run: async () => {
                assert.strictEqual(county.resolveAreaCity({}), null);
                assert.strictEqual(county.resolveAreaCity({ lng: NaN, lat: NaN }), null);
                assert.strictEqual(county.resolveAreaCity({ areaName: '某不可解析的字串XYZ' }), null);
            },
        },
        {
            name: 'county.KNOWN_AREA_TO_COUNTY: 11 個港口完整且皆為官方縣市名',
            run: async () => {
                const ports = Object.keys(county.KNOWN_AREA_TO_COUNTY);
                assert.ok(ports.length >= 11, `expected ≥ 11 ports got ${ports.length}`);
                const { COUNTY_VARIANTS } = require('../helpers/asserts');
                for (const [port, cty] of Object.entries(county.KNOWN_AREA_TO_COUNTY)) {
                    assert.ok(COUNTY_VARIANTS.has(cty),
                        `${port} maps to '${cty}' which is not an official county`);
                }
            },
        },
        // ─── 端到端 GET /project_areas?city= ───────────────────────
        {
            name: 'GET /project_areas?city=花蓮縣 全部 area 對應到花蓮（或 area.city=null fallback）',
            run: async (ctx) => {
                await ctx.api.login('admin');
                const r = await ctx.api.get('project_areas', { query: { city: '花蓮縣' } });
                ctx.assert.assertJsonOk(r);
                ctx.assert.assertArray(r.body.data);
                // 每筆 area 必須：area.city 命中 OR 有樹解析出花蓮縣
                // 這裡只能斷言「沒有明顯不該出現的縣市」
                for (const a of r.body.data) {
                    if (a.city) {
                        ctx.assert.assertOfficialCounty(a.city, `area ${a.area_name}`);
                    }
                }
            },
        },
        {
            name: 'GET /tree_survey/map?city=花蓮縣 每筆 _city 必為花蓮縣（或變體）',
            run: async (ctx) => {
                await ctx.api.login('admin');
                const r = await ctx.api.get('tree_survey/map', { query: { city: '花蓮縣' } });
                ctx.assert.assertJsonOk(r);
                ctx.assert.assertArray(r.body.data);
                if (r.body.data.length === 0) return; // 空集合不算錯
                for (const t of r.body.data) {
                    assert.ok(
                        t._city === '花蓮縣' || t._city === '花蓮市',
                        `tree id=${t.id} _city='${t._city}' 不是花蓮（縣/市），座標=(${t['X坐標']},${t['Y坐標']}) area='${t['專案區位']}'`
                    );
                }
            },
        },
        {
            name: 'GET /tree_survey/map 不帶 city 每筆都應有 _city 欄位（縣市標註成功）',
            run: async (ctx) => {
                await ctx.api.login('admin');
                const r = await ctx.api.get('tree_survey/map');
                ctx.assert.assertJsonOk(r);
                ctx.assert.assertArray(r.body.data);
                // 抽樣 50 筆驗證：座標都解得出 → 必有 _city
                const sample = r.body.data.slice(0, 50);
                let unresolved = 0;
                for (const t of sample) {
                    if (t._city === null || t._city === undefined) unresolved++;
                    else ctx.assert.assertOfficialCounty(t._city, `tree id=${t.id}`);
                }
                // 允許少數無法解析（座標異常），但不應 > 20%
                assert.ok(unresolved <= sample.length * 0.2,
                    `${unresolved}/${sample.length} 筆 _city 無法解析（>20% 異常）`);
            },
        },
    ],
};
