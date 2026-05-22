#!/usr/bin/env node
/**
 * Quick LLM API key health check (no secrets printed).
 * Usage: node scripts/test_llm_keys.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const OpenAI = require('openai');

const SF_KEYS = [
  ['SiliconFlow_API_KEY', process.env.SiliconFlow_API_KEY],
  ['Alt1_SiliconFlow_API_KEY', process.env.Alt1_SiliconFlow_API_KEY],
  ['Alt2_SiliconFlow_API_KEY', process.env.Alt2_SiliconFlow_API_KEY],
  ['Alt3_SiliconFlow_API_KEY', process.env.Alt3_SiliconFlow_API_KEY],
].filter(([, v]) => v);

async function testSiliconFlow(name, key) {
  const client = new OpenAI({ apiKey: key, baseURL: 'https://api.siliconflow.cn/v1' });
  try {
    const r = await client.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    const text = r.choices?.[0]?.message?.content?.slice(0, 40) || '(empty)';
    console.log(`OK  ${name}: ${text}`);
    return true;
  } catch (e) {
    console.log(`FAIL ${name}: ${e.status || ''} ${e.message}`);
    return false;
  }
}

async function testGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log('SKIP GEMINI_API_KEY: missing');
    return;
  }
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent('ping');
    const text = result.response.text().slice(0, 40);
    console.log(`OK  GEMINI_API_KEY: ${text}`);
  } catch (e) {
    console.log(`FAIL GEMINI_API_KEY: ${e.status || ''} ${e.message}`);
  }
}

async function testOpenAI(name, key, baseURL) {
  const opts = { apiKey: key };
  if (baseURL) opts.baseURL = baseURL;
  const client = new OpenAI(opts);
  try {
    const r = await client.chat.completions.create({
      model: baseURL ? 'deepseek-ai/DeepSeek-V3' : 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    console.log(`OK  ${name}: ${(r.choices?.[0]?.message?.content || '').slice(0, 40)}`);
    return true;
  } catch (e) {
    console.log(`FAIL ${name}: ${e.status || ''} ${e.message}`);
    return false;
  }
}

(async () => {
  console.log('=== LLM key health check ===');
  for (const [name, key] of SF_KEYS) {
    await testSiliconFlow(name, key);
  }
  await testGemini();
  if (process.env.OPENAI_API_KEY) await testOpenAI('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
  if (process.env.Claude_API_KEY) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const c = new Anthropic({ apiKey: process.env.Claude_API_KEY });
      const r = await c.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }],
      });
      console.log(`OK  Claude_API_KEY: ${(r.content[0]?.text || '').slice(0, 40)}`);
    } catch (e) {
      console.log(`FAIL Claude_API_KEY: ${e.status || ''} ${e.message}`);
    }
  }
})();
