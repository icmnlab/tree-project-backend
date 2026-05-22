#!/usr/bin/env node
/**
 * Agent v2 煙霧測試：外部檢索 + 匯出
 * node scripts/test_agent_v2.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { fetchAllowedUrl, searchPublicDocuments } = require('../services/agentExternalRetrievalService');
const { runAgent } = require('../services/agentService');

const BASE = 'http://127.0.0.1:3000';

async function testTools() {
  console.log('=== fetch moenv ===');
  const f = await fetchAllowedUrl('https://www.moenv.gov.tw/');
  console.log(f.error || f.citation || f.title);

  console.log('\n=== search (optional CSE) ===');
  const s = await searchPublicDocuments({ query: '森林碳匯 調查', max_results: 3 });
  console.log(s.error || `results: ${s.results?.length}`);
}

async function testAgent(msg) {
  console.log('\n=== Agent:', msg);
  const r = await runAgent(msg, 'test-user-id', [], {
    userRole: '系統管理員',
    model: 'gpt-4o-mini',
  });
  console.log('tools:', r.toolCalls.map((t) => t.tool).join(', '));
  console.log('response:', r.response.slice(0, 500));
}

(async () => {
  await testTools();
  await testAgent('請搜尋環境部或政府網站上森林碳匯相關公開資訊，並用一段話摘要，要附引用。');
  await testAgent('請幫我匯出全部樹木調查資料的 Excel。');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
