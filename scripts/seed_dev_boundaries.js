/**
 * 開發／測試用：匯入港務 convex-hull 邊界（非 production migration）。
 * 正式上線邊界應由 App 手動繪製或匯入座標檔。
 *
 *   node scripts/seed_dev_boundaries.js
 *   node scripts/seed_dev_boundaries.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const sqlPath = path.join(__dirname, '../dev-fixtures/06_project_boundaries_seed.pg.sql');
const dryRun = process.argv.includes('--dry-run');

async function main() {
    if (!fs.existsSync(sqlPath)) {
        console.error('Missing:', sqlPath);
        process.exit(1);
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');
    if (dryRun) {
        const inserts = (sql.match(/^INSERT INTO project_boundaries/gm) || []).length;
        console.log(`[dry-run] Would run ${sqlPath} (${inserts} INSERT rows)`);
        return;
    }
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('localhost')
            ? false
            : { rejectUnauthorized: false },
    });
    const client = await pool.connect();
    try {
        await client.query(sql);
        const { rows } = await client.query(
            'SELECT COUNT(*)::int AS n FROM project_boundaries',
        );
        console.log(`Dev boundary seed applied. project_boundaries count=${rows[0].n}`);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
