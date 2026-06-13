/**
 * invariants/boundaryImport.test.js — 邊界檔案解析（KML/KMZ/GeoJSON）純邏輯，免 DB
 *
 * 涵蓋：
 * - GeoJSON (WGS84) 正常解析、輸出 [lat,lng] 開放環
 * - GeoJSON (TWD97/EPSG:3826) 依數值推斷並轉回 WGS84
 * - GeoJSON 標示 crs=EPSG:3826 → 轉換
 * - KML 解析（WGS84）
 * - 多個多邊形 → 取面積最大 + 警告
 * - 自相交偵測
 * - 找不到多邊形 / 格式不支援 → 錯誤碼
 */
'use strict';

const assert = require('assert');
const path = require('path');
const proj4 = require('proj4');
const {
    parseBoundaryFile,
    isSelfIntersecting,
} = require(path.resolve(__dirname, '..', '..', 'utils', 'boundaryImport.js'));

proj4.defs(
    'EPSG:3826',
    '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

// 一個位於台南附近的小四邊形（WGS84，lng,lat）
const WGS_RING = [
    [120.12229, 23.26371],
    [120.12330, 23.26385],
    [120.12426, 23.25842],
    [120.12195, 23.25837],
    [120.12229, 23.26371],
];

function geojsonFeature(ring) {
    return JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
    });
}

module.exports = {
    section: 'invariants',
    cases: [
        {
            name: 'boundaryImport: GeoJSON(WGS84) 解析輸出 [lat,lng] 開放環',
            run: async () => {
                const r = await parseBoundaryFile(Buffer.from(geojsonFeature(WGS_RING)), 'a.geojson');
                assert.strictEqual(r.ok, true);
                assert.strictEqual(r.format, 'geojson');
                // 收尾重複點被移除：4 個唯一頂點
                assert.strictEqual(r.coordinates.length, 4);
                const [lat, lng] = r.coordinates[0];
                assert.ok(Math.abs(lat - 23.26371) < 1e-4, `lat=${lat}`);
                assert.ok(Math.abs(lng - 120.12229) < 1e-4, `lng=${lng}`);
            },
        },
        {
            name: 'boundaryImport: GeoJSON(TWD97 數值) 依範圍推斷並轉 WGS84',
            run: async () => {
                const projRing = WGS_RING.map(([lng, lat]) => proj4('EPSG:4326', 'EPSG:3826', [lng, lat]));
                const r = await parseBoundaryFile(Buffer.from(geojsonFeature(projRing)), 'p.geojson');
                assert.strictEqual(r.ok, true);
                const [lat, lng] = r.coordinates[0];
                assert.ok(Math.abs(lat - 23.26371) < 1e-3, `lat=${lat}`);
                assert.ok(Math.abs(lng - 120.12229) < 1e-3, `lng=${lng}`);
                assert.ok((r.detectedCrs || '').includes('3826'));
            },
        },
        {
            name: 'boundaryImport: GeoJSON 標示 crs=EPSG:3826 → 轉換',
            run: async () => {
                const projRing = WGS_RING.map(([lng, lat]) => proj4('EPSG:4326', 'EPSG:3826', [lng, lat]));
                const obj = {
                    type: 'Feature',
                    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3826' } },
                    geometry: { type: 'Polygon', coordinates: [projRing] },
                };
                const r = await parseBoundaryFile(Buffer.from(JSON.stringify(obj)), 'c.geojson');
                assert.strictEqual(r.ok, true);
                const [lat, lng] = r.coordinates[0];
                assert.ok(Math.abs(lat - 23.26371) < 1e-3);
                assert.ok(Math.abs(lng - 120.12229) < 1e-3);
            },
        },
        {
            name: 'boundaryImport: KML 解析（WGS84）',
            run: async () => {
                const coordsText = WGS_RING.map(([lng, lat]) => `${lng},${lat},0`).join(' ');
                const kml = `<?xml version="1.0"?><kml><Document><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsText}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
                const r = await parseBoundaryFile(Buffer.from(kml), 'a.kml');
                assert.strictEqual(r.ok, true);
                assert.strictEqual(r.format, 'kml');
                assert.strictEqual(r.coordinates.length, 4);
            },
        },
        {
            name: 'boundaryImport: 多個多邊形 → 取面積最大 + 警告',
            run: async () => {
                const small = [
                    [120.10, 23.10], [120.101, 23.10], [120.101, 23.101], [120.10, 23.101], [120.10, 23.10],
                ];
                const big = WGS_RING;
                const obj = {
                    type: 'FeatureCollection',
                    features: [
                        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [small] } },
                        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [big] } },
                    ],
                };
                const r = await parseBoundaryFile(Buffer.from(JSON.stringify(obj)), 'multi.geojson');
                assert.strictEqual(r.ok, true);
                assert.strictEqual(r.stats.polygonCount, 2);
                assert.ok(r.warnings.some((w) => w.includes('面積最大')));
                // 取到的是 big（緯度約 23.26）
                assert.ok(Math.abs(r.coordinates[0][0] - 23.26371) < 1e-3);
            },
        },
        {
            name: 'boundaryImport: 自相交多邊形被偵測',
            run: async () => {
                // 蝴蝶結（自相交）
                const bowtie = [
                    [0, 0], [2, 2], [2, 0], [0, 2],
                ];
                assert.strictEqual(isSelfIntersecting(bowtie), true);
                const square = [
                    [0, 0], [0, 2], [2, 2], [2, 0],
                ];
                assert.strictEqual(isSelfIntersecting(square), false);
            },
        },
        {
            name: 'boundaryImport: 找不到多邊形 → NO_POLYGON',
            run: async () => {
                const obj = { type: 'Feature', geometry: { type: 'Point', coordinates: [120, 23] } };
                const r = await parseBoundaryFile(Buffer.from(JSON.stringify(obj)), 'pt.geojson');
                assert.strictEqual(r.ok, false);
                assert.strictEqual(r.code, 'NO_POLYGON');
            },
        },
        {
            name: 'boundaryImport: 不支援的副檔名 → UNSUPPORTED_FORMAT',
            run: async () => {
                const r = await parseBoundaryFile(Buffer.from('x'), 'a.txt');
                assert.strictEqual(r.ok, false);
                assert.strictEqual(r.code, 'UNSUPPORTED_FORMAT');
            },
        },
    ],
};
