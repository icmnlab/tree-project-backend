/**
 * carbonCalculationService.js — 碳儲量計算入口（預設：手冊第六章逐步計算）
 *
 * 預設委派 handbookCarbonService（圖 6-2 / 表 6-2–6-4）。
 * 僅在 CARBON_CALC_LEGACY_TIPC=1 時使用舊 TIPC 相容公式:
 *   carbon_storage_kgCO2e = K_sp · DBH(cm)^2 · H(m)
 *      K_sp = F · (π/4) · BEF · (1+R) · CF · (44/12) · 0.1 · D_wood
 *
 * 文獻來源:
 *   - 環境部 (2023). 溫室氣體減量方法學 AR-TMS0001 造林與植林碳匯專案活動 v01.0
 *   - 農業部林業及自然保育署 (2024). 森林碳匯調查與監測手冊, 表 6-4 (環境部 2023a)
 *
 * 常數值 (採林業署手冊表 6-4「闊葉林」一欄):
 *   F = 0.45 (闊葉) | 0.50 (針葉) — 形數，《農業部辦理國有林林產物處分暨伐採查驗作業要點》第 5 點第 1 項第 3 款
 *   π/4 ≈ 0.79  截面係數
 *   BEF = 1.40   生物量擴展係數
 *   R = 0.24     根莖比
 *   CF = 0.4691  碳含量比例
 *   44/12        CO2/C 分子量比
 *   0.1          單位整合常數 (cm² → m² × t.d.m → kg)
 *   D_wood       基本比重 (per species)
 *
 * 已知偏差 (需揭露):
 *   - 針葉樹於 TIPC 平台採用闊葉常數 (BEF/R/CF)，與手冊「針葉林」建議值
 *     (BEF=1.27, R=0.22, CF=0.4821) 約過估 9%。為與 TIPC 既有 7044 筆紀錄
 *     維持一致性，本工具沿用此簡化做法。
 *   - 5 個物種 (白樹仔、中東海棗、蒲葵、孟加拉榕、鴨腳木) 使用 TIPC 平台
 *     預設 D_wood = 0.530，個別物種誤差可達 ±20-30%。
 *
 * 反向驗證:
 *   - 對 7044 筆 TIPC 平台紀錄之逆向工程，於 ±0.005 kg 容忍度下達 98.20% 對齊
 *     (10 g 容忍度下 99.29%)；詳見 backend/scripts/build_tipc_kp_lookup.py
 *
 * 不重算項目:
 *   - carbon_sequestration_per_year (年固碳量): TIPC 平台公式涉及樹齡且未公開，
 *     本工具不進行客端重算；請直接讀取 DB carbon_sequestration_per_year 欄位。
 *
 * @module services/carbonCalculationService
 */

const path = require('path');
const fs = require('fs');

// ============================================
// TIPC K_sp 查表載入
// ============================================
let TIPC_LOOKUP = null;
try {
    const lookupPath = path.join(__dirname, '..', 'data', 'tipc_kp_lookup.json');
    TIPC_LOOKUP = JSON.parse(fs.readFileSync(lookupPath, 'utf8'));
} catch (e) {
    console.warn('[carbonCalculationService] TIPC K_sp lookup load failed:', e.message);
    TIPC_LOOKUP = {
        species: {},
        default_broadleaf: { K_sp: 0.106152, F: 0.45, D_wood: 0.530 },
        default_conifer: { K_sp: 0.117946, F: 0.50, D_wood: 0.530 },
    };
}

// 已知針葉樹中文名清單 (與 build_tipc_kp_lookup.py CONIFER_NAMES 同步)
const TIPC_CONIFER_NAMES = new Set([
    '肯氏南洋杉', '小葉南洋杉', '龍柏', '黑松',
    '臺灣杉', '台灣杉', '紅檜', '臺灣肖楠', '台灣肖楠',
    '落羽松', '柳杉', '臺灣五葉松', '台灣五葉松',
    '華山松', '琉球松', '羅漢松', '蘭嶼羅漢松', '圓柏', '刺柏',
]);

/**
 * 樹種名稱 normalize: 處理常見繁簡 / 異體字差異。
 * 目前處理：
 *   - 「臺」<-> 「台」(同字異體，台灣常用兩者混用)
 *   - 全形空白與半形空白統一
 *   - trim
 *
 * Note: 不做進一步翻譯 (e.g., 學名 ↔ 中文名)；該層由 species_synonyms 表處理。
 */
function normalizeSpecies(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/[\u3000\u00A0]/g, ' ') // full-width space → space
        .trim()
        .replace(/臺/g, '台'); // 「臺」 → 「台」 (簡化字形)
}

// 預先 normalize conifer set
const TIPC_CONIFER_NAMES_NORMALIZED = new Set(
    [...TIPC_CONIFER_NAMES].map(normalizeSpecies),
);

// ============================================
// 公開 API
// ============================================

/**
 * 查詢樹種 K_sp 係數。
 * 1) 直接命中 species lookup → 採用反推 K_sp。
 * 2) Normalize 後直接命中 → 採用反推 K_sp (處理臺/台異體字)。
 * 3) Normalize 後寬鬆比對 (partial substring，例「欖仁」vs「欖仁樹」) → 採用近似命中。
 * 4) 命中 conifer 名單 → fallback 針葉預設。
 * 5) 其他 → fallback 闊葉預設。
 *
 * @param {string|null|undefined} speciesName
 * @returns {{ entry: object, source: string, species_matched: string|null }}
 */
function lookupKsp(speciesName) {
    const fallbackBroadleaf = {
        entry: TIPC_LOOKUP.default_broadleaf,
        source: 'tipc_default_broadleaf',
        species_matched: null,
    };
    const fallbackConifer = {
        entry: TIPC_LOOKUP.default_conifer,
        source: 'tipc_default_conifer',
        species_matched: null,
    };

    if (speciesName === null || speciesName === undefined) return fallbackBroadleaf;
    const name = String(speciesName).trim();
    if (!name) return fallbackBroadleaf;

    // 1) Direct lookup (precise)
    const direct = TIPC_LOOKUP.species[name];
    if (direct) {
        return {
            entry: direct,
            source: direct.source || 'tipc_reverse_engineered',
            species_matched: name,
        };
    }

    // 2) Normalize 後直接命中 (處理「臺」vs「台」)
    const normalized = normalizeSpecies(name);
    for (const [key, val] of Object.entries(TIPC_LOOKUP.species)) {
        if (normalizeSpecies(key) === normalized) {
            return {
                entry: val,
                source: val.source || 'tipc_reverse_engineered',
                species_matched: key,
            };
        }
    }

    // 3) Normalize 後寬鬆比對 (partial substring)
    for (const [key, val] of Object.entries(TIPC_LOOKUP.species)) {
        const normKey = normalizeSpecies(key);
        if (normKey.includes(normalized) || normalized.includes(normKey)) {
            return {
                entry: val,
                source: val.source || 'tipc_reverse_engineered',
                species_matched: key,
            };
        }
    }

    // 4) Conifer fallback (檢查 normalized 是否在針葉樹清單)
    if (TIPC_CONIFER_NAMES_NORMALIZED.has(normalized)) return fallbackConifer;

    // 5) Broadleaf fallback
    return fallbackBroadleaf;
}

/**
 * 計算單木碳儲量 (kg CO2e)。
 *
 * 邊界處理:
 *   - DBH 或樹高為 null/undefined/NaN/≤0 → 回傳 null (不是 0；
 *     讓 SQL SUM 可以 IGNORE NULLS，避免將「未量測」誤併入「無碳儲」)。
 *
 * @param {string|null|undefined} speciesName
 * @param {number|string|null|undefined} dbhCm
 * @param {number|string|null|undefined} heightM
 * @returns {number|null} 碳儲量 (kg CO2e, round to 2 decimals); null 表示無法計算
 */
function calculateCarbonStorage(speciesName, dbhCm, heightM) {
    const dbh = typeof dbhCm === 'number' ? dbhCm : parseFloat(dbhCm);
    const h = typeof heightM === 'number' ? heightM : parseFloat(heightM);

    if (!Number.isFinite(dbh) || !Number.isFinite(h)) return null;
    if (dbh <= 0 || h <= 0) return null;

    // 手冊逐步計算（圖 6-2）；設 CARBON_CALC_MODE=handbook 啟用
    try {
        const handbook = require('./handbookCarbonService');
        if (handbook.useHandbookMode()) {
            return handbook.calculateCarbonStorage(speciesName, dbh, h);
        }
    } catch (_) {
        /* handbook module optional at load */
    }

    const { entry } = lookupKsp(speciesName);
    const k = entry.K_sp;

    // Match TIPC rounding (2 decimals, kg)
    return Math.round(k * dbh * dbh * h * 100) / 100;
}

/**
 * 計算碳儲量並回傳完整 breakdown (供 Agent / 診斷用)。
 *
 * @param {string|null|undefined} speciesName
 * @param {number|null|undefined} dbhCm
 * @param {number|null|undefined} heightM
 * @returns {object}
 */
function calculateCarbonStorageDetail(speciesName, dbhCm, heightM) {
    const dbh = typeof dbhCm === 'number' ? dbhCm : parseFloat(dbhCm);
    const h = typeof heightM === 'number' ? heightM : parseFloat(heightM);

    if (!Number.isFinite(dbh) || !Number.isFinite(h) || dbh <= 0 || h <= 0) {
        return {
            value: null,
            error: '胸徑 (DBH) 與樹高 (H) 必須皆為正數；TIPC 公式需要兩者皆有效。',
        };
    }

    try {
        const handbook = require('./handbookCarbonService');
        if (handbook.useHandbookMode()) {
            return handbook.calculateCarbonStorageDetail({ speciesName, dbhCm: dbh, heightM: h });
        }
    } catch (_) {
        /* ignore */
    }

    const lookup = lookupKsp(speciesName);
    const k = lookup.entry.K_sp;
    const value = Math.round(k * dbh * dbh * h * 100) / 100;

    return {
        value,
        formula: 'carbon_storage_kgCO2e = K_sp × DBH²(cm) × H(m)',
        coefficients: {
            K_sp: k,
            F: lookup.entry.F,
            D_wood: lookup.entry.D_wood,
            n_samples: lookup.entry.n_samples || 0,
        },
        source: lookup.source,
        species_matched: lookup.species_matched,
        methodology:
            'TIPC AR-TMS0001 (環境部 2023) / 林業署森林碳匯調查與監測手冊式 6-4 (環境部 2023a)；' +
            'K_sp 以 7044 筆 TIPC 紀錄反推驗證 (詳見 backend/data/tipc_kp_lookup.json)',
    };
}

/**
 * 判斷樹種是否為針葉樹 (依 TIPC_CONIFER_NAMES + lookup F=0.50)。
 * @param {string|null|undefined} speciesName
 * @returns {boolean}
 */
function isConifer(speciesName) {
    if (!speciesName) return false;
    const name = String(speciesName).trim();
    if (!name) return false;
    if (TIPC_CONIFER_NAMES.has(name)) return true;
    if (TIPC_CONIFER_NAMES_NORMALIZED.has(normalizeSpecies(name))) return true;
    const lookup = lookupKsp(name);
    return lookup.entry.F === 0.50;
}

module.exports = {
    calculateCarbonStorage,
    calculateCarbonStorageDetail,
    lookupKsp,
    isConifer,
    TIPC_CONIFER_NAMES,
    // Test / debug helpers
    _getLookup: () => TIPC_LOOKUP,
};
