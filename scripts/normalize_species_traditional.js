/**
 * 樹種名稱正規化維護腳本（簡體 → 台灣繁體 + 補無樹種編號）
 *
 * 背景：
 *   早期 Pl@ntNet 自動新增的樹種俗名為簡體（如「银枫树」），與本系統繁體中文一致性要求不符；
 *   且部分 tree_survey 記錄有 species_name 卻無 species_id（無樹種編號）。
 *   speciesIdentificationService 已在「新資料進入點」統一簡轉繁，本腳本負責「既有資料」的一次性回填。
 *
 * 動作（單一交易，預設 dry-run，需 --apply 才寫入）：
 *   A. tree_survey.species_name：簡轉繁（自由欄位，無唯一限制，直接更新）。
 *   B. tree_species.name：簡轉繁。
 *        - 無衝突 → 直接改名。
 *        - 與既有繁體樹種撞名（UNIQUE）→ 合併：把 tree_survey / species_synonyms 的 species_id
 *          指向既有繁體樹種，刪除簡體樹種列（避免重複樹種）。
 *   C. species_synonyms.variant_name：簡轉繁（撞 UNIQUE 則刪除簡體變體，保留既有繁體）。
 *   D. 補樹種編號：species_id 為空但 species_name 能對應 tree_species.name 或同義詞 → 回填 species_id。
 *
 * 用法：
 *   node scripts/normalize_species_traditional.js            # dry-run（只報告，不寫入）
 *   node scripts/normalize_species_traditional.js --apply    # 實際寫入
 *
 * 冪等：再次執行對已是繁體 / 已補號的資料為無操作。
 */
'use strict';

require('dotenv').config();
const db = require('../config/db');
const { toTraditional } = require('../utils/chineseConvert');

const APPLY = process.argv.includes('--apply');

async function tableExists(client, name) {
  try {
    await client.query(`SELECT 1 FROM ${name} LIMIT 1`);
    return true;
  } catch (e) {
    if (e.code === '42P01') return false;
    throw e;
  }
}

async function main() {
  const client = await db.pool.connect();
  const stats = {
    surveyNameConverted: 0,
    speciesRenamed: 0,
    speciesMerged: 0,
    synonymConverted: 0,
    synonymDropped: 0,
    speciesIdBackfilled: 0,
  };

  try {
    await client.query('BEGIN');

    const hasSynonyms = await tableExists(client, 'species_synonyms');

    // ---- A. tree_survey.species_name 簡轉繁 ----
    const { rows: surveyNames } = await client.query(`
      SELECT DISTINCT species_name FROM tree_survey
      WHERE species_name IS NOT NULL AND species_name <> ''
    `);
    for (const { species_name } of surveyNames) {
      const trad = toTraditional(species_name);
      if (trad !== species_name) {
        const { rowCount } = await client.query(
          'UPDATE tree_survey SET species_name = $1 WHERE species_name = $2',
          [trad, species_name],
        );
        stats.surveyNameConverted += rowCount;
        console.log(`[A] species_name 簡轉繁: "${species_name}" → "${trad}" (${rowCount} 筆)`);
      }
    }

    // ---- A2. tree_survey_measurements.species_name 簡轉繁（歷史快照一致）----
    if (await tableExists(client, 'tree_survey_measurements')) {
      const { rows: msNames } = await client.query(`
        SELECT DISTINCT species_name FROM tree_survey_measurements
        WHERE species_name IS NOT NULL AND species_name <> ''
      `);
      for (const { species_name } of msNames) {
        const trad = toTraditional(species_name);
        if (trad !== species_name) {
          const { rowCount } = await client.query(
            'UPDATE tree_survey_measurements SET species_name = $1 WHERE species_name = $2',
            [trad, species_name],
          );
          stats.surveyNameConverted += rowCount;
          console.log(`[A2] 量測歷史 species_name 簡轉繁: "${species_name}" → "${trad}" (${rowCount} 筆)`);
        }
      }
    }

    // ---- B. tree_species.name 簡轉繁（含撞名合併）----
    const { rows: speciesRows } = await client.query(
      'SELECT id, name FROM tree_species ORDER BY id',
    );
    for (const sp of speciesRows) {
      const trad = toTraditional(sp.name);
      if (trad === sp.name) continue;

      const { rows: clash } = await client.query(
        'SELECT id FROM tree_species WHERE name = $1 AND id <> $2',
        [trad, sp.id],
      );

      if (clash.length === 0) {
        await client.query('UPDATE tree_species SET name = $1 WHERE id = $2', [trad, sp.id]);
        stats.speciesRenamed++;
        console.log(`[B] tree_species 改名: ${sp.id} "${sp.name}" → "${trad}"`);
      } else {
        const keepId = clash[0].id;
        await client.query(
          'UPDATE tree_survey SET species_id = $1 WHERE species_id = $2',
          [keepId, sp.id],
        );
        if (hasSynonyms) {
          await client.query(
            'UPDATE species_synonyms SET canonical_species_id = $1 WHERE canonical_species_id = $2 ' +
              'AND NOT EXISTS (SELECT 1 FROM species_synonyms s2 WHERE s2.canonical_species_id = $1 AND s2.variant_name = species_synonyms.variant_name)',
            [keepId, sp.id],
          );
          await client.query('DELETE FROM species_synonyms WHERE canonical_species_id = $1', [sp.id]);
        }
        await client.query('DELETE FROM tree_species WHERE id = $1', [sp.id]);
        stats.speciesMerged++;
        console.log(`[B] tree_species 合併: 簡體 ${sp.id} "${sp.name}" → 既有繁體 ${keepId} "${trad}"`);
      }
    }

    // ---- C. species_synonyms.variant_name 簡轉繁 ----
    if (hasSynonyms) {
      const { rows: synRows } = await client.query(
        'SELECT canonical_species_id, variant_name FROM species_synonyms',
      );
      for (const syn of synRows) {
        const trad = toTraditional(syn.variant_name);
        if (trad === syn.variant_name) continue;
        const { rows: exists } = await client.query(
          'SELECT 1 FROM species_synonyms WHERE canonical_species_id = $1 AND variant_name = $2',
          [syn.canonical_species_id, trad],
        );
        if (exists.length === 0) {
          await client.query(
            'UPDATE species_synonyms SET variant_name = $1 WHERE canonical_species_id = $2 AND variant_name = $3',
            [trad, syn.canonical_species_id, syn.variant_name],
          );
          stats.synonymConverted++;
          console.log(`[C] 同義詞簡轉繁: "${syn.variant_name}" → "${trad}"`);
        } else {
          await client.query(
            'DELETE FROM species_synonyms WHERE canonical_species_id = $1 AND variant_name = $2',
            [syn.canonical_species_id, syn.variant_name],
          );
          stats.synonymDropped++;
          console.log(`[C] 同義詞去重: 刪除簡體 "${syn.variant_name}"（繁體 "${trad}" 已存在）`);
        }
      }
    }

    // ---- D. 補無樹種編號（species_id 為空，但 species_name 可對應目錄）----
    const synJoin = hasSynonyms
      ? `LEFT JOIN species_synonyms ss ON ss.variant_name = ts_name.species_name`
      : '';
    const { rows: backfill } = await client.query(`
      WITH ts_name AS (
        SELECT id, species_name FROM tree_survey
        WHERE (species_id IS NULL OR species_id = '')
          AND species_name IS NOT NULL AND species_name <> ''
      )
      SELECT ts_name.id,
             ts_name.species_name,
             sp.id AS sp_id
             ${hasSynonyms ? ', ss.canonical_species_id AS syn_id' : ''}
      FROM ts_name
      LEFT JOIN tree_species sp ON sp.name = ts_name.species_name
      ${synJoin}
    `);
    for (const row of backfill) {
      const resolvedId = row.sp_id || row.syn_id || null;
      if (!resolvedId) continue;
      await client.query('UPDATE tree_survey SET species_id = $1 WHERE id = $2', [resolvedId, row.id]);
      stats.speciesIdBackfilled++;
      console.log(`[D] 補樹種編號: survey ${row.id} "${row.species_name}" → species_id=${resolvedId}`);
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log('\n已套用變更 (COMMIT)。');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY-RUN（未寫入）。加上 --apply 才會實際更新。');
    }

    console.log('\n=== 統計 ===');
    console.table(stats);
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('正規化失敗，已 ROLLBACK:', e);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
