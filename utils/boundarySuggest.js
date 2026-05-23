/**
 * boundarySuggest.js — 從既有 tree_survey GPS 產生「建議邊界」（convex hull + buffer）
 *
 * 設計重點（避免後續 APP 遠距樹木污染邊界）：
 * 1. 只取「主群集」樹木（距群心過遠者視為 outlier 排除）
 * 2. 主群集跨度超過上限 → 拒絕自動建議，改請使用者手動繪製
 * 3. 回傳 excluded 清單供 UI 預覽確認，不靜默納入
 *
 * 用途：補齊早期 batch 匯入、尚未手動畫邊界的專案；非即時全量重算。
 */

const turf = require('@turf/turf');

const DEFAULT_BUFFER_M = 10;
const DEFAULT_MAX_SPAN_M = 2500;
const DEFAULT_MIN_TREES = 3;
const OUTLIER_MULTIPLIER = 2.5;
const MIN_OUTLIER_THRESHOLD_M = 300;

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function haversineM(lng1, lat1, lng2, lat2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function computeCentroid(trees) {
    let sumLat = 0;
    let sumLng = 0;
    for (const t of trees) {
        sumLat += t.lat;
        sumLng += t.lng;
    }
    return { lat: sumLat / trees.length, lng: sumLng / trees.length };
}

function computeMaxSpanM(trees) {
    let max = 0;
    for (let i = 0; i < trees.length; i++) {
        for (let j = i + 1; j < trees.length; j++) {
            max = Math.max(
                max,
                haversineM(trees[i].lng, trees[i].lat, trees[j].lng, trees[j].lat),
            );
        }
    }
    return max;
}

/**
 * 依距群心距離分離主群集 vs 離群點。
 * 後續 APP 在遠處新增的樹木通常會落在 excluded，不會被 convex hull 拉進邊界。
 */
function selectCoreCluster(trees) {
    const centroid = computeCentroid(trees);
    const withDist = trees.map((t) => ({
        ...t,
        distM: haversineM(centroid.lng, centroid.lat, t.lng, t.lat),
    }));
    withDist.sort((a, b) => a.distM - b.distM);
    const dists = withDist.map((t) => t.distM);
    const med = median(dists);
    const thresholdM = Math.max(MIN_OUTLIER_THRESHOLD_M, med * OUTLIER_MULTIPLIER);

    const core = withDist.filter((t) => t.distM <= thresholdM);
    const excluded = withDist.filter((t) => t.distM > thresholdM);
    return { core, excluded, thresholdM, centroid };
}

/**
 * @param {Array<{lng:number, lat:number, system_tree_id?:string, id?:number}>} trees
 * @param {{ bufferM?: number, maxSpanM?: number, minTrees?: number }} options
 */
function suggestBoundaryFromTrees(trees, options = {}) {
    const bufferM = options.bufferM ?? DEFAULT_BUFFER_M;
    const maxSpanM = options.maxSpanM ?? DEFAULT_MAX_SPAN_M;
    const minTrees = options.minTrees ?? DEFAULT_MIN_TREES;

    const valid = trees.filter(
        (t) =>
            typeof t.lng === 'number' &&
            typeof t.lat === 'number' &&
            Number.isFinite(t.lng) &&
            Number.isFinite(t.lat) &&
            !(t.lat === 0 && t.lng === 0),
    );

    if (valid.length < minTrees) {
        return {
            ok: false,
            code: 'INSUFFICIENT_TREES',
            message: `至少需要 ${minTrees} 棵有效 GPS 樹木才能產生建議邊界（目前 ${valid.length} 棵）`,
            stats: { totalTrees: valid.length },
        };
    }

    const { core, excluded, thresholdM } = selectCoreCluster(valid);

    if (core.length < minTrees) {
        return {
            ok: false,
            code: 'TOO_DISPERSED',
            message: '樹木 GPS 過於分散，無法自動產生可靠邊界，請改用手動繪製',
            stats: {
                totalTrees: valid.length,
                includedTrees: core.length,
                excludedTrees: excluded.length,
                thresholdM,
            },
        };
    }

    const spanM = computeMaxSpanM(core);
    if (spanM > maxSpanM) {
        return {
            ok: false,
            code: 'SPAN_TOO_LARGE',
            message: `主群集跨度 ${(spanM / 1000).toFixed(1)} km 超過上限 ${(maxSpanM / 1000).toFixed(1)} km，請改用手動繪製`,
            stats: {
                totalTrees: valid.length,
                includedTrees: core.length,
                excludedTrees: excluded.length,
                spanM,
                maxSpanM,
                thresholdM,
            },
        };
    }

    const fc = turf.featureCollection(core.map((t) => turf.point([t.lng, t.lat])));
    const hull = turf.convex(fc);
    if (!hull) {
        return {
            ok: false,
            code: 'HULL_FAILED',
            message: '無法建立凸包，請改用手動繪製',
            stats: { includedTrees: core.length },
        };
    }

    const buffered = turf.buffer(hull, bufferM, { units: 'meters' });
    const ring = buffered.geometry.coordinates[0];
    const coordinates = ring.slice(0, -1).map((c) => [c[1], c[0]]);

    const warnings = [];
    if (excluded.length > 0) {
        warnings.push(
            `已排除 ${excluded.length} 棵距主群集過遠的樹木（閾值約 ${Math.round(thresholdM)} m）。` +
                '此建議邊界僅涵蓋歷史調查主群集，後續 APP 在遠處新增的樹木不會自動納入。',
        );
    }

    return {
        ok: true,
        coordinates,
        stats: {
            totalTrees: valid.length,
            includedTrees: core.length,
            excludedTrees: excluded.length,
            excludedTreeIds: excluded.map((t) => t.system_tree_id).filter(Boolean),
            spanM,
            thresholdM,
            bufferM,
            areaHa: turf.area(buffered) / 10000,
        },
        warnings,
    };
}

module.exports = {
    suggestBoundaryFromTrees,
    selectCoreCluster,
    haversineM,
    DEFAULT_BUFFER_M,
    DEFAULT_MAX_SPAN_M,
    DEFAULT_MIN_TREES,
};
