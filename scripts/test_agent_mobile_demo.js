#!/usr/bin/env node
/**
 * 手機 demo 用 API 測試（localhost）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const BASE = 'http://127.0.0.1:3000';

async function login() {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account: process.env.TEST_ADMIN_USER,
      password: process.env.TEST_ADMIN_PASS,
    }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(JSON.stringify(data));
  return data.token;
}

async function agent(token, message) {
  const res = await fetch(`${BASE}/api/agent/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sessionId: `demo_${Date.now()}` }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

(async () => {
  const token = await login();
  const tests = [
    '請搜尋政府網站上「森林碳匯」相關公開文件，摘要並附引用來源。',
    '請幫我匯出台中港的樹木調查 Excel 報表。',
  ];
  for (const msg of tests) {
    console.log('\n---', msg);
    const { status, data } = await agent(token, msg);
    console.log('HTTP', status);
    console.log('tools:', (data.toolCalls || []).map((t) => t.tool).join(', '));
    console.log('response:', (data.response || data.error || '').slice(0, 600));
  }
  console.log('\nALL DONE');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
