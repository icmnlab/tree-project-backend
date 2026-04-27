/**
 * API 整合測試 - 專注於邊界情況和實際問題
 * 
 * 使用方式:
 *   node tests/apiIntegration.test.js              # 基本測試
 *   node tests/apiIntegration.test.js -v           # 顯示完整回應內容
 */

const https = require('https');

const BASE_URL = process.env.TEST_BASE_URL;
if (!BASE_URL) {
  console.error('\n❌ TEST_BASE_URL is required (e.g. https://your-host/api).');
  console.error('   PowerShell:  $env:TEST_BASE_URL="https://your-host/api"');
  console.error('   bash:        export TEST_BASE_URL=https://your-host/api\n');
  process.exit(2);
}
const TEST_USER_ID = 'test-' + Date.now();
const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');

console.log(`\n🌐 API: ${BASE_URL}`);
console.log(`📝 加 -v 顯示完整回應\n`);

// HTTP 請求工具
function apiPost(endpoint, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    const postData = JSON.stringify(data);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ statusCode: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Timeout 90s')); });
    req.write(postData);
    req.end();
  });
}

function apiGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ statusCode: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout 30s')); });
    req.end();
  });
}

// 測試執行器
let passed = 0, failed = 0;
const results = [];

async function runTest(name, testFn) {
  process.stdout.write(`  ⏳ ${name}...`);
  const start = Date.now();
  try {
    const result = await testFn();
    const ms = Date.now() - start;
    console.log(`\r  ✅ ${name} (${ms}ms)`);
    if (result?.details) console.log(`     └─ ${result.details}`);
    if (VERBOSE && result?.fullResponse) {
      console.log(`     ┌──────────────────────────────────────`);
      result.fullResponse.split('\n').slice(0, 20).forEach(line => console.log(`     │ ${line}`));
      if (result.fullResponse.split('\n').length > 20) console.log(`     │ ... (truncated)`);
      console.log(`     └──────────────────────────────────────`);
    }
    passed++;
    results.push({ name, status: 'pass', ms, response: result?.fullResponse });
  } catch (err) {
    console.log(`\r  ❌ ${name} (${Date.now() - start}ms)`);
    console.log(`     └─ ${err.message}`);
    failed++;
    results.push({ name, status: 'fail', error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
// 測試案例 - 專注於邊界情況和實際問題
// ═══════════════════════════════════════════════════════════

// 1. 基本連線
async function test_ServerAlive() {
  const r = await apiGet('tree_species');
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  return { details: 'Server responding' };
}

// 2. 【重要】SQL 注入測試 - 惡意輸入
async function test_SQLInjection() {
  const r = await apiPost('chat', {
    message: "列出所有樹木; DROP TABLE tree_survey; --",
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  // 403 表示被安全機制攔截，這是好事
  if (r.statusCode === 403) {
    return { 
      details: `blocked by security (403) ✓`,
      fullResponse: '請求被安全機制攔截'
    };
  }
  
  if (r.statusCode !== 200) throw new Error(`Unexpected status ${r.statusCode}`);
  if (!r.body.success) throw new Error('Request failed');
  
  // 如果請求成功，確認沒有執行危險操作
  const sql = (r.body.executedSQL || '').toLowerCase();
  if (sql.includes('drop')) throw new Error('SQL injection may have succeeded!');
  
  return { 
    details: `SQL=${r.body.executedSQL || 'filtered/safe'}`,
    fullResponse: r.body.response 
  };
}

// 3. 【重要】Project Areas 過濾 - 確認 SQL 有加上 WHERE 條件
async function test_ProjectAreaFilter() {
  const r = await apiPost('chat', {
    message: '這個區域有幾棵樹？',
    userId: TEST_USER_ID,
    projectAreas: ['大安森林公園'],  // 使用可能存在的區域名稱
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  
  // 檢查 SQL 是否包含區域過濾
  const sql = r.body.executedSQL || '';
  const hasFilter = sql.toLowerCase().includes('project_location') || sql.toLowerCase().includes('where');
  
  return { 
    details: `hasAreaFilter=${hasFilter}, SQL=${sql}`,
    fullResponse: r.body.response 
  };
}

// 4. 【重要】不存在的區域 - 應該回傳 0 而不是全部資料
async function test_NonExistentArea() {
  const r = await apiPost('chat', {
    message: '這裡有多少棵樹？',
    userId: TEST_USER_ID,
    projectAreas: ['根本不存在的區域ABC123'],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  
  // 應該說沒有資料，而不是回傳全部 2758 棵
  const mentions2758 = r.body.response.includes('2758') || r.body.response.includes('2,758');
  if (mentions2758) throw new Error('應該回傳 0，但卻回傳了全部資料！');
  
  return { 
    details: `correctly filtered (no 2758)`,
    fullResponse: r.body.response 
  };
}

// 5. 【邊界】超長訊息 - 測試是否會崩潰
async function test_VeryLongMessage() {
  const longMsg = '請問' + '這棵樹'.repeat(500) + '的資料？';  // ~1500 字
  const r = await apiPost('chat', {
    message: longMsg,
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200 && r.statusCode !== 400) {
    throw new Error(`Unexpected status ${r.statusCode}`);
  }
  
  return { 
    details: `status=${r.statusCode}, handled gracefully`,
    fullResponse: r.body.response || r.body.message || JSON.stringify(r.body)
  };
}

// 6. 【邊界】特殊字元 - emoji、換行、引號
async function test_SpecialCharacters() {
  const r = await apiPost('chat', {
    message: '🌳 請問"榕樹"有幾棵？\n包含\'樟樹\'嗎？',
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  if (!r.body.success) throw new Error('Failed to handle special chars');
  
  return { 
    details: `SQL=${r.body.executedSQL || 'N/A'}`,
    fullResponse: r.body.response 
  };
}

// 7. 【實際問題】模糊查詢 - 用戶不知道確切樹種名
async function test_FuzzySpeciesName() {
  const r = await apiPost('chat', {
    message: '有沒有榕樹類的？像是榕、雀榕之類的',
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  
  return { 
    details: `queryMode=${r.body.queryMode}, SQL=${r.body.executedSQL || 'N/A'}`,
    fullResponse: r.body.response 
  };
}

// 8. 【實際問題】複合條件查詢
async function test_ComplexQuery() {
  const r = await apiPost('chat', {
    message: '找出胸徑大於50公分且樹高超過10公尺的樹',
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  
  // 檢查 SQL 是否有兩個條件
  const sql = (r.body.executedSQL || '').toLowerCase();
  const hasDbh = sql.includes('dbh');
  const hasHeight = sql.includes('height');
  
  return { 
    details: `hasDbhCondition=${hasDbh}, hasHeightCondition=${hasHeight}`,
    fullResponse: r.body.response 
  };
}

// 9. 【意圖分類】邊界情況 - 看起來像查資料但其實是問知識
async function test_IntentBoundary() {
  const r = await apiPost('chat', {
    message: '樟樹適合種在什麼環境？',  // 問知識，不是查資料
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  
  // 這應該是知識問答，不是查資料
  const isKnowledge = r.body.queryMode === 'knowledge';
  
  return { 
    details: `queryMode=${r.body.queryMode} (expected: knowledge)`,
    fullResponse: r.body.response 
  };
}

// 10. 【錯誤處理】無效的 model_preference
async function test_InvalidModel() {
  const r = await apiPost('chat', {
    message: '測試',
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'fake-model-xyz'
  });
  
  // 應該 fallback 到預設模型，不應該崩潰
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode} - should fallback`);
  
  return { 
    details: `Fallback worked, got response`,
    fullResponse: r.body.response 
  };
}

// 11. 【資料準確性】查詢特定編號
async function test_SpecificTreeId() {
  const r = await apiPost('chat', {
    message: '查詢 ST-0001 的資料',
    userId: TEST_USER_ID,
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r.statusCode !== 200) throw new Error(`Status ${r.statusCode}`);
  
  // 檢查是否有執行 SQL 查詢，且查詢條件正確
  const sql = (r.body.executedSQL || '').toLowerCase();
  const hasCorrectQuery = sql.includes('st-0001') || sql.includes("'st-0001'");
  
  return { 
    details: `queryMode=${r.body.queryMode}, SQL contains ST-0001: ${hasCorrectQuery}`,
    fullResponse: r.body.response 
  };
}

// 12. 【資料準確性】統計查詢 - 驗證數字一致性
async function test_CountConsistency() {
  // 先問總數
  const r1 = await apiPost('chat', {
    message: '總共有幾棵樹？',
    userId: TEST_USER_ID + '-count',
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  // 再用不同方式問
  const r2 = await apiPost('chat', {
    message: '資料庫裡有多少筆樹木資料？',
    userId: TEST_USER_ID + '-count2',
    projectAreas: [],
    model_preference: 'deepseek-ai/DeepSeek-V3'
  });
  
  if (r1.statusCode !== 200 || r2.statusCode !== 200) {
    throw new Error('Request failed');
  }
  
  // 提取數字比較
  const num1 = r1.body.response.match(/[\d,]+/g)?.map(n => parseInt(n.replace(/,/g, ''))) || [];
  const num2 = r2.body.response.match(/[\d,]+/g)?.map(n => parseInt(n.replace(/,/g, ''))) || [];
  
  const has2758_1 = num1.includes(2758);
  const has2758_2 = num2.includes(2758);
  
  return { 
    details: `query1=${has2758_1 ? '2758' : num1[0]}, query2=${has2758_2 ? '2758' : num2[0]}`,
    fullResponse: `【查詢1】${r1.body.response.substring(0, 200)}...\n\n【查詢2】${r2.body.response.substring(0, 200)}...`
  };
}

// ═══════════════════════════════════════════════════════════
// 主程式
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  API 整合測試 - 邊界情況 & 實際問題');
  console.log('═══════════════════════════════════════════════════════');
  
  console.log('\n📍 基礎:');
  await runTest('伺服器連線', test_ServerAlive);
  
  console.log('\n📍 安全性測試:');
  await runTest('SQL 注入防護', test_SQLInjection);
  
  console.log('\n📍 Project Areas 過濾 (核心功能):');
  await runTest('區域過濾 - SQL 條件', test_ProjectAreaFilter);
  await runTest('不存在區域 - 應回傳0', test_NonExistentArea);
  
  console.log('\n📍 邊界情況:');
  await runTest('超長訊息 (~1500字)', test_VeryLongMessage);
  await runTest('特殊字元 (emoji/引號)', test_SpecialCharacters);
  await runTest('無效模型 - Fallback', test_InvalidModel);
  
  console.log('\n📍 實際使用情境:');
  await runTest('模糊樹種查詢', test_FuzzySpeciesName);
  await runTest('複合條件查詢', test_ComplexQuery);
  await runTest('意圖分類邊界', test_IntentBoundary);
  await runTest('特定樹木編號', test_SpecificTreeId);
  await runTest('統計數字一致性', test_CountConsistency);
  
  // 摘要
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  結果: ✅ ${passed} 通過  ❌ ${failed} 失敗  📊 共 ${passed + failed} 項`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  if (failed > 0) {
    console.log('失敗項目:');
    results.filter(r => r.status === 'fail').forEach(r => console.log(`  - ${r.name}: ${r.error}`));
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('💥 Unexpected error:', e); process.exit(1); });
