/**
 * backfill_county.js — 用官方縣市多邊形重算 project_areas.city
 *
 * 來源: utils/geo.js (內政部 1140318 縣市界線, TWD97)
 * 目標: project_areas.center_lat / center_lng → 寫回 project_areas.city
 *
 * 用法:
 *   node scripts/backfill_county.js              # 預覽 (dry-run)
 *   node scripts/backfill_county.js --apply      # 實際寫入
 *
 * 注意:
 *   - 僅更新有 center_lat/center_lng 的列。
 *   - 落在台灣界外或無法判定者會跳過並回報。
 */

require('dotenv').config();
const db = require('../config/db');
const { resolveCountyByLngLat } = require('../utils/geo');

const APPLY = process.argv.includes('--apply');

async function main() {
    const { rows } = await db.query(`
        SELECT id, area_name, area_code, city, center_lat, center_lng
        FROM project_areas
        ORDER BY id
    `);

    let resolved = 0;
    let unchanged = 0;
    let mismatched = 0;
    let skipped = 0;
    const updates = [];

    for (const row of rows) {
        const lat = row.center_lat;
        const lng = row.center_lng;
        if (lat == null || lng == null) {
            skipped++;
            console.log(`[SKIP] #${row.id} ${row.area_name} (無中心點座標)`);
            continue;
        }
        const county = resolveCountyByLngLat(Number(lng), Number(lat));
        if (!county) {
            skipped++;
            console.log(`[SKIP] #${row.id} ${row.area_name} (${lat},${lng}) 不在台灣界線內`);
            continue;
        }
        resolved++;
        if (row.city === county.name) {
            unchanged++;
            continue;
        }
        mismatched++;
        console.log(`[FIX]  #${row.id} ${row.area_name}: '${row.city || '(空)'}' → '${county.name}'`);
        updates.push({ id: row.id, city: county.name });
    }

    console.log('\n=== 總結 ===');
    console.log(`總筆數: ${rows.length}`);
    console.log(`已成功歸屬: ${resolved}`);
    console.log(`維持原值: ${unchanged}`);
    console.log(`需修正: ${mismatched}`);
    console.log(`無法判定/跳過: ${skipped}`);

    if (!APPLY) {
        console.log('\n(預覽模式，未實際寫入。加上 --apply 以執行更新。)');
        await db.end?.();
        return;
    }

    if (updates.length === 0) {
        console.log('\n沒有需要更新的列。');
        await db.end?.();
        return;
    }

    await db.query('BEGIN');
    try {
        for (const u of updates) {
            await db.query('UPDATE project_areas SET city = $1, updated_at = NOW() WHERE id = $2', [u.city, u.id]);
        }
        await db.query('COMMIT');
        console.log(`\n已更新 ${updates.length} 筆 project_areas.city。`);
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('更新失敗，已 ROLLBACK:', err);
        process.exitCode = 1;
    } finally {
        await db.end?.();
    }
}

main().catch((err) => {
    console.error('執行失敗:', err);
    process.exit(1);
});
