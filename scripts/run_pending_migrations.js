/**
 * 生產環境增量 migration（schema_migrations 表）。
 * - 不匯入 tree_survey_data.csv
 * - 既有 DB 首次執行時補登記 ≤18 的歷史檔，僅跑 19+
 *
 * 全新空庫：node scripts/migrate.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { migrationFiles, viewFiles } = require('./migrate');

const BACKFILL_UNTIL = '18_project_boundaries_fk.pg.sql';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function ensureMigrationTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
}

async function appliedSet(client) {
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    return new Set(rows.map((r) => r.filename));
}

async function register(client, filename) {
    await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [filename]
    );
}

async function runSqlFile(client, file) {
    const filePath = path.join(__dirname, '../database/initial_data', file);
    if (!fs.existsSync(filePath)) {
        throw new Error(`找不到檔案: ${file}`);
    }
    const script = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    console.log(`[pending] 執行 ${file} ...`);
    await client.query(script);
    await register(client, file);
    console.log(`[pending] ${file} 完成`);
}

async function backfillHistorical(client) {
    const backfillIdx = migrationFiles.indexOf(BACKFILL_UNTIL);
    if (backfillIdx < 0) return;

    console.log('[pending] 既有 DB：補登記歷史 migration（不重新執行 SQL）');
    for (let i = 0; i <= backfillIdx; i++) {
        await register(client, migrationFiles[i]);
    }
    for (const vf of viewFiles) {
        await register(client, `view:${vf}`);
    }
}

async function main() {
    const client = await pool.connect();
    try {
        await ensureMigrationTable(client);
        let done = await appliedSet(client);

        if (done.size === 0) {
            const { rows } = await client.query(
                'SELECT COUNT(*)::int AS n FROM tree_survey'
            );
            if ((rows[0]?.n ?? 0) > 0) {
                await backfillHistorical(client);
                done = await appliedSet(client);
            }
        }

        let ran = 0;
        for (const file of migrationFiles) {
            if (done.has(file)) {
                console.log(`[pending] 跳過 ${file}`);
                continue;
            }
            await runSqlFile(client, file);
            ran++;
        }

        for (const vf of viewFiles) {
            const key = `view:${vf}`;
            if (done.has(key)) {
                console.log(`[pending] 跳過 ${key}`);
                continue;
            }
            const filePath = path.join(__dirname, '../database/initial_data', vf);
            const script = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
            console.log(`[pending] 執行 view ${vf} ...`);
            await client.query(script);
            await register(client, key);
            ran++;
        }

        console.log(`[pending] 完成，本次新套用 ${ran} 個檔案`);
    } catch (err) {
        console.error('[pending] 失敗:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = main;
