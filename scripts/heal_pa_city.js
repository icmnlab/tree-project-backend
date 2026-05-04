#!/usr/bin/env node
/**
 * heal_pa_city.js — 修補 project_areas.city 與權威來源不一致的紀錄
 *
 * 背景：
 *   project_areas.city 是 denormalized cache（2025-10-17 commit 50e0b63 引入）。
 *   隨著 utils/county.resolveAreaCity 採用內政部 1140318 官方界線 + 港口權威表，
 *   舊資料的 city 欄位可能與權威結果不符（例：「布袋港」被標成台南）。
 *
 * 用法：
 *   node scripts/heal_pa_city.js              # dry-run，列出差異不寫入
 *   node scripts/heal_pa_city.js --apply      # 套用修正
 *
 * 重新計算邏輯：
 *   1. 收集該 area 名下所有 tree_survey 的 (x_coord, y_coord, project_location)
 *   2. 用 resolveAreaCity 解析每筆樹 → 取出現次數最多的縣市作為 area 真正的城市
 *   3. 若無樹（或全為座標 (0,0)）→ 退回 area_name 文字解析
 *   4. 與現存 pa.city 比對，記錄差異 / 套用更新
 *
 * 安全性：
 *   - dry-run 預設；--apply 才會 UPDATE
 *   - 每筆 UPDATE 都有 WHERE id=$id，不會誤傷
 *   - 套用模式會印 BEFORE/AFTER 表格供 review
 */

const db = require('../config/db');
const { resolveAreaCity } = require('../utils/county');

const APPLY = process.argv.includes('--apply');

async function main() {
    const { rows: areas } = await db.query(`
        SELECT id, area_name, area_code, city
        FROM project_areas
        ORDER BY id
    `);

    const { rows: trees } = await db.query(`
        SELECT project_location, x_coord, y_coord
        FROM tree_survey
        WHERE is_placeholder IS NOT TRUE
    `);

    // area_name → array of detected counties (含重複，用 mode 取多數)
    const areaSamples = new Map();
    for (const t of trees) {
        const detected = resolveAreaCity({
            lng: t.x_coord,
            lat: t.y_coord,
            areaName: t.project_location,
        });
        if (!detected) continue;
        if (!areaSamples.has(t.project_location)) {
            areaSamples.set(t.project_location, []);
        }
        areaSamples.get(t.project_location).push(detected);
    }

    function mode(arr) {
        const counts = new Map();
        for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
        let best = null;
        let bestCount = 0;
        for (const [v, c] of counts) {
            if (c > bestCount) { best = v; bestCount = c; }
        }
        return best;
    }

    const diffs = [];
    for (const a of areas) {
        const samples = areaSamples.get(a.area_name) || [];
        let computed = samples.length > 0
            ? mode(samples)
            : resolveAreaCity({ areaName: a.area_name });

        if (!computed) continue; // 無法判斷的不動
        if (computed !== a.city) {
            diffs.push({
                id: a.id,
                area_code: a.area_code,
                area_name: a.area_name,
                from: a.city,
                to: computed,
                samples: samples.length,
            });
        }
    }

    if (diffs.length === 0) {
        console.log('✓ 所有 project_areas.city 已與權威來源一致，無需修補');
        process.exit(0);
    }

    console.log(`\n發現 ${diffs.length} 筆 project_areas.city 與權威來源不一致：\n`);
    console.log('id'.padEnd(5) + 'area_code'.padEnd(15) + 'area_name'.padEnd(40) + 'from'.padEnd(10) + '→ to'.padEnd(10) + 'samples');
    console.log('─'.repeat(95));
    for (const d of diffs) {
        console.log(
            String(d.id).padEnd(5) +
            (d.area_code || '').padEnd(15) +
            (d.area_name || '').padEnd(40) +
            (d.from || '(null)').padEnd(10) +
            ('→ ' + d.to).padEnd(10) +
            String(d.samples)
        );
    }

    if (!APPLY) {
        console.log('\n[dry-run] 未套用變更。確認無誤後請執行：node scripts/heal_pa_city.js --apply');
        process.exit(0);
    }

    console.log('\n[apply] 開始套用變更...');
    let updated = 0;
    for (const d of diffs) {
        const { rowCount } = await db.query(
            'UPDATE project_areas SET city=$1 WHERE id=$2',
            [d.to, d.id]
        );
        if (rowCount > 0) updated++;
    }
    console.log(`✓ 完成，更新 ${updated} 筆`);
    process.exit(0);
}

main().catch(err => {
    console.error('[heal_pa_city] 失敗:', err);
    process.exit(1);
});
