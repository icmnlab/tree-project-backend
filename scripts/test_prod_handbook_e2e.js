/**
 * 線上 API 手冊碳儲量 E2E（需網路）
 *   node scripts/test_prod_handbook_e2e.js
 */
const BASE = process.env.TEST_BASE_URL || 'https://richardhualienserver.tail124a1b.ts.net/api';

async function main() {
    const loginRes = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            account: process.env.TEST_ADMIN_USER || 'admin',
            password: process.env.TEST_ADMIN_PASS || '12345',
            loginType: 'admin',
        }),
    });
    const login = await loginRes.json();
    if (!login.success) {
        console.error('LOGIN FAIL', login);
        process.exit(1);
    }
    const token = login.token;
    const body = {
        project_code: '98',
        project_name: '測試專案',
        species_name: '樟樹',
        tree_height_m: 12,
        dbh_cm: 35,
        x_coord: 121.5,
        y_coord: 23.8,
        status: '良好',
        survey_notes: 'handbook_e2e_smoke',
    };
    const createRes = await fetch(`${BASE}/tree_survey/create_v2`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    const created = await createRes.json();
    console.log('create status', createRes.status);
    console.log(JSON.stringify(created, null, 2));
    const local = require('../services/handbookCarbonService').calculateCarbonStorage(
        '樟樹',
        35,
        12,
    );
    const treeId = created.id;
    const getRes = await fetch(`${BASE}/tree_survey/by_id/${treeId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const got = await getRes.json();
    const row = got?.data?.[0] ?? got?.data ?? got;
    const stored = row?.carbon_storage ?? row?.['碳儲存量'];
    console.log('expected(local handbook)', local);
    console.log('stored', stored, 'treeId', treeId);
    if (stored != null && Math.abs(Number(stored) - local) < 0.02) {
        console.log('OK: server carbon matches handbook');
        process.exit(0);
    }
    console.error('MISMATCH or missing carbon_storage');
    process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
