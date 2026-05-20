/**
 * 比較手冊逐步計算 vs TIPC 相容公式（開發用，不修改資料）。
 *   node scripts/compare_handbook_vs_tipc.js
 */

const path = require('path');
const fs = require('fs');
const tipc = require('../services/carbonCalculationService');
const handbook = require('../services/handbookCarbonService');

const CSV_PATH = path.join(__dirname, '..', 'database', 'initial_data', 'tree_survey_data.csv');

function parseCsvLine(line) {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (ch === '"') inQ = false;
            else cur += ch;
        } else if (ch === ',') {
            cols.push(cur);
            cur = '';
        } else if (ch === '"') inQ = true;
        else cur += ch;
    }
    cols.push(cur);
    return cols;
}

function main() {
    const text = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = parseCsvLine(lines[0]);
    let n = 0;
    let within005 = 0;
    let within01 = 0;
    const samples = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const row = {};
        header.forEach((h, j) => {
            row[h] = cols[j];
        });
        const dbh = parseFloat(row.dbh_cm);
        const h = parseFloat(row.tree_height_m);
        const truth = parseFloat(row.carbon_storage);
        if (!Number.isFinite(dbh) || !Number.isFinite(h) || dbh <= 0 || h <= 0) continue;
        n++;
        const tipcVal = tipc.calculateCarbonStorage(row.species_name, dbh, h);
        const hb = handbook.calculateCarbonStorage(row.species_name, dbh, h, {
            climateZone: '亞熱帶',
            region: '南部',
        });
        const diffHbTruth = hb != null ? Math.abs(hb - truth) : null;
        const diffHbTipc = hb != null && tipcVal != null ? Math.abs(hb - tipcVal) : null;
        if (diffHbTruth != null && diffHbTruth < 0.005) within005++;
        if (diffHbTruth != null && diffHbTruth < 0.01) within01++;
        if (samples.length < 5 && diffHbTipc != null && diffHbTipc > 1) {
            samples.push({
                species: row.species_name,
                dbh,
                h,
                tipc: tipcVal,
                handbook: hb,
                tipc_truth: truth,
            });
        }
    }

    console.log('=== Handbook (預設人工闊葉林/形數) vs TIPC CSV truth ===');
    console.log('rows:', n);
    console.log('handbook vs truth <0.005 kg:', within005, `(${(100 * within005 / n).toFixed(2)}%)`);
    console.log('handbook vs truth <0.01 kg:', within01, `(${(100 * within01 / n).toFixed(2)}%)`);
    console.log('(TIPC compat ~98.20% — 手冊模式需補材積式/林型才會接近舊平台)');
    if (samples.length) {
        console.log('\nSample large handbook↔tipc gaps:');
        console.log(JSON.stringify(samples, null, 2));
    }

    const demo = handbook.calculateCarbonStorageDetail({
        speciesName: '樟樹',
        dbhCm: 35,
        heightM: 12,
    });
    console.log('\nDemo 樟樹 (材積式):');
    console.log(JSON.stringify(demo, null, 2));
}

main();
