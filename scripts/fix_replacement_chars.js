#!/usr/bin/env node
/**
 * fix_replacement_chars.js
 *
 * One-shot data repair script for U+FFFD (REPLACEMENT CHARACTER) pollution
 * caused by previous Buffer.toString('utf-8') silent fallback bugs.
 *
 * Strategy:
 *   1. Scan tree_survey.project_name, tree_species.name, projects.name,
 *      project_areas.area_name for U+FFFD.
 *   2. Apply the known-good repair table (verified against the original CSV
 *      and SQL exports). Anything not in the table is reported but NOT
 *      modified — caller must investigate manually.
 *   3. Run with --apply to commit; default is dry-run.
 *
 * Usage:
 *   node scripts/fix_replacement_chars.js          # dry-run (default)
 *   node scripts/fix_replacement_chars.js --apply  # commit changes
 */

require('dotenv').config();
const db = require('../config/db');

const REPLACEMENT_CHAR = '\uFFFD';

/**
 * Verified repairs (raw → fixed). Keys are the actual polluted strings as
 * stored in the DB; values are the human-verified correct strings.
 * Adding new entries: confirm against original CSV + SQL backup before
 * committing.
 */
const REPAIRS = [
    // --- tree_survey.project_name ---
    { table: 'tree_survey', column: 'project_name', from: '台中港植栽第\uFFFD\uFFFD區', to: '台中港植栽第二區' },
    { table: 'tree_survey', column: 'project_name', from: '\uFFFD\uFFFD\uFFFD中港植栽第四區', to: '台中港植栽第四區' },

    // --- tree_species.name ---
    { table: 'tree_species', column: 'name', from: '臺灣\uFFFD\uFFFD\uFFFD樹', to: '臺灣欒樹' },
];

function parseArgs() {
    const args = process.argv.slice(2);
    return {
        apply: args.includes('--apply'),
        verbose: args.includes('--verbose'),
    };
}

async function scanTable(client, table, column, idColumn = 'id') {
    const sql = `
        SELECT ${idColumn} AS id, ${column} AS value
        FROM ${table}
        WHERE ${column} LIKE '%' || $1 || '%'
    `;
    const { rows } = await client.query(sql, [REPLACEMENT_CHAR]);
    return rows;
}

async function applyRepair(client, repair) {
    const { table, column, from, to } = repair;
    const sql = `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2 RETURNING *`;
    const { rows, rowCount } = await client.query(sql, [to, from]);
    return { rowCount, rows };
}

async function main() {
    const { apply, verbose } = parseArgs();
    const mode = apply ? 'APPLY' : 'DRY-RUN';
    console.log(`========================================`);
    console.log(`fix_replacement_chars.js — mode: ${mode}`);
    console.log(`========================================\n`);

    const client = await db.pool.connect();
    try {
        // Phase 1: scan all known target columns
        const targets = [
            { table: 'tree_survey', column: 'project_name', idColumn: 'id' },
            { table: 'tree_survey', column: 'project_location', idColumn: 'id' },
            { table: 'tree_species', column: 'name', idColumn: 'id' },
            { table: 'projects', column: 'name', idColumn: 'id' },
            { table: 'project_areas', column: 'area_name', idColumn: 'id' },
        ];

        const polluted = [];
        for (const t of targets) {
            try {
                const rows = await scanTable(client, t.table, t.column, t.idColumn);
                for (const r of rows) {
                    polluted.push({ ...t, id: r.id, value: r.value });
                }
            } catch (e) {
                console.warn(`[scan] skip ${t.table}.${t.column}: ${e.message}`);
            }
        }

        if (polluted.length === 0) {
            console.log('✅ 沒有發現 U+FFFD 污染，無需修復。');
            return;
        }

        console.log(`發現 ${polluted.length} 筆污染：`);
        for (const p of polluted) {
            const repair = REPAIRS.find(r => r.table === p.table && r.column === p.column && r.from === p.value);
            const status = repair ? `→ "${repair.to}"` : '⚠ 無對照表，需人工處理';
            console.log(`  [${p.table}.${p.column}#${p.id}] "${p.value}" ${status}`);
        }
        console.log('');

        // Phase 2: apply repairs
        if (!apply) {
            console.log('（DRY-RUN，未變更資料庫。確認後加 --apply 執行）');
            return;
        }

        console.log(`套用修復...`);
        await client.query('BEGIN');
        let totalUpdated = 0;
        for (const repair of REPAIRS) {
            const result = await applyRepair(client, repair);
            if (result.rowCount > 0) {
                console.log(`  ✓ ${repair.table}.${repair.column}: ${result.rowCount} 筆 → "${repair.to}"`);
                totalUpdated += result.rowCount;
            }
        }
        await client.query('COMMIT');
        console.log(`\n完成：共更新 ${totalUpdated} 筆。`);

        // Re-scan
        console.log('\n驗證...');
        let stillPolluted = 0;
        for (const t of targets) {
            try {
                const rows = await scanTable(client, t.table, t.column, t.idColumn);
                stillPolluted += rows.length;
                if (rows.length > 0) {
                    console.log(`  ⚠ ${t.table}.${t.column} 仍有 ${rows.length} 筆需人工處理`);
                }
            } catch (_) {}
        }
        if (stillPolluted === 0) {
            console.log('  ✅ 全部乾淨。');
        }
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('修復失敗，已 ROLLBACK:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await db.pool.end();
    }
}

main();
