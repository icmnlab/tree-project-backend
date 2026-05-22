#!/usr/bin/env node
/**
 * SiliconFlow 診斷：金鑰是否存在、API 回應詳情、餘額相關錯誤
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const keys = [
  ['SiliconFlow_API_KEY', process.env.SiliconFlow_API_KEY],
  ['Alt1_SiliconFlow_API_KEY', process.env.Alt1_SiliconFlow_API_KEY],
  ['Alt2_SiliconFlow_API_KEY', process.env.Alt2_SiliconFlow_API_KEY],
  ['Alt3_SiliconFlow_API_KEY', process.env.Alt3_SiliconFlow_API_KEY],
];

console.log('=== .env 金鑰狀態 ===');
for (const [name, val] of keys) {
  if (!val) {
    console.log(`${name}: 未設定`);
  } else {
    const trimmed = val.trim();
    const hint = trimmed.slice(0, 6) + '...' + trimmed.slice(-4);
    console.log(`${name}: 已設定 (長度=${trimmed.length}, 開頭=${hint})`);
    if (trimmed !== val) console.log(`  ⚠ 含前後空白`);
    if (trimmed.startsWith('"') || trimmed.endsWith('"')) console.log(`  ⚠ 可能含引號`);
  }
}

async function probeKey(name, apiKey) {
  const url = 'https://api.siliconflow.cn/v1/chat/completions';
  const body = JSON.stringify({
    model: 'deepseek-ai/DeepSeek-V3',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 5,
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 500); }
    console.log(`\n--- ${name} ---`);
    console.log(`HTTP ${res.status}`);
    console.log('Body:', typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : parsed);
    return res.status;
  } catch (e) {
    console.log(`\n--- ${name} --- NETWORK ERROR: ${e.message}`);
    return 0;
  }
}

async function probeModels(name, apiKey) {
  try {
    const res = await fetch('https://api.siliconflow.cn/v1/models', {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    const text = await res.text();
    console.log(`\n--- ${name} GET /models ---`);
    console.log(`HTTP ${res.status}`);
    console.log('Body:', text.slice(0, 400));
  } catch (e) {
    console.log(`models probe error: ${e.message}`);
  }
}

(async () => {
  const configured = keys.filter(([, v]) => v);
  if (configured.length === 0) {
    console.log('\n❌ 沒有任何 SiliconFlow 金鑰在 .env');
    process.exit(1);
  }
  for (const [name, key] of configured) {
    await probeKey(name, key);
    await probeModels(name, key);
  }
  console.log('\n=== OPENAI 對照 ===');
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    console.log(`OpenAI /models HTTP ${res.status}`);
  } else {
    console.log('OPENAI_API_KEY: 未設定');
  }
})();
