/**
 * tests/config.js — 共用設定
 *
 * 設計：
 * - 環境變數優先，argv 次之，預設值最末
 * - 所有 helpers 都從這裡讀，不要散落 process.env
 *
 * 環境變數（建議放 backend/.env，會自動載入）：
 *   TEST_BASE_URL          API base url（含 /api 字尾），缺省則由 --local 推導
 *   TEST_DB_URL            直連 PG 用，缺省則 dbClient 不可用（需 DB 驗證的測試會 SKIP）
 *   TEST_ADMIN_USER / PASS 系統管理員帳密（預設 admin / 12345）
 *   TEST_BUSI_USER / PASS  業務管理員（預設 business / business123，可選）
 *   TEST_PROJ_USER / PASS  專案管理員（預設 project / project123，可選）
 *   TEST_SURVEY_USER / PASS 調查管理員（預設 survey / survey123）
 *
 * argv：
 *   --local         走 http://localhost:3001/api（dev 預設 port）
 *   --section=NAME  只跑該 section 的 test
 *   --filter=PATTERN 只跑名稱含 PATTERN 的 case（substring）
 *   --bail          首個 fail 就停
 *   --verbose / -v  印出 request/response payload
 *   --list          只列出所有 test，不執行
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const ARGS = process.argv.slice(2);
function arg(name) {
    const hit = ARGS.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    if (hit === `--${name}`) return true;
    return hit.split('=').slice(1).join('=');
}

const IS_LOCAL = arg('local') === true;
const VERBOSE = arg('verbose') === true || ARGS.includes('-v');
const SECTION = arg('section');
const FILTER = arg('filter');
const BAIL = arg('bail') === true;
const LIST = arg('list') === true;

const BASE_URL = process.env.TEST_BASE_URL ||
    (IS_LOCAL ? 'http://localhost:3001/api' : null);

if (!BASE_URL && !LIST) {
    console.error('\n❌ TEST_BASE_URL 必填（或加 --local 走 http://localhost:3001/api）');
    console.error('   PowerShell: $env:TEST_BASE_URL="https://your-host/api"');
    process.exit(2);
}

module.exports = {
    BASE_URL,
    DB_URL: process.env.TEST_DB_URL || process.env.DATABASE_URL || null,
    USERS: {
        admin: {
            username: process.env.TEST_ADMIN_USER || 'admin',
            password: process.env.TEST_ADMIN_PASS || '12345',
            role: '系統管理員',
            loginType: 'admin',
        },
        business: {
            username: process.env.TEST_BUSI_USER || 'business',
            password: process.env.TEST_BUSI_PASS || 'business123',
            role: '業務管理員',
            loginType: 'admin',
        },
        project: {
            username: process.env.TEST_PROJ_USER || 'project',
            password: process.env.TEST_PROJ_PASS || 'project123',
            role: '專案管理員',
            loginType: 'admin',
        },
        survey: {
            username: process.env.TEST_SURVEY_USER || 'survey',
            password: process.env.TEST_SURVEY_PASS || 'survey123',
            role: '調查管理員',
            loginType: 'survey',
        },
    },
    TEST_ID: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    flags: { IS_LOCAL, VERBOSE, SECTION, FILTER, BAIL, LIST },
};
