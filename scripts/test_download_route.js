/**
 * 測試匯出檔寫入與 /api/download 下載
 * node scripts/test_download_route.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { toolExportExcel } = require('../services/agentExportService');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

async function login() {
    const user = process.env.TEST_SURVEY_USER;
    const pass = process.env.TEST_SURVEY_PASS;
    if (!user || !pass) throw new Error('TEST_SURVEY_USER/PASS not set');
    const res = await fetch(`${BASE}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass, loginType: '調查員' }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) throw new Error('login failed');
    return data.token;
}

(async () => {
    const exp = await toolExportExcel({
        userId: 'test',
        userRole: '系統管理員',
        project_area: '高雄港',
    });
    console.log('export:', exp);
    if (exp.error) process.exit(1);

    const rel = exp.downloadUrl;
    const url = rel.startsWith('http') ? rel : `${BASE.replace(/\/api\/?$/, '')}${rel}`;
    console.log('download URL:', url);

    const token = await login().catch(() => null);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(url, { headers });
    console.log('GET status:', res.status, res.headers.get('content-type'));
    const buf = Buffer.from(await res.arrayBuffer());
    console.log('bytes:', buf.length);
    if (res.status !== 200 || buf.length < 100) process.exit(1);
    console.log('OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
