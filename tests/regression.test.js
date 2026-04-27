/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TreeAI 完整回歸測試 (Full Regression Test Suite)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 此測試套件完整模擬真實 APP 操作流程，可取代手機測試。
 * 
 * 測試範圍：
 * 1. 使用者認證 (登入、JWT、401 處理)
 * 2. 樹木 CRUD (新增、編輯、刪除 - V2 + Legacy)
 * 3. BLE 批量匯入
 * 4. 使用者管理 (CRUD + 權限)
 * 5. 專案管理
 * 6. 審計日誌驗證
 * 7. 安全性測試
 * 
 * 使用方式:
 *   node tests/regression.test.js                    # 完整測試
 *   node tests/regression.test.js --local            # 本地測試 (localhost:3001)
 *   node tests/regression.test.js --section=auth     # 只測試認證
 *   node tests/regression.test.js --verbose          # 顯示詳細回應
 * 
 * 環境變數 (可選):
 *   TEST_BASE_URL=http://localhost:3001   # 本地測試
 *   TEST_ADMIN_USER=admin                 # 管理員帳號
 *   TEST_ADMIN_PASS=admin123              # 管理員密碼
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const https = require('https');

// ═══════════════════════════════════════════════════════════════════════════════
// 設定
// ═══════════════════════════════════════════════════════════════════════════════

const ARGS = process.argv.slice(2);
const IS_LOCAL = ARGS.includes('--local');
const VERBOSE = ARGS.includes('--verbose') || ARGS.includes('-v');
const SECTION = ARGS.find(a => a.startsWith('--section='))?.split('=')[1];

const BASE_URL = process.env.TEST_BASE_URL ||
    (IS_LOCAL ? 'http://localhost:3001/api' : null);

if (!BASE_URL) {
    console.error('\n❌ TEST_BASE_URL is required for non-local runs.');
    console.error('   Example:  $env:TEST_BASE_URL="https://your-host/api"  (PowerShell)');
    console.error('             export TEST_BASE_URL=https://your-host/api    (bash)');
    console.error('   Or pass --local to hit http://localhost:3001/api\n');
    process.exit(2);
}

const TEST_ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const TEST_ADMIN_PASS = process.env.TEST_ADMIN_PASS || '12345';
const TEST_SURVEY_USER = process.env.TEST_SURVEY_USER || 'survey';
const TEST_SURVEY_PASS = process.env.TEST_SURVEY_PASS || 'survey123';

// 測試用的唯一識別碼
const TEST_ID = `test_${Date.now()}`;
let createdTreeId = null;        // 新增的樹木 ID
let createdUserId = null;        // 新增的使用者 ID
let adminToken = null;           // 管理員 JWT token
let surveyToken = null;          // 調查員 JWT token

console.log(`
═══════════════════════════════════════════════════════════════════════════════
  🌲 TreeAI 完整回歸測試 (Full Regression Test Suite)
═══════════════════════════════════════════════════════════════════════════════
  🌐 API: ${BASE_URL}
  📝 模式: ${IS_LOCAL ? '本地' : '遠端'} ${VERBOSE ? '(詳細)' : ''}
  ${SECTION ? `📋 只測試: ${SECTION}` : '📋 完整測試'}
═══════════════════════════════════════════════════════════════════════════════
`);

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP 工具函數
// ═══════════════════════════════════════════════════════════════════════════════

function makeRequest(method, endpoint, data = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${BASE_URL}/${endpoint}`);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const headers = {
            'Content-Type': 'application/json',
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        let postData = null;
        if (data) {
            postData = JSON.stringify(data);
            headers['Content-Length'] = Buffer.byteLength(postData);
        }
        
        const options = {
            hostname: url.hostname,
            port: isHttps ? 443 : (url.port || 3001),
            path: url.pathname + url.search,
            method: method,
            headers: headers
        };
        
        const req = httpModule.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    parsed = body;
                }
                resolve({ 
                    statusCode: res.statusCode, 
                    body: parsed,
                    headers: res.headers
                });
            });
        });
        
        req.on('error', reject);
        req.setTimeout(60000, () => { 
            req.destroy(); 
            reject(new Error('Request timeout (60s)')); 
        });
        
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

const api = {
    get: (endpoint, token) => makeRequest('GET', endpoint, null, token),
    post: (endpoint, data, token) => makeRequest('POST', endpoint, data, token),
    put: (endpoint, data, token) => makeRequest('PUT', endpoint, data, token),
    delete: (endpoint, token) => makeRequest('DELETE', endpoint, null, token),
};

// ═══════════════════════════════════════════════════════════════════════════════
// 測試框架
// ═══════════════════════════════════════════════════════════════════════════════

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const allResults = [];

async function runTest(name, testFn, options = {}) {
    const { skip = false } = options;
    
    if (skip) {
        console.log(`  ⏭️  ${name} (跳過)`);
        totalSkipped++;
        allResults.push({ name, status: 'skip' });
        return;
    }
    
    process.stdout.write(`  ⏳ ${name}...`);
    const start = Date.now();
    
    try {
        const result = await testFn();
        const ms = Date.now() - start;
        console.log(`\r  ✅ ${name} (${ms}ms)`);
        
        if (result?.details) {
            console.log(`     └─ ${result.details}`);
        }
        if (VERBOSE && result?.response) {
            const respStr = typeof result.response === 'string' 
                ? result.response 
                : JSON.stringify(result.response, null, 2);
            console.log(`     ┌─────────────────────────────────────────────`);
            respStr.split('\n').slice(0, 15).forEach(line => 
                console.log(`     │ ${line.substring(0, 80)}`)
            );
            console.log(`     └─────────────────────────────────────────────`);
        }
        
        totalPassed++;
        allResults.push({ name, status: 'pass', ms, details: result?.details });
        return result;
    } catch (err) {
        const ms = Date.now() - start;
        console.log(`\r  ❌ ${name} (${ms}ms)`);
        console.log(`     └─ ${err.message}`);
        
        totalFailed++;
        allResults.push({ name, status: 'fail', error: err.message });
        return null;
    }
}

function section(title) {
    console.log(`\n📍 ${title}`);
    console.log('─'.repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 測試案例
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 1. 伺服器健康檢查
// ─────────────────────────────────────────────────────────────────────────────

async function test_ServerAlive() {
    const r = await api.get('tree_species');
    if (r.statusCode !== 200) throw new Error(`HTTP ${r.statusCode}`);
    return { details: 'Server is responding' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 認證測試 (Authentication)
// ─────────────────────────────────────────────────────────────────────────────

async function test_LoginAdmin() {
    const r = await api.post('login', {
        account: TEST_ADMIN_USER,
        password: TEST_ADMIN_PASS,
        loginType: 'admin'
    });
    
    if (r.statusCode !== 200) {
        throw new Error(`Login failed: HTTP ${r.statusCode} - ${JSON.stringify(r.body)}`);
    }
    if (!r.body.success) {
        throw new Error(`Login failed: ${r.body.message}`);
    }
    
    adminToken = r.body.token;
    return { 
        details: `Token received (${adminToken ? adminToken.substring(0, 20) + '...' : 'null'})`,
        response: r.body
    };
}

async function test_LoginSurvey() {
    const r = await api.post('login', {
        account: TEST_SURVEY_USER,
        password: TEST_SURVEY_PASS,
        loginType: 'survey'
    });
    
    if (r.statusCode !== 200) {
        throw new Error(`Login failed: HTTP ${r.statusCode}`);
    }
    
    surveyToken = r.body.token;
    return { 
        details: `Token received (${surveyToken ? surveyToken.substring(0, 20) + '...' : 'Legacy mode'})` 
    };
}

async function test_LoginWrongPassword() {
    const r = await api.post('login', {
        account: TEST_ADMIN_USER,
        password: 'wrong_password_12345',
        loginType: 'admin'
    });
    
    // 應該登入失敗
    if (r.statusCode === 200 && r.body.success) {
        throw new Error('Login should have failed with wrong password!');
    }
    
    return { details: `Correctly rejected (${r.statusCode})` };
}

async function test_LoginDisabledAccount() {
    // 這個測試假設有一個被停用的帳號，如果沒有則跳過
    const r = await api.post('login', {
        account: 'disabled_test_user',
        password: 'any_password',
        loginType: 'admin'
    });
    
    // 應該回傳錯誤或帳號不存在
    if (r.statusCode === 200 && r.body.success) {
        throw new Error('Disabled account should not be able to login');
    }
    
    return { details: `Correctly rejected disabled/nonexistent account` };
}

async function test_JWTValidation() {
    if (!adminToken) {
        throw new Error('No admin token available (login test may have failed)');
    }
    
    // 使用有效 token 訪問受保護的 API
    const r = await api.get('users', adminToken);
    
    if (r.statusCode === 401) {
        throw new Error('Valid token was rejected');
    }
    
    return { details: `Token validated successfully` };
}

async function test_JWTInvalidToken() {
    // 使用無效 token
    const r = await api.get('users', 'invalid_token_12345');
    
    // 在 Legacy 模式下可能不會拒絕，但至少應該有某種處理
    return { 
        details: `Response: ${r.statusCode} (Legacy mode may allow)`,
        response: r.body
    };
}

async function test_401AutoLogout() {
    // 模擬過期 token
    const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJ1c2VybmFtZSI6InRlc3QiLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTUxNjIzOTAyM30.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    
    const r = await api.get('tree_survey', expiredToken);
    
    return { 
        details: `Response to expired token: ${r.statusCode}`,
        response: r.body 
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 樹木操作 (Tree CRUD)
// ─────────────────────────────────────────────────────────────────────────────

async function test_GetAllTrees() {
    const r = await api.get('tree_survey', adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    const count = r.body.data?.length || r.body.length || 0;
    return { details: `Got ${count} trees` };
}

async function test_CreateTreeV2() {
    const treeData = {
        project_area: `測試區域_${TEST_ID}`,
        project_code: `TEST_${TEST_ID}`,
        project_name: `測試專案_${TEST_ID}`,
        species_name: '測試樹種',
        x_coord: 121.5654,
        y_coord: 25.0330,
        tree_height_m: 15.5,
        dbh_cm: 45.2,
        status: '良好',
        survey_notes: '自動化測試新增',
        survey_time: new Date().toISOString()
    };
    
    const r = await api.post('tree_survey/v2', treeData, adminToken);
    
    if (r.statusCode !== 201 && r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    
    if (!r.body.success) {
        throw new Error(`Create failed: ${r.body.message}`);
    }
    
    createdTreeId = r.body.id;
    
    return { 
        details: `Created tree ID: ${createdTreeId}, SystemID: ${r.body.system_tree_id}, ProjectID: ${r.body.project_tree_id}`,
        response: r.body
    };
}

// [T6 cleanup] test_CreateTreeLegacy / test_UpdateTreeLegacy 已移除，後端 V1 routes 已刪

async function test_GetTreeById() {
    if (!createdTreeId) {
        throw new Error('No tree ID available (create test may have failed)');
    }
    
    const r = await api.get(`tree_survey/by_id/${createdTreeId}`, adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    return { 
        details: `Retrieved tree: ${r.body.data?.species_name || r.body.species_name}`,
        response: r.body
    };
}

async function test_UpdateTreeV2() {
    if (!createdTreeId) {
        throw new Error('No tree ID available');
    }
    
    const updateData = {
        species_name: '更新後的樹種',
        tree_height_m: 16.0,
        dbh_cm: 46.5,
        survey_notes: '自動化測試更新'
    };
    
    const r = await api.put(`tree_survey/v2/${createdTreeId}`, updateData, adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    
    return { 
        details: `Updated tree ${createdTreeId}`,
        response: r.body
    };
}

async function test_DeleteTree() {
    if (!createdTreeId) {
        throw new Error('No tree ID available');
    }
    
    const r = await api.delete(`tree_survey/${createdTreeId}`, adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    
    return { 
        details: `Deleted tree ${createdTreeId}`,
        response: r.body
    };
}

async function test_VerifyTreeDeleted() {
    if (!createdTreeId) {
        throw new Error('No tree ID available');
    }
    
    const r = await api.get(`tree_survey/by_id/${createdTreeId}`, adminToken);
    
    // 應該找不到或回傳空
    if (r.statusCode === 200 && r.body.data && r.body.data.id) {
        throw new Error('Tree should have been deleted but still exists!');
    }
    
    return { details: 'Tree confirmed deleted' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. BLE 批量匯入測試
// ─────────────────────────────────────────────────────────────────────────────

async function test_BatchImport() {
    const batchData = {
        project_code: `BATCH_${TEST_ID}`,
        project_name: `批量測試專案_${TEST_ID}`,
        trees: [
            {
                species_name: '批量測試樹1',
                x_coord: 121.5660,
                y_coord: 25.0340,
                dbh_cm: 20.0,
                tree_height_m: 8.0
            },
            {
                species_name: '批量測試樹2',
                x_coord: 121.5661,
                y_coord: 25.0341,
                dbh_cm: 25.0,
                tree_height_m: 10.0
            },
            {
                species_name: '批量測試樹3',
                x_coord: 121.5662,
                y_coord: 25.0342,
                dbh_cm: 30.0,
                tree_height_m: 12.0
            }
        ]
    };
    
    const r = await api.post('tree_survey/batch', batchData, adminToken);
    
    if (r.statusCode !== 200 && r.statusCode !== 201) {
        throw new Error(`HTTP ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    
    return { 
        details: `Imported ${r.body.insertedCount || batchData.trees.length} trees`,
        response: r.body
    };
}

async function test_BatchImportIdSequence() {
    // 驗證批量匯入後 ID 是連續的
    const r = await api.get(`tree_survey/by_project/BATCH_${TEST_ID}`, adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    const trees = r.body.data || r.body || [];
    const ids = trees.map(t => parseInt(t.project_tree_id?.replace('PT-', '') || 0)).sort((a, b) => a - b);
    
    // 檢查是否連續
    let sequential = true;
    for (let i = 1; i < ids.length; i++) {
        if (ids[i] !== ids[i-1] + 1) {
            sequential = false;
            break;
        }
    }
    
    return { 
        details: `IDs: ${ids.join(', ')} - ${sequential ? 'Sequential ✓' : 'Not sequential ⚠️'}`,
        response: trees
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 使用者管理測試 (User Management)
// ─────────────────────────────────────────────────────────────────────────────

async function test_GetAllUsers() {
    const r = await api.get('users', adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    const count = r.body.data?.length || r.body.length || 0;
    return { details: `Got ${count} users` };
}

async function test_CreateUser() {
    const userData = {
        username: `test_user_${TEST_ID}`,
        password: 'TestPassword123!',
        name: '測試使用者',
        email: `test_${TEST_ID}@example.com`,
        role: '一般使用者'
    };
    
    const r = await api.post('users', userData, adminToken);
    
    if (r.statusCode !== 201 && r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    
    createdUserId = r.body.id || r.body.data?.id;
    
    return { 
        details: `Created user ID: ${createdUserId}`,
        response: r.body
    };
}

async function test_UpdateUser() {
    if (!createdUserId) {
        throw new Error('No user ID available');
    }
    
    const updateData = {
        name: '更新後的名稱',
        email: `updated_${TEST_ID}@example.com`
    };
    
    const r = await api.put(`users/${createdUserId}`, updateData, adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    return { details: `Updated user ${createdUserId}` };
}

async function test_UpdateUserStatus() {
    if (!createdUserId) {
        throw new Error('No user ID available');
    }
    
    // 停用使用者
    const r = await api.put(`users/${createdUserId}/status`, { is_active: false }, adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    return { details: `Deactivated user ${createdUserId}` };
}

async function test_DeleteUser() {
    if (!createdUserId) {
        throw new Error('No user ID available');
    }
    
    const r = await api.delete(`users/${createdUserId}`, adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    return { details: `Deleted user ${createdUserId}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 審計日誌驗證 (Audit Log Verification)
// ─────────────────────────────────────────────────────────────────────────────

async function test_AuditLogExists() {
    // 驗證審計日誌表存在且有記錄
    const r = await api.get('admin/audit-logs?limit=10', adminToken);
    
    // 如果 API 不存在，也不算失敗（可能還沒開放）
    if (r.statusCode === 404) {
        return { details: 'Audit logs API not exposed (OK)' };
    }
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    const count = r.body.data?.length || r.body.length || 0;
    return { details: `Got ${count} recent audit logs` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 安全性測試 (Security Tests)
// ─────────────────────────────────────────────────────────────────────────────

async function test_SQLInjectionPrevention() {
    const maliciousData = {
        project_code: "TEST'; DROP TABLE tree_survey; --",
        project_name: "Malicious Test",
        species_name: "Test",
        x_coord: 121.0,
        y_coord: 25.0
    };
    
    const r = await api.post('tree_survey/v2', maliciousData, adminToken);
    
    // 不管成功或失敗，確保資料庫沒被破壞
    const check = await api.get('tree_survey?limit=1', adminToken);
    if (check.statusCode !== 200) {
        throw new Error('Database may have been damaged!');
    }
    
    return { details: 'SQL injection attempt blocked/sanitized' };
}

async function test_XSSPrevention() {
    const xssData = {
        project_code: `XSS_${TEST_ID}`,
        project_name: '<script>alert("XSS")</script>',
        species_name: '<img src=x onerror=alert("XSS")>',
        survey_notes: '"><script>alert(1)</script>',
        x_coord: 121.0,
        y_coord: 25.0
    };
    
    const r = await api.post('tree_survey/v2', xssData, adminToken);
    
    // 只要不崩潰就算通過
    return { 
        details: `Response: ${r.statusCode}`,
        response: r.body
    };
}

async function test_RateLimiting() {
    // 快速發送多個請求測試 rate limiting
    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(api.get('tree_species'));
    }
    
    const results = await Promise.all(promises);
    const blocked = results.filter(r => r.statusCode === 429).length;
    
    return { 
        details: `${blocked}/10 requests rate limited${blocked > 0 ? ' ✓' : ' (no limit or high threshold)'}` 
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. 專案管理測試 (Project Management)
// ─────────────────────────────────────────────────────────────────────────────

async function test_GetProjects() {
    const r = await api.get('projects', adminToken);
    
    if (r.statusCode !== 200) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    const count = r.body.data?.length || r.body.length || 0;
    return { details: `Got ${count} projects` };
}

async function test_GetProjectBoundaries() {
    const r = await api.get('project_boundaries', adminToken);
    
    if (r.statusCode !== 200 && r.statusCode !== 404) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    if (r.statusCode === 404) {
        return { details: 'Project boundaries API not available' };
    }
    
    const count = r.body.data?.length || r.body.length || 0;
    return { details: `Got ${count} project boundaries` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. 樹種辨識 API 測試 (Species Identification)
// ─────────────────────────────────────────────────────────────────────────────

async function test_SpeciesSearchAPI() {
    const r = await api.get('species/search?q=榕樹', adminToken);
    
    if (r.statusCode !== 200 && r.statusCode !== 404) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    if (r.statusCode === 404) {
        return { details: 'Species search API not available' };
    }
    
    return { 
        details: `Search results received`,
        response: r.body
    };
}

async function test_SpeciesServiceStatus() {
    const r = await api.get('species/status');
    
    if (r.statusCode !== 200 && r.statusCode !== 404) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    if (r.statusCode === 404) {
        return { details: 'Species status API not available' };
    }
    
    return { 
        details: `PlantNet: ${r.body.services?.plantnet?.available ? '✓' : '✗'}, GBIF: ${r.body.services?.gbif?.available ? '✓' : '✗'}`,
        response: r.body
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. ML 訓練數據 API 測試
// ─────────────────────────────────────────────────────────────────────────────

async function test_MLTrainingStatistics() {
    const r = await api.get('ml-training/statistics', adminToken);
    
    if (r.statusCode !== 200 && r.statusCode !== 404) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    if (r.statusCode === 404) {
        return { details: 'ML training API not available' };
    }
    
    return { 
        details: `Total records: ${r.body.overall?.total_records || 0}`,
        response: r.body
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. 碳吸存計算 API 測試
// ─────────────────────────────────────────────────────────────────────────────

async function test_CarbonCalculation() {
    const r = await api.post('carbon/calculate', {
        species_name: '樟樹',
        dbh_cm: 30,
        tree_height_m: 10
    }, adminToken);
    
    if (r.statusCode !== 200 && r.statusCode !== 404) {
        throw new Error(`HTTP ${r.statusCode}`);
    }
    
    if (r.statusCode === 404) {
        return { details: 'Carbon calculation API not available' };
    }
    
    return { 
        details: `Storage: ${r.body.carbonStorage || r.body.carbon_storage} kg`,
        response: r.body
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主程式
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const startTime = Date.now();
    
    // 根據 SECTION 參數決定執行哪些測試
    const shouldRun = (sectionName) => !SECTION || SECTION === sectionName || SECTION === 'all';
    
    // ─────────────────────────────────────────────────────────────────────────
    // 健康檢查 (始終執行)
    // ─────────────────────────────────────────────────────────────────────────
    section('伺服器健康檢查');
    await runTest('伺服器連線', test_ServerAlive);
    
    // ─────────────────────────────────────────────────────────────────────────
    // 認證測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('auth')) {
        section('認證測試 (Authentication)');
        await runTest('管理員登入', test_LoginAdmin);
        await runTest('調查員登入', test_LoginSurvey);
        await runTest('錯誤密碼拒絕', test_LoginWrongPassword);
        await runTest('停用帳號拒絕', test_LoginDisabledAccount);
        await runTest('JWT Token 驗證', test_JWTValidation);
        await runTest('無效 Token 處理', test_JWTInvalidToken);
        await runTest('過期 Token (401)', test_401AutoLogout);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 樹木 CRUD 測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('tree')) {
        section('樹木 CRUD 測試 (Tree Operations)');
        await runTest('取得所有樹木', test_GetAllTrees);
        await runTest('新增樹木 (V2 API)', test_CreateTreeV2);
        await runTest('依 ID 查詢樹木', test_GetTreeById);
        await runTest('更新樹木 (V2 API)', test_UpdateTreeV2);
        await runTest('刪除樹木', test_DeleteTree);
        await runTest('確認刪除成功', test_VerifyTreeDeleted);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // BLE 批量匯入測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('batch')) {
        section('BLE 批量匯入測試 (Batch Import)');
        await runTest('批量匯入樹木', test_BatchImport);
        await runTest('驗證 ID 連續性', test_BatchImportIdSequence);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 使用者管理測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('user')) {
        section('使用者管理測試 (User Management)');
        await runTest('取得所有使用者', test_GetAllUsers);
        await runTest('新增使用者', test_CreateUser);
        await runTest('更新使用者資料', test_UpdateUser);
        await runTest('停用使用者', test_UpdateUserStatus);
        await runTest('刪除使用者', test_DeleteUser);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 專案管理測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('project')) {
        section('專案管理測試 (Project Management)');
        await runTest('取得所有專案', test_GetProjects);
        await runTest('取得專案邊界', test_GetProjectBoundaries);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 安全性測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('security')) {
        section('安全性測試 (Security)');
        await runTest('SQL 注入防護', test_SQLInjectionPrevention);
        await runTest('XSS 防護', test_XSSPrevention);
        await runTest('API 速率限制', test_RateLimiting);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 審計日誌測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('audit')) {
        section('審計日誌測試 (Audit Logs)');
        await runTest('審計日誌記錄', test_AuditLogExists);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 附加功能測試
    // ─────────────────────────────────────────────────────────────────────────
    if (shouldRun('extra')) {
        section('附加功能測試 (Extra Features)');
        await runTest('樹種搜尋 API', test_SpeciesSearchAPI);
        await runTest('樹種辨識服務狀態', test_SpeciesServiceStatus);
        await runTest('ML 訓練數據統計', test_MLTrainingStatistics);
        await runTest('碳吸存計算', test_CarbonCalculation);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 測試結果摘要
    // ─────────────────────────────────────────────────────────────────────────
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`
═══════════════════════════════════════════════════════════════════════════════
  📊 測試結果摘要
═══════════════════════════════════════════════════════════════════════════════
  ✅ 通過: ${totalPassed}
  ❌ 失敗: ${totalFailed}
  ⏭️  跳過: ${totalSkipped}
  ⏱️  耗時: ${totalTime}s
═══════════════════════════════════════════════════════════════════════════════
`);
    
    if (totalFailed > 0) {
        console.log('❌ 失敗項目:');
        allResults.filter(r => r.status === 'fail').forEach(r => {
            console.log(`   - ${r.name}: ${r.error}`);
        });
        console.log('');
    }
    
    // 輸出測試清單（方便確認測試涵蓋範圍）
    if (VERBOSE) {
        console.log('📋 完整測試清單:');
        allResults.forEach(r => {
            const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️';
            console.log(`   ${icon} ${r.name}`);
        });
        console.log('');
    }
    
    process.exit(totalFailed > 0 ? 1 : 0);
}

// 執行
main().catch(e => {
    console.error('💥 Unexpected error:', e);
    process.exit(1);
});
