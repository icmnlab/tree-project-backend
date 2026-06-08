#!/usr/bin/env node
/**
 * 同義詞健檢：掃出「可能對錯樹種」的 species_synonyms 列。
 *
 * 檢查項目：
 *  1) 跨屬同義詞：同義詞自帶學名的「屬」與 canonical 樹種學名的「屬」不同
 *     （例：variant 學名 Acer%，canonical 為 Ficus% → 像「糖槭→九丁榕」）。
 *  2) 跨屬撞名：同一個 variant_name 掛在兩個以上「不同屬」的樹種上。
 *  3) 孤兒：canonical_species_id 在 tree_species 找不到。
 *
 * 用法:
 *   node scripts/audit_synonyms.js          # 只報告
 *   node scripts/audit_synonyms.js --fix    # 報告 + 刪除跨屬同義詞(項目1)
 */
require('dotenv').config();
const db = require('../config/db');

const FIX = process.argv.includes('--fix');

async function main() {
  const crossGenus = await db.query(`
    SELECT ss.id, ss.variant_name, ss.scientific_name AS synonym_sci,
           ts.id AS canonical_id, ts.name AS canonical_name, ts.scientific_name AS canonical_sci
    FROM species_synonyms ss
    JOIN tree_species ts ON ts.id = ss.canonical_species_id
    WHERE ss.scientific_name IS NOT NULL
      AND ts.scientific_name IS NOT NULL
      AND LOWER(split_part(ss.scientific_name, ' ', 1))
          <> LOWER(split_part(ts.scientific_name, ' ', 1))
    ORDER BY ss.variant_name
  `);

  const sameNameDiffGenus = await db.query(`
    SELECT ss.variant_name,
           COUNT(DISTINCT LOWER(split_part(ts.scientific_name, ' ', 1))) AS genus_count,
           string_agg(DISTINCT ts.name || ' (' || COALESCE(ts.scientific_name, '?') || ')', ', ') AS canonicals
    FROM species_synonyms ss
    JOIN tree_species ts ON ts.id = ss.canonical_species_id
    WHERE ts.scientific_name IS NOT NULL
    GROUP BY ss.variant_name
    HAVING COUNT(DISTINCT LOWER(split_part(ts.scientific_name, ' ', 1))) > 1
    ORDER BY ss.variant_name
  `);

  const orphans = await db.query(`
    SELECT ss.id, ss.variant_name, ss.canonical_species_id
    FROM species_synonyms ss
    LEFT JOIN tree_species ts ON ts.id = ss.canonical_species_id
    WHERE ts.id IS NULL
  `);

  console.log('\n===== 同義詞健檢報告 =====');
  console.log(`\n[1] 跨屬同義詞（學名屬不符）：${crossGenus.rows.length} 筆`);
  crossGenus.rows.forEach((r) =>
    console.log(`  - "${r.variant_name}" (${r.synonym_sci}) → ${r.canonical_name} (${r.canonical_sci})  [synonym id=${r.id}]`),
  );

  console.log(`\n[2] 同名跨屬撞名：${sameNameDiffGenus.rows.length} 筆`);
  sameNameDiffGenus.rows.forEach((r) =>
    console.log(`  - "${r.variant_name}" → ${r.genus_count} 個屬: ${r.canonicals}`),
  );

  console.log(`\n[3] 孤兒同義詞（canonical 不存在）：${orphans.rows.length} 筆`);
  orphans.rows.forEach((r) =>
    console.log(`  - "${r.variant_name}" → 不存在的 ${r.canonical_species_id} [synonym id=${r.id}]`),
  );

  if (FIX) {
    let removed = 0;
    for (const r of crossGenus.rows) {
      await db.query('DELETE FROM species_synonyms WHERE id = $1', [r.id]);
      removed += 1;
    }
    for (const r of orphans.rows) {
      await db.query('DELETE FROM species_synonyms WHERE id = $1', [r.id]);
      removed += 1;
    }
    console.log(`\n[--fix] 已刪除 ${removed} 筆（跨屬 + 孤兒）。同名跨屬(項目2)需人工判斷，未自動處理。`);
  } else if (crossGenus.rows.length || orphans.rows.length) {
    console.log('\n提示：加 --fix 可自動刪除項目 1（跨屬）與項目 3（孤兒）。');
  }

  console.log('\n===== 完成 =====');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
