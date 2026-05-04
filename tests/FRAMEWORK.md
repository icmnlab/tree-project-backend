# TreeAI 後端測試框架 (Stage 1.5) — FRAMEWORK.md

> 業界等級、可長期維護的測試骨架。  
> 與舊版 `regression.test.js` 等 9 支腳本**並存**，Stage 4 才會逐步合併。  
> 舊版說明見 `README.md`，本框架說明在此檔。

## 目錄結構

```
tests/
├── runner.js              # 唯一入口：node tests/runner.js
├── config.js              # BASE_URL / 測試帳號 / TEST_ID / argv flags
├── helpers/
│   ├── apiClient.js       # 統一 HTTP client（login/get/post/...）
│   ├── dbClient.js        # 選用直連 PG，做 read-only 斷言
│   ├── cleanup.js         # TestContext.track + reverse cleanup
│   ├── asserts.js         # 領域斷言（assertJsonOk / assertOfficialCounty 等）
│   └── factories.js       # buildArea / buildProject / buildTree / buildUser
├── invariants/            # 純函式 + 單一不變量回歸（utils/county、四個 bug）
│   ├── county.test.js
│   └── four_bugs.test.js
├── journeys/              # 端到端旅程（取代人工 APP 測一輪）
│   └── survey_full_flow.test.js
└── contracts/             # Stage 4：API schema snapshot
    └── .gitkeep
```

## 執行

```powershell
$env:TEST_BASE_URL='https://your-host/api'
node tests/runner.js                               # 完整跑
node tests/runner.js --section=invariants          # 只跑 invariants
node tests/runner.js --filter=county               # 名稱含 county
node tests/runner.js --list                        # 只列出
node tests/runner.js --verbose                     # 印 request/response
node tests/runner.js --bail                        # 首個 fail 就停
node tests/runner.js --local                       # 預設 http://127.0.0.1:3001/api
```

## 環境變數

| 變數 | 用途 | 預設 |
|---|---|---|
| `TEST_BASE_URL` | API base | (必填，除非 `--local` / `--list`) |
| `TEST_DB_URL` | 直連 PG（選用） | 取 `DATABASE_URL` |
| `TEST_DB_SSL` | 是否要 SSL | `false` |
| `TEST_ADMIN_USER` / `TEST_ADMIN_PASS` | 系統管理員 | `admin` / `12345` |
| `TEST_BUSINESS_USER` / `TEST_BUSINESS_PASS` | 業務管理員 | `business` / `business123` |
| `TEST_PROJECT_USER` / `TEST_PROJECT_PASS` | 專案管理員 | `project` / `project123` |
| `TEST_SURVEY_USER` / `TEST_SURVEY_PASS` | 調查管理員 | `survey` / `survey123` |

> 帳號不存在時，case 內判斷 4xx 後 `return;` 即可，不要讓全部 fail。

## 寫一支新測試

`tests/invariants/foo.test.js`：

```js
'use strict';
module.exports = {
    section: 'invariants',  // 可省略；依資料夾推斷
    cases: [
        {
            name: 'short description',
            // skip: 'reason'        // 想跳過時加
            run: async (ctx) => {
                const { api, db, cleanup, assert, factories, config } = ctx;
                await api.login('admin');
                const r = await api.get('some/endpoint');
                assert.assertJsonOk(r);
            },
        },
    ],
};
```

每個 case 拿到的 `ctx`：

| 欄位 | 說明 |
|---|---|
| `api` | `helpers/apiClient.js` 的 `Api` 實例 |
| `db` | `helpers/dbClient.js`；`db.isAvailable()` false 時請 SKIP |
| `cleanup` | `TestContext`，用 `cleanup.track('project', code)` 註冊；runner 自動清 |
| `assert` | `helpers/asserts.js` 全部 |
| `factories` | `buildArea / buildProject / buildTree / buildUser` + `COUNTY_SAMPLES` |
| `config` | `BASE_URL / TEST_ID / flags / USERS` |

## 設計準則

1. **test 之間零共享狀態** — 每 case 自己建、自己清。
2. **不污染 production** — 命名前綴 `測試*_${TEST_ID}_*`，TEST_ID 每次 run 唯一。
3. **失敗也要清** — try/finally 後 runner 跑 cleanup；cleanup 出錯不再拋。
4. **可選 DB 斷言** — `dbClient` 沒設 → SKIP；不要硬要求 PG。
5. **一檔一主題** — `four_bugs.test.js` 只放 May 3 四個 bug 的回歸；不擴散。
6. **invariants vs journeys** — invariants 跑不變量（純函式、單行為），journeys 跑使用者旅程（多步驟、含清理）。

## 與舊測試的關係

`backend/tests/*.test.js` 9 支舊腳本（`regression`、`coordination` 等）保留不動；
舊 npm scripts 仍 work；本框架純加 `tests/runner.js` + 子資料夾。

Stage 4 規劃將舊腳本：
- 純函式 → `invariants/`
- E2E → `journeys/`
- 已被覆蓋者刪除
