#!/usr/bin/env node
/**
 * 現場測試用資料集（歷史紀錄 + 維護量測）
 *
 * 業界做法：fixture / seed script，標記 [QA-FIXTURE:field-test] 可安全清理。
 *
 * 用法（在 backend 目錄，需 .env 的 DATABASE_URL）：
 *   node scripts/seed_field_test_dataset.js --lat=24.15 --lon=120.65 --project-code=TIPC-XX
 *   node scripts/seed_field_test_dataset.js --lat=24.15 --lon=120.65 --project-code=TIPC-XX --apply
 *   node scripts/seed_field_test_dataset.js --cleanup --apply
 *
 * 選項：
 *   --lat --lon        手機目前 GPS（維護樹會種在附近 ~20–40m）
 *   --project-code     區（Block）的 project_code（與 App 場次設定一致）
 *   --species          樹種名稱（預設 台灣肖楠）
 *   --apply            寫入 DB（預設僅 dry-run）
 *   --cleanup          刪除所有 QA-FIXTURE 樹木與歷次
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { pool } = require('../config/db');

const MARKER = '[QA-FIXTURE:field-test]';

const SPECS = [
  { tag: 'HIST-1', role: '歷史（3 筆歷次）', hist: 3, dLatM: 0, dLonM: 0, h: 11.2, dbh: 32 },
  { tag: 'HIST-2', role: '歷史（2 筆歷次）', hist: 2, dLatM: 18, dLonM: -12, h: 9.5, dbh: 28 },
  { tag: 'MAINT-1', role: '維護主測', hist: 1, dLatM: 28, dLonM: 15, h: 10.8, dbh: 30 },
  { tag: 'MAINT-2', role: '維護副測', hist: 1, dLatM: -22, dLonM: 20, h: 12.1, dbh: 34 },
  { tag: 'MAINT-3', role: '維護（2 筆歷次）', hist: 2, dLatM: 12, dLonM: -30, h: 8.7, dbh: 26 },
];

function parseArgs(argv) {
  const out = { apply: false, cleanup: false, species: '台灣肖楠' };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a === '--cleanup') out.cleanup = true;
    else if (a.startsWith('--lat=')) out.lat = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--lon=')) out.lon = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--project-code=')) out.projectCode = a.split('=')[1];
    else if (a.startsWith('--species=')) out.species = a.split('=')[1];
  }
  return out;
}

function metersToOffset(lat, dLatM, dLonM) {
  const dLat = dLatM / 111320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLon = dLonM / (111320 * Math.max(cos, 0.2));
  return { dLat, dLon };
}

async function cleanupFixtures(client) {
  const { rows } = await client.query(
    `SELECT id FROM tree_survey WHERE survey_notes LIKE $1 OR tree_notes LIKE $1`,
    [`%${MARKER}%`],
  );
  if (rows.length === 0) {
    console.log('沒有 QA-FIXTURE 資料可清理。');
    return 0;
  }
  const ids = rows.map((r) => r.id);
  await client.query(
    'DELETE FROM tree_survey_measurements WHERE tree_id = ANY($1::bigint[])',
    [ids],
  );
  await client.query('DELETE FROM tree_survey WHERE id = ANY($1::bigint[])', [ids]);
  console.log(`已刪除 ${ids.length} 棵 QA-FIXTURE 樹木（含歷次）。`);
  return ids.length;
}

async function nextIds(client, projectCode) {
  await client.query('SELECT pg_advisory_xact_lock(1)');
  const sysRes = await client.query(`
    SELECT MAX(CAST(regexp_replace(system_tree_id, '[^0-9]', '', 'g') AS INTEGER)) AS max_id
    FROM tree_survey
    WHERE system_tree_id ~ '^ST-[0-9]+$'
      AND (is_placeholder IS NULL OR is_placeholder = false)
  `);
  let nextSys = (sysRes.rows[0].max_id || 0) + 1;
  let nextPt = 1;
  if (projectCode) {
    const ptRes = await client.query(
      `
      SELECT MAX(CAST(regexp_replace(project_tree_id, '[^0-9]', '', 'g') AS INTEGER)) AS max_id
      FROM tree_survey
      WHERE project_code = $1
        AND (project_tree_id ~ '^PT-[0-9]+$' OR project_tree_id ~ '^[0-9]+$')
        AND project_tree_id != 'PT-0'
        AND (is_placeholder IS NULL OR is_placeholder = false)
    `,
      [projectCode],
    );
    nextPt = (ptRes.rows[0].max_id || 0) + 1;
  }
  return { nextSys, nextPt };
}

async function resolveSpeciesId(client, speciesName) {
  const r = await client.query(
    'SELECT id FROM tree_species WHERE name = $1 OR scientific_name = $1 LIMIT 1',
    [speciesName],
  );
  return r.rows[0]?.id ?? '無';
}

async function insertTree(client, {
  projectCode,
  systemTreeId,
  projectTreeId,
  species,
  speciesId,
  lon,
  lat,
  height,
  dbh,
  tag,
  role,
  surveyTime,
}) {
  const note = `${MARKER} ${tag} ${role}`;
  const res = await client.query(
    `
    INSERT INTO tree_survey (
      project_code, system_tree_id, project_tree_id, species_id, species_name,
      x_coord, y_coord, status, notes, tree_notes, tree_height_m, dbh_cm,
      survey_notes, survey_time, carbon_storage
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'良好','無',$8,$9,$10,$11,$12,$13,NULL)
    RETURNING id, project_location, project_name
  `,
    [
      projectCode,
      systemTreeId,
      projectTreeId,
      speciesId,
      species,
      lon,
      lat,
      note,
      height,
      dbh,
      note,
      surveyTime || new Date().toISOString(),
    ],
  );
  return res.rows[0];
}

async function insertHistory(client, treeId, rows) {
  for (const h of rows) {
    await client.query(
      `
      INSERT INTO tree_survey_measurements (
        tree_id, survey_time, tree_height_m, dbh_cm, species_name,
        survey_mode, x_coord, y_coord, survey_notes, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'良好')
    `,
      [
        treeId,
        h.time,
        h.height,
        h.dbh,
        h.species,
        h.mode,
        h.lon,
        h.lat,
        `${MARKER} ${h.label}`,
      ],
    );
  }
}

function buildHistory(spec, lon, lat, species) {
  const rows = [];
  const base = new Date();
  for (let i = 0; i < spec.hist; i++) {
    const monthsAgo = (spec.hist - i) * 14;
    const t = new Date(base);
    t.setMonth(t.getMonth() - monthsAgo);
    rows.push({
      time: t.toISOString(),
      height: spec.h + i * 0.4,
      dbh: spec.dbh + i * 0.8,
      species,
      mode: i === 0 && spec.hist > 1 ? 'new' : 'maintenance',
      lon,
      lat,
      label: `歷次-${i + 1}`,
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.cleanup) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const n = await cleanupFixtures(client);
      if (args.apply) {
        await client.query('COMMIT');
        console.log('cleanup 完成。');
      } else {
        await client.query('ROLLBACK');
        console.log(`[dry-run] 將刪除 ${n} 棵（加 --apply 執行）`);
      }
    } finally {
      client.release();
      await pool.end();
    }
    return;
  }

  if (!Number.isFinite(args.lat) || !Number.isFinite(args.lon)) {
    console.error('請提供 --lat= 與 --lon=（手機 GPS 或地圖座標）');
    process.exit(2);
  }
  if (!args.projectCode) {
    console.error('請提供 --project-code=（與 App 場次「區」一致）');
    process.exit(2);
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('  現場測試資料集 seed');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  中心 GPS: ${args.lat}, ${args.lon}`);
  console.log(`  project_code: ${args.projectCode}`);
  console.log(`  模式: ${args.apply ? 'APPLY' : 'DRY-RUN（加 --apply 寫入）'}`);
  console.log('');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = [];
    let { nextSys, nextPt } = await nextIds(client, args.projectCode);

    for (const spec of SPECS) {
      const off = metersToOffset(args.lat, spec.dLatM, spec.dLonM);
      const lat = args.lat + off.dLat;
      const lon = args.lon + off.dLon;
      const systemTreeId = `ST-${nextSys++}`;
      const projectTreeId = `PT-${nextPt++}`;
      const hist = buildHistory(spec, lon, lat, args.species);
      plan.push({
        spec,
        lat,
        lon,
        systemTreeId,
        projectTreeId,
        hist,
      });
      console.log(
        `  ${spec.tag} ${spec.role} → (${lat.toFixed(6)}, ${lon.toFixed(6)}) ` +
          `${systemTreeId} / ${projectTreeId} · ${hist.length} 筆歷次`,
      );
    }

    if (!args.apply) {
      await client.query('ROLLBACK');
      console.log('\n[dry-run] 未寫入。請加 --apply 執行。');
      console.log('\nApp 測試步驟：');
      console.log('  1. flutter run --release --dart-define=ENABLE_FIELD_LOGS=true');
      console.log('  2. 維護量測 → 選相同專案／區 → 地圖應見 MAINT/HIST 測試樹');
      console.log('  3. 樹詳情 → 歷次時間軸（HIST 樹應 ≥2 筆）');
      await pool.end();
      return;
    }

    const speciesId = await resolveSpeciesId(client, args.species);
    const created = [];
    for (const p of plan) {
      const latestHist = p.hist[p.hist.length - 1];
      const row = await insertTree(client, {
        projectCode: args.projectCode,
        systemTreeId: p.systemTreeId,
        projectTreeId: p.projectTreeId,
        species: args.species,
        speciesId,
        lon: p.lon,
        lat: p.lat,
        height: latestHist.height,
        dbh: latestHist.dbh,
        tag: p.spec.tag,
        role: p.spec.role,
        surveyTime: latestHist.time,
      });
      await insertHistory(client, row.id, p.hist);
      created.push({ ...p, treeId: row.id, projectLocation: row.project_location });
    }

    await client.query('COMMIT');
    console.log('\n✓ 已建立', created.length, '棵測試樹。');
    console.log('\n| 樹 id | 標籤 | GPS | 歷次 |');
    console.log('|-------|------|-----|------|');
    for (const c of created) {
      console.log(
        `| ${c.treeId} | ${c.spec.tag} | ${c.lat.toFixed(5)},${c.lon.toFixed(5)} | ${c.hist.length} |`,
      );
    }
    console.log('\n清理：node scripts/seed_field_test_dataset.js --cleanup --apply');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
