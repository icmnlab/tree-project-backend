/**
 * helpers/factories.js — 測試資料 factory
 *
 * 全部資料用 TEST_ID 前綴，避免污染 production：
 *   區位名稱：「測試區_{TEST_ID}_{n}」
 *   專案名稱：「測試專案_{TEST_ID}_{n}」
 * 座標預設用花蓮縣中心（壽豐附近），需要其他縣市時呼叫端覆寫。
 */
'use strict';

const { TEST_ID } = require('../config');

let serial = 0;
function nextN() { return ++serial; }

function buildArea(overrides = {}) {
    const n = nextN();
    return {
        area_name: `測試區_${TEST_ID}_${n}`,
        description: '自動化測試',
        // 預設不送座標，讓後端 city = null
        ...overrides,
    };
}

function buildProject(overrides = {}) {
    const n = nextN();
    return {
        name: `測試專案_${TEST_ID}_${n}`,
        area: overrides.area || `測試區_${TEST_ID}_${n}`,
        ...overrides,
    };
}

/**
 * tree_survey/create_v2 body
 * 注意：實際必填欄位較少，但前端通常都送這些。
 * 預設座標：花蓮縣壽豐鄉一帶 (121.51, 23.86)
 */
function buildTree(overrides = {}) {
    const n = nextN();
    return {
        project_area: `測試區_${TEST_ID}_${n}`,
        project_code: overrides.project_code,  // 必填，呼叫端要傳
        project_name: overrides.project_name || `測試專案_${TEST_ID}_${n}`,
        species_name: '測試樹種',
        x_coord: 121.51,
        y_coord: 23.86,
        tree_height_m: 10.0,
        dbh_cm: 25.0,
        status: '良好',
        survey_notes: `自動化測試_${TEST_ID}`,
        survey_time: new Date().toISOString(),
        ...overrides,
    };
}

function buildUser(overrides = {}) {
    const n = nextN();
    return {
        username: `tu_${TEST_ID}_${n}`,
        password: 'TestPass123!',
        display_name: `測試使用者_${n}`,
        role: '一般使用者',
        is_active: true,
        ...overrides,
    };
}

// 已知縣市的座標樣本（用於 county 測試）
const COUNTY_SAMPLES = Object.freeze({
    '花蓮縣': { lng: 121.5436, lat: 23.9871, area: '花蓮港' },
    '嘉義縣': { lng: 120.1666, lat: 23.3778, area: '布袋港' },
    '台南市': { lng: 120.1606, lat: 22.9982, area: '安平港' },
    '高雄市': { lng: 120.3050, lat: 22.6190, area: '高雄港' },
    '基隆市': { lng: 121.7466, lat: 25.1326, area: '基隆港' },
    '台中市': { lng: 120.5318, lat: 24.2879, area: '台中港' },
    '宜蘭縣': { lng: 121.8430, lat: 24.5942, area: '蘇澳港' },
    '澎湖縣': { lng: 119.5660, lat: 23.5713, area: '澎湖港' },
});

module.exports = {
    buildArea,
    buildProject,
    buildTree,
    buildUser,
    COUNTY_SAMPLES,
};
