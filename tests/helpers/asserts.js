/**
 * helpers/asserts.js — 領域斷言
 *
 * 標準 node:assert 的領域擴充。失敗時拋 AssertionError 含上下文。
 */
'use strict';

const assert = require('assert');

// 內政部 1140318 官方界線 22 縣市
const OFFICIAL_COUNTIES = Object.freeze([
    '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
    '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
    '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
    '台東縣', '澎湖縣', '金門縣', '連江縣',
]);
// 包含臺/台異體變體
const COUNTY_VARIANTS = Object.freeze(new Set([
    ...OFFICIAL_COUNTIES,
    ...OFFICIAL_COUNTIES.map(c => c.replace(/台/g, '臺')),
]));

function assertStatus(res, expected, msg = '') {
    const actual = res && res.statusCode;
    if (Array.isArray(expected)) {
        assert.ok(expected.includes(actual),
            `${msg} expected status in [${expected.join(',')}] got ${actual} body=${JSON.stringify(res && res.body).slice(0, 200)}`);
    } else {
        assert.strictEqual(actual, expected,
            `${msg} expected status ${expected} got ${actual} body=${JSON.stringify(res && res.body).slice(0, 200)}`);
    }
}

function assertJsonOk(res, msg = '') {
    assertStatus(res, [200, 201], msg);
    assert.ok(res.body && typeof res.body === 'object',
        `${msg} body should be JSON object, got ${typeof res.body}`);
    if (res.body.success !== undefined) {
        assert.strictEqual(res.body.success, true,
            `${msg} expected success=true, got ${JSON.stringify(res.body).slice(0, 200)}`);
    }
}

function assertField(obj, path, predicate, msg = '') {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) break;
        cur = cur[p];
    }
    if (typeof predicate === 'function') {
        assert.ok(predicate(cur), `${msg} field ${path} predicate failed (value=${JSON.stringify(cur).slice(0, 100)})`);
    } else {
        assert.deepStrictEqual(cur, predicate, `${msg} field ${path} expected ${JSON.stringify(predicate)} got ${JSON.stringify(cur)}`);
    }
}

function assertOfficialCounty(name, msg = '') {
    assert.ok(COUNTY_VARIANTS.has(name),
        `${msg} '${name}' is not an official county name (含台/臺變體, 22 縣市)`);
}

function assertArray(val, msg = '') {
    assert.ok(Array.isArray(val), `${msg} expected array, got ${typeof val}`);
}

module.exports = {
    assertStatus,
    assertJsonOk,
    assertField,
    assertOfficialCounty,
    assertArray,
    OFFICIAL_COUNTIES,
    COUNTY_VARIANTS,
};
