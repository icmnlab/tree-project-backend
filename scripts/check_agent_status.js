#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const BASE = 'http://127.0.0.1:3000';

async function login() {
  const account = process.env.TEST_ADMIN_USER;
  const password = process.env.TEST_ADMIN_PASS;
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  const data = await res.json();
  if (!data.token) throw new Error('login: ' + JSON.stringify(data));
  return data.token;
}

(async () => {
  const token = await login();
  const h = { Authorization: `Bearer ${token}` };

  const status = await fetch(`${BASE}/api/agent/status`, { headers: h });
  const statusBody = await status.json();
  console.log('=== GET /api/agent/status ===');
  console.log('HTTP', status.status);
  console.log(JSON.stringify(statusBody, null, 2));

  const models = await fetch(`${BASE}/api/agent/models`, { headers: h });
  const modelsBody = await models.json();
  console.log('\n=== GET /api/agent/models ===');
  console.log('HTTP', models.status);
  console.log(JSON.stringify(modelsBody, null, 2));

  const chat = await fetch(`${BASE}/api/agent/chat`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '系統健康檢查：請回覆 OK' }),
  });
  const chatBody = await chat.json();
  console.log('\n=== POST /api/agent/chat ===');
  console.log('HTTP', chat.status);
  console.log('response:', String(chatBody.response || chatBody.message || '').slice(0, 200));
  console.log('tokensUsed:', chatBody.tokensUsed);
  console.log('toolCalls:', (chatBody.toolCalls || []).length);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
