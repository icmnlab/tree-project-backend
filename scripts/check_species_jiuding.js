#!/usr/bin/env node
/** One-off: 九丁榕 vs 糖槭 DB check */
const db = require('../config/db');

(async () => {
  const sp = await db.query(`
    SELECT id, name, scientific_name FROM tree_species
    WHERE name LIKE '%九丁%' OR name LIKE '%糖槭%' OR name LIKE '%銀槭%'
       OR LOWER(scientific_name) LIKE '%acer sacchar%'
       OR LOWER(scientific_name) LIKE '%ficus nerv%'
    ORDER BY name
  `);
  console.log('=== species ===');
  sp.rows.forEach((r) => console.log(JSON.stringify(r)));

  const t = await db.query(`
    SELECT id, project_tree_id, species_id, species_name, project_id, survey_time
    FROM tree_survey
    WHERE id >= 7060 OR species_name LIKE '%九丁%' OR species_name LIKE '%糖槭%'
    ORDER BY id DESC LIMIT 20
  `);
  console.log('=== recent trees ===');
  t.rows.forEach((r) => console.log(JSON.stringify(r)));

  const p = await db.query(`
    SELECT id, species_name, survey_mode, target_tree_id, status, completed_at
    FROM pending_tree_measurements
    WHERE id IN (4,5,6) OR completed_at > NOW() - INTERVAL '2 hours'
    ORDER BY id
  `);
  console.log('=== pending ===');
  p.rows.forEach((r) => console.log(JSON.stringify(r)));

  const syn = await db.query(`
    SELECT ss.variant_name, ts.id, ts.name, ts.scientific_name
    FROM species_synonyms ss
    JOIN tree_species ts ON ts.id = ss.canonical_species_id
    WHERE ss.variant_name LIKE '%九丁%' OR ss.variant_name LIKE '%糖%'
       OR LOWER(ts.scientific_name) LIKE '%acer%'
    LIMIT 30
  `);
  console.log('=== synonyms ===');
  syn.rows.forEach((r) => console.log(JSON.stringify(r)));

  const log = await db.query(`
    SELECT action_type, species_id, details, created_at
    FROM species_merge_log
    WHERE details::text LIKE '%糖%' OR species_id = '0002'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log('=== merge_log ===');
  log.rows.forEach((r) => console.log(JSON.stringify(r)));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
