/**
 * 手冊表 6-2 / 6-3 材積式查表與求值
 * @module services/coaVolumeEquations
 */

const path = require('path');
const fs = require('fs');

const VOLUME_DATA = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'coa_volume_equations.json'), 'utf8'),
);

const ENTRIES = VOLUME_DATA.entries || [];

function normalizeSpecies(name) {
    if (name == null) return '';
    return String(name).replace(/[\u3000\u00A0]/g, ' ').trim().replace(/臺/g, '台');
}

function speciesMatchesLabel(speciesNorm, label) {
    const ln = normalizeSpecies(label);
    if (!ln || !speciesNorm) return false;
    if (speciesNorm === ln) return { exact: true, score: 0 };
    if (speciesNorm.includes(ln) || ln.includes(speciesNorm)) {
        const penalty = Math.max(0, 6 - Math.min(ln.length, speciesNorm.length) / 3);
        return { exact: false, score: 8 + penalty };
    }
    return null;
}

/**
 * 依手冊邏輯排序候選材積式（分數愈低愈優先）。
 * @returns {{ entry: object, totalScore: number }[]}
 */
function rankVolumeEntries(speciesName, options = {}) {
    const speciesNorm = normalizeSpecies(speciesName);
    if (!speciesNorm) return [];

    const wantRegion = options.region ? normalizeSpecies(options.region) : null;
    const wantClimate = options.climateZone || null;
    const candidates = [];

    for (const entry of ENTRIES) {
        let labelScore = 999;
        let matched = false;
        for (const label of entry.species_labels || []) {
            const m = speciesMatchesLabel(speciesNorm, label);
            if (m) {
                matched = true;
                labelScore = Math.min(labelScore, m.score);
            }
        }
        if (!matched) continue;

        const isOtherBroadleaf = (entry.species_labels || []).some(
            (l) => normalizeSpecies(l).includes('其他'),
        );
        if (isOtherBroadleaf && !speciesNorm.includes('其他')) {
            labelScore += 22;
        }

        let regionPenalty = 0;
        const entryRegion = entry.region || '全臺';
        if (wantRegion) {
            if (entryRegion === wantRegion) {
                regionPenalty = 0;
            } else if (entryRegion === '全臺') {
                regionPenalty = 6;
            } else {
                continue;
            }
        } else if (entryRegion !== '全臺') {
            regionPenalty = 14;
        }

        if (wantClimate) {
            if (entry.climate_zone) {
                if (entry.climate_zone !== wantClimate) continue;
            } else if (isOtherBroadleaf) {
                regionPenalty += 18;
            }
        } else if (entry.climate_zone) {
            regionPenalty += 16;
        }

        const totalScore = (entry.priority || 50) + labelScore + regionPenalty;
        candidates.push({ entry, totalScore });
    }

    candidates.sort((a, b) => a.totalScore - b.totalScore);
    return candidates;
}

function resolveVolumeEntry(speciesName, options = {}) {
    const ranked = rankVolumeEntries(speciesName, options);
    return ranked.length > 0 ? ranked[0].entry : null;
}

function evalVolumeEquation(eq, d, h) {
    if (!Number.isFinite(d) || !Number.isFinite(h) || d <= 0 || h <= 0) return null;

    let v;
    switch (eq.type) {
        case 'power':
            v = eq.a * Math.pow(d, eq.b) * Math.pow(h, eq.c);
            break;
        case 'quadratic':
            v = eq.a + eq.b * d + eq.c * d * d;
            break;
        case 'quadratic_dh':
            v = eq.a + eq.b * d + eq.c * d * d + (eq.d || 0) * d * h;
            break;
        case 'linear_dh':
            v = eq.a * d * h;
            break;
        case 'cubic_d':
            v = eq.a + (eq.e || 0) * Math.pow(d, 3);
            break;
        case 'log_d_h': {
            const inner = eq.a + eq.b * Math.log10(d) + eq.c * Math.log10(h);
            v = Math.pow(10, inner);
            if (eq.v_times_10 === true) v /= 10;
            break;
        }
        case 'log_d': {
            const inner = eq.a + eq.b * Math.log10(d);
            v = Math.pow(10, inner);
            break;
        }
        case 'log_d2h': {
            const inner = eq.a + eq.b * Math.log10(d * d * h);
            v = Math.pow(10, inner);
            break;
        }
        case 'ln_d_h_d2': {
            const inner =
                eq.a
                + eq.b * Math.log(d)
                + eq.c * Math.log(h)
                + (eq.d || 0) * d * d;
            v = Math.exp(inner);
            break;
        }
        default:
            throw new Error(`Unsupported volume equation type: ${eq.type}`);
    }

    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
}

function estimateVolumeByHandbook(speciesName, dbhCm, heightM, options = {}) {
    const dbh = Number(dbhCm);
    const h = Number(heightM);
    if (!Number.isFinite(dbh) || !Number.isFinite(h) || dbh <= 0 || h <= 0) {
        return { volume_m3: null, method: null, error: 'DBH 與樹高須為正數' };
    }

    const ranked = rankVolumeEntries(speciesName, options);
    for (const { entry } of ranked) {
        const v = evalVolumeEquation(entry, dbh, h);
        if (v != null && v > 0) {
            return {
                volume_m3: round(v, 6),
                method: 'volume_equation',
                equation_id: entry.id,
                equation: entry,
                reference: entry.reference,
            };
        }
    }

    const F = options.formFactor ?? (options.isConifer ? 0.5 : 0.45);
    const v = 0.79 * dbh * dbh * h * F * 0.0001;
    return {
        volume_m3: round(v, 6),
        method: 'form_factor',
        form_factor: F,
        reference:
            '手冊第二節：材積 = 0.79×DBH²×H×形數（無適用材積式時，闘葉0.45／針葉0.50）',
    };
}

function round(x, n) {
    const f = 10 ** n;
    return Math.round(x * f) / f;
}

function inferForestType(speciesName, overrideForestType, table64) {
    if (overrideForestType && table64.forest_types[overrideForestType]) {
        return { forestType: overrideForestType, source: 'caller_override' };
    }
    const norm = normalizeSpecies(speciesName);
    const bamboo = VOLUME_DATA.bamboo_species_hints || [];
    for (const b of bamboo) {
        if (norm.includes(normalizeSpecies(b))) {
            return { forestType: '竹林', source: 'bamboo_hint' };
        }
    }
    const conifers = VOLUME_DATA.conifer_species_hints || [];
    for (const c of conifers) {
        const cn = normalizeSpecies(c);
        if (norm === cn || norm.includes(cn) || cn.includes(norm)) {
            return { forestType: '天然針葉林', source: 'table_6_2_species_hint' };
        }
    }
    if (/[松柏檜杉]$/.test(norm) || norm.includes('松') || norm.includes('柏') || norm.includes('杉')) {
        return { forestType: '天然針葉林', source: 'morphology_conifer' };
    }
    const def = table64.defaults?.forest_type || '天然闊葉林';
    return { forestType: def, source: 'table_6_4_default' };
}

module.exports = {
    VOLUME_DATA,
    ENTRIES,
    normalizeSpecies,
    rankVolumeEntries,
    resolveVolumeEntry,
    evalVolumeEquation,
    estimateVolumeByHandbook,
    inferForestType,
};
