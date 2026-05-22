/**
 * End-to-end API smoke test for AI chat + sustainability report.
 * Run on server: node scripts/test_api_ai.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Always hit local PM2 from the server (avoids Tailscale TLS issues in smoke tests)
const BASE = 'http://127.0.0.1:3000';

async function login() {
  const user = process.env.TEST_ADMIN_USER || process.env.TEST_SURVEY_USER;
  const pass = process.env.TEST_ADMIN_PASS || process.env.TEST_SURVEY_PASS;
  if (!user || !pass) throw new Error('TEST_SURVEY_USER/PASS not set');
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: user, password: pass }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('login failed: ' + JSON.stringify(data));
  return data.token;
}

async function main() {
  const token = await login();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: '你好，請用一句話介紹碳匯',
      model_preference: 'deepseek-ai/DeepSeek-V3',
      session_id: 'test-' + Date.now(),
    }),
  });
  const chatBody = await chatRes.json();
  console.log('CHAT status=' + chatRes.status);
  const chatText = chatBody.response || chatBody.message || JSON.stringify(chatBody).slice(0, 200);
  console.log('CHAT preview=' + String(chatText).slice(0, 120));

  const reportRes = await fetch(`${BASE}/api/reports/ai-sustainability`, { headers });
  const reportBody = await reportRes.json();
  console.log('REPORT status=' + reportRes.status);
  const ai = reportBody?.aiAnalysis || reportBody?.data?.aiAnalysis || '';
  console.log('REPORT aiAnalysis len=' + (typeof ai === 'string' ? ai.length : 0));
  if (typeof ai === 'string' && ai.includes('403')) {
    console.log('REPORT still has 403 in text');
    process.exit(1);
  }
  const agentRes = await fetch(`${BASE}/api/agent/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: '全專案共有幾棵樹？' }),
  });
  const agentBody = await agentRes.json();
  console.log('AGENT status=' + agentRes.status);
  console.log('AGENT preview=' + String(agentBody.response || agentBody.message || '').slice(0, 120));

  if (chatRes.status !== 200 || reportRes.status !== 200 || agentRes.status !== 200) process.exit(1);
  console.log('ALL OK');
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
