#!/usr/bin/env node
/** One-off: check 九丁榕 vs 糖槭 in catalog */
require('dotenv').config();
const db = require('../config/db');

async function main() {
  const terms = ['九丁榕', '糖槭', 'Ficus nervosa', 'Ficus tinctoria', 'Acer saccharum'];
  for (const q of terms) {
    const { rows } = await db.query(
      `SELECT id, name, scientific_name FROM tree_species
       WHERE name ILIKE $1 OR scientific_name ILIKE $1 LIMIT 8`,
      [`%${q}%`],
    );
    console.log('\n=== tree_species', q, '===');
    rows.forEach((r) => console.log(r));
  }
  const { rows: syn } = await db.query(`
    SELECT ss.variant_name, ts.id, ts.name, ts.scientific_name
    FROM species_synonyms ss
    JOIN tree_species ts ON ts.id = ss.canonical_species_id
    WHERE ss.variant_name ILIKE '%九丁%' OR ss.variant_name ILIKE '%糖槭%'
    LIMIT 30
  `);
  console.log('\n=== synonyms ===');
  syn.forEach((r) => console.log(r));

  console.log('\n=== synonyms for 0002 ===');
  const { rows: s2 } = await db.query(`
    SELECT variant_name, source, confidence, scientific_name
    FROM species_synonyms WHERE canonical_species_id = '0002' ORDER BY variant_name
  `);
  s2.forEach((r) => console.log(r));

  const { rows: recent } = await db.query(`
    SELECT id, species_name, species_id, project_id, survey_time
    FROM tree_survey WHERE id >= 7064 ORDER BY id DESC LIMIT 5
  `);
  console.log('\n=== recent tree_survey ===');
  recent.forEach((r) => console.log(r));

  const { rows: counts } = await db.query(`
    SELECT relname, n_live_tup::bigint AS rows
    FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20
  `);
  console.log('\n=== top tables by rows ===');
  counts.forEach((r) => console.log(r));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
