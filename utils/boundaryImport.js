/**
 * boundaryImport.js — 解析使用者匯入的邊界檔案（KML / KMZ / GeoJSON）成統一格式
 *
 * 設計重點：
 * 1. 統一輸出 coordinates = [[lat, lng], ...]（與 project_boundaries 儲存格式一致、開放環、無重複收尾點）。
 * 2. 座標系統：KML 依 OGC 規格固定 WGS84；GeoJSON 讀 `crs` 或以數值範圍啟發判斷；
 *    偵測到 TWD97/TM2（EPSG:3826/3825）等投影座標 → 用 proj4 轉 WGS84。
 * 3. 多個多邊形 / MultiPolygon → 取面積最大者並回傳警告（不靜默吞掉）。
 * 4. 自相交（turf.kinks）以警告回報，交由上層決定是否要求重排。
 *
 * 純解析、不碰資料庫。
 */

const turf = require('@turf/turf');
const proj4 = require('proj4');
const { DOMParser } = require('@xmldom/xmldom');
const JSZip = require('jszip');

const MAX_VERTICES = 2000;

// TWD97 / TM2（台灣本島 lon_0=121；澎金馬 lon_0=119）。proj4 內建 EPSG:4326。
proj4.defs(
    'EPSG:3826',
    '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);
proj4.defs(
    'EPSG:3825',
    '+proj=tmerc +lat_0=0 +lon_0=119 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

/** WGS84 經緯度合理範圍（台灣周邊；亦作通用度數判斷） */
function looksLikeLngLatDegrees(x, y) {
    return Math.abs(x) <= 180 && Math.abs(y) <= 90;
}

/**
 * 把單一外環的原始座標（來源順序 [x, y]）轉成 [[lat, lng], ...]（WGS84、開放環）。
 * @param {Array<[number, number]>} rawRing  來源座標（x=lng/easting, y=lat/northing）
 * @param {string} crs  'EPSG:4326' | 'EPSG:3826' | 'EPSG:3825'
 */
function ringToLatLng(rawRing, crs) {
    const out = [];
    for (const pt of rawRing) {
        const x = Number(pt[0]);
        const y = Number(pt[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        let lng;
        let lat;
        if (crs === 'EPSG:4326') {
            lng = x;
            lat = y;
        } else {
            const [tlng, tlat] = proj4(crs, 'EPSG:4326', [x, y]);
            lng = tlng;
            lat = tlat;
        }
        out.push([lat, lng]);
    }
    // 去除重複收尾點（首尾相同 → 開放環）
    if (out.length >= 2) {
        const a = out[0];
        const b = out[out.length - 1];
        if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) {
            out.pop();
        }
    }
    return out;
}

/** 以 turf 計算開放環（[lat,lng]）面積（平方公尺），供「取最大多邊形」用 */
function ringAreaM2(latLngRing) {
    if (latLngRing.length < 3) return 0;
    const closed = latLngRing.map((c) => [c[1], c[0]]); // → [lng,lat]
    closed.push(closed[0]);
    try {
        return turf.area(turf.polygon([closed]));
    } catch (_) {
        return 0;
    }
}

/** 自相交偵測（輸入開放環 [lat,lng]） */
function isSelfIntersecting(latLngRing) {
    if (latLngRing.length < 4) return false;
    const closed = latLngRing.map((c) => [c[1], c[0]]);
    closed.push(closed[0]);
    try {
        const k = turf.kinks(turf.polygon([closed]));
        return k.features.length > 0;
    } catch (_) {
        return false;
    }
}

// ───────────────────────── GeoJSON ─────────────────────────

/** 從 GeoJSON 的 crs 成員推斷 EPSG（僅支援我們轉換得了的；其餘回 null） */
function crsFromGeoJson(obj) {
    const name = obj && obj.crs && obj.crs.properties && obj.crs.properties.name;
    if (!name || typeof name !== 'string') return null;
    const m = name.match(/(?:EPSG[:]{1,2})(\d{4,5})/i);
    if (!m) return null;
    return `EPSG:${m[1]}`;
}

function collectPolygonRingsFromGeometry(geom, acc) {
    if (!geom || !geom.type) return;
    if (geom.type === 'Polygon') {
        if (Array.isArray(geom.coordinates) && geom.coordinates[0]) {
            acc.push(geom.coordinates[0]); // 外環
        }
    } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates || []) {
            if (poly && poly[0]) acc.push(poly[0]);
        }
    } else if (geom.type === 'GeometryCollection') {
        for (const g of geom.geometries || []) {
            collectPolygonRingsFromGeometry(g, acc);
        }
    }
}

function parseGeoJson(obj) {
    const warnings = [];
    const rawRings = [];

    if (obj.type === 'FeatureCollection') {
        for (const f of obj.features || []) {
            collectPolygonRingsFromGeometry(f && f.geometry, rawRings);
        }
    } else if (obj.type === 'Feature') {
        collectPolygonRingsFromGeometry(obj.geometry, rawRings);
    } else {
        collectPolygonRingsFromGeometry(obj, rawRings);
    }

    if (rawRings.length === 0) {
        return { ok: false, code: 'NO_POLYGON', message: 'GeoJSON 中找不到多邊形（Polygon/MultiPolygon）' };
    }

    // 決定 CRS
    let crs = crsFromGeoJson(obj);
    let detectedCrs;
    if (crs === 'EPSG:4326' || !crs) {
        // 無 crs 成員：以座標範圍啟發判斷（GeoJSON 規格本應為 WGS84，但台灣資料常見投影座標）
        const sample = rawRings[0][0] || [];
        if (!looksLikeLngLatDegrees(Number(sample[0]), Number(sample[1]))) {
            crs = 'EPSG:3826';
            detectedCrs = 'EPSG:3826 (依數值範圍推斷投影座標)';
            warnings.push('GeoJSON 未標示座標系統，依數值判斷為 TWD97/TM2(EPSG:3826) 並已轉換為 WGS84；若有誤請改用標準 WGS84 檔。');
        } else {
            crs = 'EPSG:4326';
            detectedCrs = 'EPSG:4326 (WGS84)';
        }
    } else if (crs === 'EPSG:3826' || crs === 'EPSG:3825') {
        detectedCrs = `${crs} (TWD97/TM2) → WGS84`;
    } else {
        return { ok: false, code: 'UNSUPPORTED_CRS', message: `不支援的座標系統 ${crs}；請改用 WGS84 或 TWD97/TM2(EPSG:3826) 匯出。` };
    }

    if (rawRings.length > 1) {
        warnings.push(`檔案含 ${rawRings.length} 個多邊形，已自動取面積最大者；其餘忽略。`);
    }

    return finalizeRings(rawRings, crs, 'geojson', detectedCrs, warnings);
}

// ───────────────────────── KML / KMZ ─────────────────────────

/** 解析 KML <coordinates> 文字 → [[lng,lat], ...] */
function parseKmlCoordinateText(text) {
    const ring = [];
    const tuples = String(text).trim().split(/\s+/);
    for (const t of tuples) {
        if (!t) continue;
        const parts = t.split(',');
        if (parts.length < 2) continue;
        const lng = Number(parts[0]);
        const lat = Number(parts[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) ring.push([lng, lat]);
    }
    return ring;
}

function parseKmlString(kml) {
    const warnings = [];
    let doc;
    try {
        // @xmldom/xmldom 0.9：用 onError 靜音非致命警告；致命錯誤才丟出
        doc = new DOMParser({ onError: () => {} }).parseFromString(kml, 'text/xml');
    } catch (e) {
        return { ok: false, code: 'PARSE_ERROR', message: `KML 解析失敗：${e.message}` };
    }

    // 取所有 Polygon 的外環 coordinates
    const polygons = doc.getElementsByTagName('Polygon');
    const rawRings = [];
    for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i];
        const outer = poly.getElementsByTagName('outerBoundaryIs')[0] || poly;
        const coordsEl = outer.getElementsByTagName('coordinates')[0];
        if (!coordsEl) continue;
        const ring = parseKmlCoordinateText(coordsEl.textContent || '');
        if (ring.length >= 3) rawRings.push(ring);
    }

    if (rawRings.length === 0) {
        return { ok: false, code: 'NO_POLYGON', message: 'KML 中找不到多邊形（Polygon）' };
    }
    if (rawRings.length > 1) {
        warnings.push(`KML 含 ${rawRings.length} 個多邊形，已自動取面積最大者；其餘忽略。`);
    }

    // KML 依 OGC 規格固定 WGS84
    return finalizeRings(rawRings, 'EPSG:4326', 'kml', 'EPSG:4326 (WGS84, KML 規格)', warnings);
}

async function parseKmz(buffer) {
    let zip;
    try {
        zip = await JSZip.loadAsync(buffer);
    } catch (e) {
        return { ok: false, code: 'PARSE_ERROR', message: `KMZ 解壓失敗：${e.message}` };
    }
    // 優先 doc.kml，否則第一個 .kml
    let entry =
        zip.file('doc.kml') ||
        zip.file(/\.kml$/i)[0];
    if (!entry) {
        return { ok: false, code: 'NO_KML', message: 'KMZ 內找不到 .kml 檔' };
    }
    const kml = await entry.async('text');
    return parseKmlString(kml);
}

// ───────────────────────── 共用收尾 ─────────────────────────

function finalizeRings(rawRings, crs, format, detectedCrs, warnings) {
    // 轉成 [lat,lng] 並取面積最大者
    let best = null;
    let bestArea = -1;
    for (const raw of rawRings) {
        const latLng = ringToLatLng(raw, crs);
        if (latLng.length < 3) continue;
        const area = ringAreaM2(latLng);
        if (area > bestArea) {
            bestArea = area;
            best = latLng;
        }
    }

    if (!best || best.length < 3) {
        return { ok: false, code: 'INVALID_POLYGON', message: '多邊形頂點不足（至少 3 點）或座標無效' };
    }
    if (best.length > MAX_VERTICES) {
        return {
            ok: false,
            code: 'TOO_MANY_VERTICES',
            message: `頂點數 ${best.length} 超過上限 ${MAX_VERTICES}，請簡化邊界後再匯入。`,
        };
    }

    const finalWarnings = [...warnings];
    const selfIntersecting = isSelfIntersecting(best);
    if (selfIntersecting) {
        finalWarnings.push('偵測到邊界線自相交，地圖上可能出現非預期範圍，建議重新整理頂點順序。');
    }

    return {
        ok: true,
        coordinates: best,
        format,
        detectedCrs,
        stats: {
            vertexCount: best.length,
            areaHa: bestArea / 10000,
            polygonCount: rawRings.length,
            selfIntersecting,
        },
        warnings: finalWarnings,
    };
}

/**
 * 依副檔名分派解析。
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<{ok:boolean, code?:string, message?:string, coordinates?:number[][], format?:string, detectedCrs?:string, stats?:object, warnings?:string[]}>}
 */
async function parseBoundaryFile(buffer, filename) {
    const name = String(filename || '').toLowerCase();
    try {
        if (name.endsWith('.kmz')) {
            return await parseKmz(buffer);
        }
        if (name.endsWith('.kml')) {
            return parseKmlString(buffer.toString('utf8'));
        }
        if (name.endsWith('.geojson') || name.endsWith('.json')) {
            let obj;
            try {
                obj = JSON.parse(buffer.toString('utf8'));
            } catch (e) {
                return { ok: false, code: 'PARSE_ERROR', message: `GeoJSON 解析失敗：${e.message}` };
            }
            return parseGeoJson(obj);
        }
        return { ok: false, code: 'UNSUPPORTED_FORMAT', message: '不支援的檔案格式，請使用 .kml / .kmz / .geojson' };
    } catch (e) {
        return { ok: false, code: 'PARSE_ERROR', message: `解析失敗：${e.message}` };
    }
}

module.exports = {
    parseBoundaryFile,
    parseGeoJson,
    parseKmlString,
    parseKmz,
    ringToLatLng,
    isSelfIntersecting,
    MAX_VERTICES,
};
