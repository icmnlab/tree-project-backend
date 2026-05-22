#!/usr/bin/env node
/**
 * 嘗試查 OpenAI 額度／用量（依 API 可用端點）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log('OPENAI_API_KEY: 未設定');
  process.exit(1);
}

async function get(path) {
  const res = await fetch(`https://api.openai.com${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

(async () => {
  console.log('=== OpenAI 帳戶查詢 ===\n');

  // 舊版 billing credit grants（部分帳戶仍可用）
  let r = await get('/v1/dashboard/billing/credit_grants');
  console.log('credit_grants:', r.status);
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      const grants = j.grants?.data || j.data || [];
      let total = 0;
      let used = 0;
      for (const g of grants) {
        total += g.grant_amount || 0;
        used += g.used_amount || 0;
      }
      console.log('  贈送/預付總額 (USD):', (total / 100).toFixed(2));
      console.log('  已使用 (USD):', (used / 100).toFixed(2));
      console.log('  剩餘 (USD):', ((total - used) / 100).toFixed(2));
      console.log('  明細筆數:', grants.length);
    } catch {
      console.log(' ', r.body.slice(0, 300));
    }
  } else {
    console.log(' ', r.body.slice(0, 200));
  }

  // Subscription（月付帳戶）
  r = await get('/v1/dashboard/billing/subscription');
  console.log('\nsubscription:', r.status);
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      const s = j;
      console.log('  hard_limit_usd:', s.hard_limit_usd);
      console.log('  soft_limit_usd:', s.soft_limit_usd);
      console.log('  has_payment_method:', s.has_payment_method);
      console.log('  system_hard_limit_usd:', s.system_hard_limit_usd);
    } catch {
      console.log(' ', r.body.slice(0, 300));
    }
  } else {
    console.log(' ', r.body.slice(0, 200));
  }

  // 本月用量（分鐘級，可能 404）
  const today = new Date().toISOString().slice(0, 10);
  r = await get(`/v1/usage?date=${today}`);
  console.log('\nusage (今日):', r.status);
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      console.log('  今日用量 (USD):', ((j.total_usage || 0) / 100).toFixed(4));
    } catch {
      console.log(' ', r.body.slice(0, 300));
    }
  } else {
    console.log(' ', r.body.slice(0, 200));
  }

  // 近 7 日加總
  let weekTotal = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const day = await get(`/v1/usage?date=${ds}`);
    if (day.status === 200) {
      try {
        weekTotal += JSON.parse(day.body).total_usage || 0;
      } catch { /* ignore */ }
    }
  }
  console.log('  近 7 日累計 (USD):', (weekTotal / 100).toFixed(4));

  console.log('\n若以上皆失敗，請至 https://platform.openai.com/settings/organization/billing 查看餘額。');
})();
