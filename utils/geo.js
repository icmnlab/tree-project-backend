/**
 * geo.js — 行政區歸屬判斷工具
 *
 * 使用內政部官方縣市界線 (TWD97 經緯度, 1140318 版) 進行 point-in-polygon 判斷。
 * 來源: data/tw_county.geojson
 *
 * 對外 API:
 *   resolveCounty({ lng, lat })       → { name, code, id, eng } | null
 *   resolveCountyByLngLat(lng, lat)   → 同上
 */

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const GEOJSON_PATH = path.join(__dirname, '..', 'data', 'tw_county.geojson');

let _features = null;          // [{ feature, bbox, props }]
let _loadError = null;

function _load() {
    if (_features || _loadError) return;
    try {
        const raw = fs.readFileSync(GEOJSON_PATH, 'utf8');
        const fc = JSON.parse(raw);
        if (!fc || !Array.isArray(fc.features)) {
            throw new Error('tw_county.geojson 格式不正確 (缺 features)');
        }
        _features = fc.features.map((f) => ({
            feature: f,
            bbox: turf.bbox(f),  // [minLng, minLat, maxLng, maxLat] 加速過濾
            props: f.properties || {},
        }));
        console.log(`[geo] 已載入 ${_features.length} 個縣市多邊形`);
    } catch (err) {
        _loadError = err;
        console.error('[geo] 載入 tw_county.geojson 失敗:', err.message);
    }
}

function _isValidLngLat(lng, lat) {
    return (
        typeof lng === 'number' && typeof lat === 'number' &&
        Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= 118 && lng <= 123 &&   // 台灣含離島經度範圍
        lat >= 21 && lat <= 26.5      // 台灣含離島緯度範圍
    );
}

/**
 * 給定經緯度，回傳所在縣市資訊。
 * @param {number} lng
 * @param {number} lat
 * @returns {{name: string, code: string, id: string, eng: string} | null}
 */
function resolveCountyByLngLat(lng, lat) {
    _load();
    if (_loadError || !_features) return null;
    if (!_isValidLngLat(lng, lat)) return null;

    const point = turf.point([lng, lat]);

    for (const item of _features) {
        const [minLng, minLat, maxLng, maxLat] = item.bbox;
        if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
        if (turf.booleanPointInPolygon(point, item.feature)) {
            const p = item.props;
            return {
                name: p.COUNTYNAME || null,
                code: p.COUNTYCODE || null,
                id: p.COUNTYID || null,
                eng: p.COUNTYENG || null,
            };
        }
    }
    return null;
}

function resolveCounty(input) {
    if (!input) return null;
    const lng = input.lng ?? input.longitude ?? input.x ?? input.x_coord;
    const lat = input.lat ?? input.latitude ?? input.y ?? input.y_coord;
    return resolveCountyByLngLat(Number(lng), Number(lat));
}

module.exports = {
    resolveCounty,
    resolveCountyByLngLat,
};
