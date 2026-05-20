/**
 * handbookCarbonService.js — 《森林碳匯調查與監測手冊》第六章單木碳儲量（正式方法）
 *
 * 圖 6-2：DBH,H → 材積(表6-2/6-3 或形數) → 生物量(表6-4) → CO₂e
 * 環境部 AR-TMS0001 係數框架。
 *
 * @module services/handbookCarbonService
 */

const path = require('path');
const fs = require('fs');
const coaVol = require('./coaVolumeEquations');

const TABLE_6_4 = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'coa_table_6_4.json'), 'utf8'),
);

const CO2_PER_C = TABLE_6_4.defaults.co2_per_c;

function isConiferForestType(forestType) {
    return String(forestType).includes('針葉');
}

function estimateVolume(speciesName, dbhCm, heightM, options = {}) {
    const ft = options.forestType
        || coaVol.inferForestType(speciesName, null, TABLE_6_4).forestType;
    return coaVol.estimateVolumeByHandbook(speciesName, dbhCm, heightM, {
        region: options.region,
        climateZone: options.climateZone,
        isConifer: isConiferForestType(ft),
        formFactor: options.formFactor,
    });
}

function inferForestType(speciesName, overrideForestType) {
    return coaVol.inferForestType(speciesName, overrideForestType, TABLE_6_4);
}

/**
 * @param {object} params
 */
function calculateCarbonStorageDetail(params) {
    const {
        speciesName,
        dbhCm,
        heightM,
        forestType: forestTypeOverride,
        biomassPath = 'wood_density_bef',
        region,
        climateZone,
    } = params;

    const dbh = Number(dbhCm);
    const h = Number(heightM);
    if (!Number.isFinite(dbh) || !Number.isFinite(h) || dbh <= 0 || h <= 0) {
        return {
            value: null,
            error: '胸徑與樹高須為正數',
            methodology: 'coa_handbook_ch6',
        };
    }

    const ft = inferForestType(speciesName, forestTypeOverride);
    const coeffs = TABLE_6_4.forest_types[ft.forestType];
    if (!coeffs) {
        return { value: null, error: `未知林型: ${ft.forestType}`, methodology: 'coa_handbook_ch6' };
    }

    const vol = estimateVolume(speciesName, dbh, h, {
        forestType: ft.forestType,
        region,
        climateZone,
    });
    if (vol.volume_m3 == null) {
        return { value: null, error: vol.error, methodology: 'coa_handbook_ch6' };
    }

    let agb_t;
    let agb_path;
    if (biomassPath === 'bcef' && coeffs.BCEF != null) {
        agb_t = vol.volume_m3 * coeffs.BCEF;
        agb_path = 'V × BCEF';
    } else {
        agb_t = vol.volume_m3 * coeffs.D * coeffs.BEF;
        agb_path = 'V × D × BEF';
    }

    const totalBiomass_t = agb_t * (1 + coeffs.R);
    const carbon_t = totalBiomass_t * coeffs.CF;
    const co2e_kg = round(carbon_t * CO2_PER_C * 1000, 2);

    return {
        value: co2e_kg,
        methodology: 'coa_handbook_ch6',
        formula_summary: 'CO₂e(kg) = V × [D×BEF 或 BCEF] × (1+R) × CF × (44/12) × 1000',
        forest_type: ft.forestType,
        forest_type_source: ft.source,
        coefficients: { ...coeffs, table: '表 6-4' },
        volume: vol,
        steps: {
            volume_m3: vol.volume_m3,
            agb_t_dm: round(agb_t, 6),
            agb_path,
            total_biomass_t_dm: round(totalBiomass_t, 6),
            carbon_t: round(carbon_t, 6),
            co2e_kg,
        },
        references: [
            '農業部林業及自然保育署《森林碳匯調查與監測手冊》第六章',
            '環境部溫室氣體減量方法學 AR-TMS0001',
        ],
    };
}

function calculateCarbonStorage(speciesName, dbhCm, heightM, options = {}) {
    return calculateCarbonStorageDetail({
        speciesName,
        dbhCm,
        heightM,
        ...options,
    }).value;
}

function round(x, decimals) {
    const f = 10 ** decimals;
    return Math.round(x * f) / f;
}

/** @deprecated 手冊為預設；僅 CARBON_CALC_LEGACY_TIPC=1 時走舊 K_sp */
function useHandbookMode() {
    return String(process.env.CARBON_CALC_LEGACY_TIPC || '').trim() !== '1';
}

module.exports = {
    calculateCarbonStorage,
    calculateCarbonStorageDetail,
    estimateVolume,
    inferForestType,
    useHandbookMode,
    TABLE_6_4,
};
