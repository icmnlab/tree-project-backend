/**
 * county.js — 縣市判斷統一入口（Stage 1 commit 1）
 *
 * 之前散落在 routes/project_areas.js / routes/projects.js / 前端 map_page.dart
 * 與 project_areas_page.dart 各自實作了「座標 → 縣市」「區位名稱 → 縣市」邏輯，
 * 規則互相不一致 (例：「布袋港」前端硬編碼到嘉義縣，後端純走座標可能落到台南)。
 *
 * 本檔為唯一真相來源：
 *   1. 座標可用時 → 走 utils/geo.js (內政部 1140318 官方界線 + turf point-in-polygon)
 *   2. 座標不可用且 areaName 提供 → 走 KNOWN_AREA_TO_COUNTY 表 + cityKeywords 後備
 *   3. 都判不出來 → null
 *
 * 對外 API:
 *   resolveAreaCity({ lng, lat, areaName }) → string | null
 *     回傳官方 COUNTYNAME (含「市/縣」尾綴) 或 null
 *   normalizeCityCandidates(input)          → string[]
 *     將「花蓮」/「花蓮縣」/「花蓮市」標準化為 ['花蓮市','花蓮縣'] 或 ['花蓮縣']
 *   matchCity(target, candidate)            → boolean
 *     判斷某 areaName/座標解析出的縣市是否命中候選。
 */

const { resolveCountyByLngLat } = require('./geo');

// 11 個港口/植栽區位的權威對應（這幾處座標可能模糊或介於兩縣市邊界）。
// 來源：歷史前端 map_page.dart 的 knownAreaToCity，已經過 5 個 session 業務驗證。
const KNOWN_AREA_TO_COUNTY = Object.freeze({
    '基隆港': '基隆市',
    '臺北港': '新北市',
    '台北港': '新北市',
    '臺中港': '台中市',
    '台中港': '台中市',
    '安平港': '台南市',
    '布袋港': '嘉義縣',
    '高雄港': '高雄市',
    '蘇澳港': '宜蘭縣',
    '花蓮港': '花蓮縣',
    '澎湖港': '澎湖縣',
});

// 縣市關鍵字（從前端 map_page.dart cityKeywords 移過來，去除冗餘）
const CITY_KEYWORDS = Object.freeze({
    '台北市': ['台北', '臺北', '北市'],
    '新北市': ['新北'],
    '桃園市': ['桃園'],
    '台中市': ['台中', '臺中', '中市'],
    '台南市': ['台南', '臺南', '南市'],
    '高雄市': ['高雄', '高市'],
    '基隆市': ['基隆'],
    '新竹市': ['新竹市', '竹市'],
    '新竹縣': ['新竹縣', '竹縣'],
    '苗栗縣': ['苗栗'],
    '彰化縣': ['彰化'],
    '南投縣': ['南投'],
    '雲林縣': ['雲林'],
    '嘉義市': ['嘉義市', '嘉市'],
    '嘉義縣': ['嘉義縣', '嘉縣'],
    '屏東縣': ['屏東'],
    '宜蘭縣': ['宜蘭', '蘭陽', '羅東', '冬山', '礁溪'],
    '花蓮縣': ['花蓮'],
    '台東縣': ['台東', '臺東'],
    '澎湖縣': ['澎湖'],
    '金門縣': ['金門'],
    '連江縣': ['連江', '馬祖'],
});

/**
 * 從區位名稱推斷縣市（fallback，僅在無座標時使用）。
 * @param {string} areaName
 * @returns {string|null}
 */
function _resolveByAreaName(areaName) {
    if (!areaName || typeof areaName !== 'string') return null;
    // 1. 港口權威表
    for (const key of Object.keys(KNOWN_AREA_TO_COUNTY)) {
        if (areaName.includes(key)) return KNOWN_AREA_TO_COUNTY[key];
    }
    // 2. 縣市關鍵字
    for (const county of Object.keys(CITY_KEYWORDS)) {
        for (const kw of CITY_KEYWORDS[county]) {
            if (areaName.includes(kw)) return county;
        }
    }
    return null;
}

/**
 * 給定區位的座標 + 名稱，回傳官方 COUNTYNAME (含尾綴) 或 null。
 *
 * 優先級：座標 > 港口權威表 > 縣市關鍵字。
 * 座標解析需 lng/lat 都是有限數字，否則退回名稱解析。
 *
 * @param {{lng?: number, lat?: number, areaName?: string}} input
 * @returns {string|null}
 */
function resolveAreaCity({ lng, lat, areaName } = {}) {
    const lngN = Number(lng);
    const latN = Number(lat);
    if (Number.isFinite(lngN) && Number.isFinite(latN) && lngN !== 0 && latN !== 0) {
        const detected = resolveCountyByLngLat(lngN, latN);
        if (detected && detected.name) return detected.name;
    }
    return _resolveByAreaName(areaName);
}

/**
 * 將輸入縣市標準化為候選清單（處理使用者打「花蓮」沒帶尾綴的情況）。
 * @param {string} input
 * @returns {string[]}
 */
function normalizeCityCandidates(input) {
    if (!input || typeof input !== 'string') return [];
    if (input.endsWith('市') || input.endsWith('縣')) return [input];
    return [`${input}市`, `${input}縣`];
}

/**
 * 判斷 detected 縣市是否命中 candidate (使用者輸入)。
 * @param {string|null} detected   resolveAreaCity 的結果
 * @param {string} candidate       使用者輸入的縣市（可不含尾綴）
 * @returns {boolean}
 */
function matchCity(detected, candidate) {
    if (!detected || !candidate) return false;
    return normalizeCityCandidates(candidate).includes(detected);
}

module.exports = {
    resolveAreaCity,
    normalizeCityCandidates,
    matchCity,
    // exposed for testing
    KNOWN_AREA_TO_COUNTY,
    CITY_KEYWORDS,
};
