/**
 * 手冊碳儲量 smoke test（部署後可於伺服器執行）
 *   node scripts/test_handbook_carbon_smoke.js
 */
const handbook = require('../services/handbookCarbonService');
const coa = require('../services/coaVolumeEquations');

const cases = [
    ['樟樹', 35, 12],
    ['柳杉', 40, 15],
    ['白玉蘭', 20.8, 4.8],
    ['大葉桃花心木', 22.5, 7.4],
    ['相思樹', 25, 8],
    ['未知樹種XYZ', 30, 10],
];

let ok = 0;
console.log('COA volume entries:', coa.ENTRIES.length);
for (const [sp, d, h] of cases) {
    const det = handbook.calculateCarbonStorageDetail({ speciesName: sp, dbhCm: d, heightM: h });
    const pass = det.value != null && det.value > 0;
    if (pass) ok++;
    console.log(
        pass ? 'OK' : 'FAIL',
        sp,
        `V=${det.volume?.method}`,
        det.value != null ? `${det.value} kg` : det.error,
    );
}
if (ok < cases.length) process.exit(1);
console.log('All smoke cases passed.');
