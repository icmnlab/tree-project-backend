#!/usr/bin/env node
/**
 * 儀器補測 GPS 流程模擬（唯讀診斷，不修改資料）
 *
 * 用法（Ubuntu 後端目錄）：
 *   node scripts/simulate_instrument_retest.js
 *   node scripts/simulate_instrument_retest.js --session-id=BLE-xxx
 *
 * 說明：
 *   BLE 匯入時 GPS=0 的記錄會標 REQUIRES_GPS_FIX，寫入 pending_tree_measurements。
 *   現場需用 VLGEO2 對同一 pending ID 重新測量並上傳，再於 App「待測量任務」完成拍照/DBH。
 *   本腳本列出待補測筆數並逐步印出預期 App 流程。
 */

require('dotenv').config();
const { pool } = require('../config/db');

const args = process.argv.slice(2);
const sessionArg = args.find((a) => a.startsWith('--session-id='));
const sessionFilter = sessionArg ? sessionArg.split('=')[1] : null;

async function main() {
  let sql = `
    SELECT id, session_id, original_record_id, status,
           tree_latitude, tree_longitude, station_latitude, station_longitude,
           horizontal_distance, azimuth, instrument_dbh_cm,
           project_name, project_code, project_area, created_at
    FROM pending_tree_measurements
    WHERE status IN ('pending', 'in_progress')
      AND (
        (COALESCE(tree_latitude, 0) = 0 AND COALESCE(tree_longitude, 0) = 0)
        OR (COALESCE(station_latitude, 0) = 0 AND COALESCE(station_longitude, 0) = 0)
      )
  `;
  const params = [];
  if (sessionFilter) {
    params.push(sessionFilter);
    sql += ` AND session_id = $${params.length}`;
  }
  sql += ' ORDER BY session_id, id ASC';

  const { rows } = await pool.query(sql, params);

  console.log('═══════════════════════════════════════════════════');
  console.log('  儀器補測 GPS — 待處理 pending 記錄');
  console.log('═══════════════════════════════════════════════════');
  console.log(`共 ${rows.length} 筆（status=pending/in_progress 且 GPS 缺失）\n`);

  if (rows.length === 0) {
    console.log('✓ 目前沒有需要補測 GPS 的 pending 記錄。');
    await pool.end();
    return;
  }

  const bySession = new Map();
  for (const r of rows) {
    const sid = r.session_id || '(no-session)';
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(r);
  }

  for (const [sid, items] of bySession) {
    console.log(`\n── 批次 session_id: ${sid} (${items.length} 筆) ──`);
    for (const p of items) {
      const treeGpsOk =
        Math.abs(Number(p.tree_latitude)) > 1e-6 ||
        Math.abs(Number(p.tree_longitude)) > 1e-6;
      const stGpsOk =
        Math.abs(Number(p.station_latitude)) > 1e-6 ||
        Math.abs(Number(p.station_longitude)) > 1e-6;
      console.log(`  pending_id=${p.id}  record=${p.original_record_id || '-'}  status=${p.status}`);
      console.log(`    專案: ${p.project_name || '-'} (${p.project_code || '-'})`);
      console.log(`    測站 GPS: ${stGpsOk ? 'OK' : '缺失'}  樹位 GPS: ${treeGpsOk ? 'OK' : '缺失'}`);
      console.log(`    HD=${p.horizontal_distance}m AZ=${p.azimuth}°  instrument_dbh=${p.instrument_dbh_cm ?? '-'} cm`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  預期 App 補測流程（每筆）');
  console.log('═══════════════════════════════════════════════════');
  console.log(`
1. VLGEO2 現場對「同一棵樹」重新測量（取得有效 GPS + HD/AZ/H）
2. BLE 匯入 → 選擇對應專案/區位 → 上傳
   （strict 模式會拒絕無 GPS；寬鬆模式會標記 REQUIRES_GPS_FIX）
3. 待測量任務 → 選批次 → 導航到測站（≥10m 箭頭，<10m 雷達）
4. 到達測站 → 對準樹木 → IntegratedTreeForm 拍照 + DBH
5. 批次完成 → 「轉移到正式資料庫」（照片 owner pending→survey）

模擬可行性（針對上列 ${rows.length} 筆）：
  ✓ 後端 pending 表已就緒，可逐筆導航/測量
  ✓ instrument_dbh_cm 已存在者，App 可預填胸徑
  ${rows.some((r) => !r.project_code) ? '⚠ 部分記錄缺 project_code，匯入前需指定專案' : '✓ 專案代碼齊全'}
  ${rows.some((r) => Math.abs(Number(r.tree_latitude)) < 1e-6) ? '⚠ 樹位 GPS 仍缺失 → 導航只能到測站，無法直達樹位' : '✓ 至少測站或樹位 GPS 可用'}
`);

  const sample = rows[0];
  console.log('範例 API 查詢（確認單筆）:');
  console.log(`  GET /api/pending-measurements/${sample.id}`);
  console.log(`  GET /api/pending-measurements/trees?session_id=${sample.session_id}&status=pending`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
