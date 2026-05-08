/**
 * Sanity test: 驗證 services/carbonCalculationService.js 對 tree_survey_data.csv
 * 7044 筆紀錄之碳儲量重算對齊度。
 *
 * 預期結果 (與 build_tipc_kp_lookup.py 一致):
 *   - match_strict (<0.005 kg): ~98.20%
 *   - match_loose  (<0.01  kg): ~99.29%
 *
 * 此腳本不修改任何檔案，僅輸出對齊報告與邊界測試結果。
 *
 * 使用方式:
 *   node scripts/verify_carbon_service.js
 */

const fs = require('fs');
const path = require('path');
const calc = require('../services/carbonCalculationService');

const CSV_PATH = path.join(__dirname, '..', 'database', 'initial_data', 'tree_survey_data.csv');

// --- CSV parser: 正確處理 quoted fields (含 escaped "" 與欄位內逗號) ---
function splitCsvRow(line) {
    const cols = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuote) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"'; // escaped ""
                    i++;
                } else {
                    inQuote = false;
                }
            } else {
                cur += ch;
            }
        } else {
            if (ch === ',') {
                cols.push(cur);
                cur = '';
            } else if (ch === '"') {
                inQuote = true;
            } else {
                cur += ch;
            }
        }
    }
    cols.push(cur);
    return cols;
}

function parseCsv(text) {
    // 處理可能跨行的 quoted field: 先把連續 row 合併成完整邏輯 row
    const rawLines = text.split(/\r?\n/);
    const logicalRows = [];
    let buf = '';
    let inQuote = false;
    for (const line of rawLines) {
        if (buf.length > 0) buf += '\n';
        buf += line;
        // 計算 buffer 中尚未閉合之 " 數量 (奇數 = 仍 in quote)
        let count = 0;
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] === '"') count++;
        }
        inQuote = count % 2 === 1;
        if (!inQuote) {
            if (buf.trim().length > 0) logicalRows.push(buf);
            buf = '';
        }
    }
    if (buf.trim().length > 0) logicalRows.push(buf);

    if (logicalRows.length === 0) return [];
    const header = splitCsvRow(logicalRows[0]);
    const rows = [];
    for (let i = 1; i < logicalRows.length; i++) {
        const cols = splitCsvRow(logicalRows[i]);
        const row = {};
        for (let j = 0; j < header.length; j++) row[header[j]] = cols[j];
        rows.push(row);
    }
    return rows;
}

// --- Bulk verification ---
function verifyBulk() {
    const text = fs.readFileSync(CSV_PATH, 'utf8');
    const rows = parseCsv(text);

    let total = 0;
    let strict = 0;
    let loose = 0;
    let nullPred = 0;
    const bySource = {};

    for (const row of rows) {
        const species = row.species_name;
        const dbh = parseFloat(row.dbh_cm);
        const h = parseFloat(row.tree_height_m);
        const truth = parseFloat(row.carbon_storage);
        if (!Number.isFinite(dbh) || !Number.isFinite(h) || !Number.isFinite(truth)) continue;
        if (dbh <= 0 || h <= 0 || truth <= 0) continue;
        total++;
        const pred = calc.calculateCarbonStorage(species, dbh, h);
        if (pred === null) {
            nullPred++;
            continue;
        }
        const diff = Math.abs(pred - truth);
        const src = calc.lookupKsp(species).source || 'unknown';
        if (!bySource[src]) bySource[src] = { matched: 0, total: 0 };
        bySource[src].total += 1;
        if (diff < 0.005) {
            strict++;
            bySource[src].matched += 1;
        }
        if (diff < 0.01) loose++;
    }

    console.log('=== Bulk verify (tree_survey_data.csv) ===');
    console.log('total rows:', total);
    console.log(
        'match_strict_<0.005kg:',
        strict,
        '(' + ((strict / total) * 100).toFixed(2) + '%)',
    );
    console.log(
        'match_loose_<0.01kg :',
        loose,
        '(' + ((loose / total) * 100).toFixed(2) + '%)',
    );
    console.log('null pred:', nullPred);
    console.log('by source:');
    for (const [k, v] of Object.entries(bySource)) {
        const rate = v.total > 0 ? ((v.matched / v.total) * 100).toFixed(2) + '%' : 'n/a';
        console.log('  ', k, ':', v.matched + '/' + v.total, '=', rate);
    }
}

// --- Boundary tests ---
function verifyBoundary() {
    console.log('\n=== Boundary tests ===');
    const cases = [
        ['null DBH', () => calc.calculateCarbonStorage('欖仁', null, 5)],
        ['undefined DBH', () => calc.calculateCarbonStorage('欖仁', undefined, 5)],
        ['zero DBH', () => calc.calculateCarbonStorage('欖仁', 0, 5)],
        ['negative DBH', () => calc.calculateCarbonStorage('欖仁', -1, 5)],
        ['null H', () => calc.calculateCarbonStorage('欖仁', 20, null)],
        ['zero H', () => calc.calculateCarbonStorage('欖仁', 20, 0)],
        ['NaN H (string)', () => calc.calculateCarbonStorage('欖仁', 20, 'abc')],
        ['null species', () => calc.calculateCarbonStorage(null, 20, 5)],
        ['empty species', () => calc.calculateCarbonStorage('', 20, 5)],
        ['whitespace species', () => calc.calculateCarbonStorage('   ', 20, 5)],
        ['臺灣欒樹', () => calc.calculateCarbonStorage('臺灣欒樹', 20, 5)],
        ['台灣欒樹', () => calc.calculateCarbonStorage('台灣欒樹', 20, 5)],
        ['欖仁 vs 欖仁樹', () => [
            calc.calculateCarbonStorage('欖仁', 20, 5),
            calc.calculateCarbonStorage('欖仁樹', 20, 5),
        ]],
        ['「  欖仁  」(trim)', () => calc.calculateCarbonStorage('  欖仁  ', 20, 5)],
        ['未知樹種 XYZ -> broadleaf default', () => calc.calculateCarbonStorage('未知樹種XYZ', 20, 5)],
        ['黑松 (conifer in lookup)', () => calc.calculateCarbonStorage('黑松', 20, 5)],
        ['isConifer(黑松)', () => calc.isConifer('黑松')],
        ['isConifer(欖仁)', () => calc.isConifer('欖仁')],
        ['isConifer(undefined)', () => calc.isConifer(undefined)],
    ];
    for (const [label, fn] of cases) {
        try {
            const out = fn();
            console.log('  ', label, '->', JSON.stringify(out));
        } catch (e) {
            console.log('  ', label, '-> THROW', e.message);
        }
    }
}

// --- Detail (Agent-style) ---
function verifyDetail() {
    console.log('\n=== Detail breakdown (sample) ===');
    const det = calc.calculateCarbonStorageDetail('臺灣欒樹', 20, 5);
    console.log(JSON.stringify(det, null, 2));
}

verifyBulk();
verifyBoundary();
verifyDetail();
