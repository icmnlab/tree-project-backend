# 交接總覽 HANDOFF（單一入口）

> 新人接手請從這份開始。這裡只放「跑起來、測試、部署、找路」需要知道的事，
> 細節指向各專門文件（見 §10 文件地圖）。最後更新：2026-06-09。

---

## 1. 這是什麼系統

**永續碳匯樹木管理系統（Sustainable TreeAI）**：通用的樹木調查與碳匯管理系統（目標使用單位：國立東華大學環境學院）。
庫內的港務造林地資料只是開發/CI 測試資料（`backend/dev-fixtures/`），正式上線**不會**匯入，系統也沒有針對該批資料的特殊邏輯。

- **前端**：Flutter App（Android 為主），現場調查、地圖、BLE 連 VLGEO2 測樹儀、AI 助理。
- **後端**：Node.js + Express + PostgreSQL，提供 API、整批/現場量測資料寫入、專案/邊界/碳匯計算。
- **ML 服務（選用）**：樹幹偵測 / 深度估計代理（獨立服務，後端透過 `ML_SERVICE_URL` 代理）。

兩個 repo（各自獨立）：
- `<GITHUB_OWNER>/tree-project-backend`
- `<GITHUB_OWNER>/tree-project-frontend`

> ⚠️ 工作區根目錄 `project_code/` 不是 git repo；`backend/` 與 `frontend/` 各是一個 repo，
> `docs/`、`ml_service/` 為輔助目錄。

---

## 2. 目錄結構

```
project_code/
├── backend/        # Node/Express API（一個 git repo）
│   ├── app.js                      # 入口；prod 開機自動跑 pending migration
│   ├── routes/ services/ middleware/ config/
│   ├── database/initial_data/*.pg.sql   # schema/migration SQL（依序）
│   ├── scripts/                    # migrate.js / run_pending_migrations.js / deploy.sh ...
│   ├── dev-fixtures/               # 開發/CI 用種子（tree_survey_data.csv 等）
│   ├── tests/                      # 整合測試框架（runner.js + invariants/journeys/contracts）
│   └── .github/workflows/ci.yml    # 後端 CI
├── frontend/       # Flutter App（一個 git repo）
│   ├── lib/ (screens/ services/ widgets/ models/ config/)
│   ├── test/                       # 單元/Widget 測試（flutter test）
│   └── .github/workflows/ci.yml    # 前端 CI
└── docs/           # 文件（含本檔）
```

---

## 3. 環境需求

| 項目 | 版本 |
|------|------|
| Node.js | 18+（CI 用 18；prod 建議 20 LTS） |
| PostgreSQL | 15+ |
| Flutter | stable（Dart SDK `>=3.0.0 <4.0.0`） |
| Python / CUDA | 僅 ML 服務需要（選用） |

---

## 4. 本機跑起來

### 4.1 後端
```bash
cd backend
cp .env.example .env          # 填 DATABASE_URL（或 DB_*）、JWT_SECRET、CORS
npm ci
node scripts/migrate.js       # 全新空庫：建 schema + seed admin（admin/12345）
npm start                     # http://localhost:3000  （/health 可測活）
```
- 本機若連「無 SSL」的 Postgres，`.env` 設 `DB_SSL=false`。
- `migrate.js` 是「全新空庫」用（會匯入 `dev-fixtures/tree_survey_data.csv`，約 7000 筆港務測試樹）；
  不想匯入測試樹設 `SKIP_CSV_IMPORT=1`。**正式環境永遠不要跑 `migrate.js`**（見 §6）。

### 4.2 前端
```bash
cd frontend
flutter pub get
flutter run --dart-define=API_BASE_URL=http://<後端IP>:3000/api
```
API 位址由建置期 `--dart-define=API_BASE_URL` 注入（見 `lib/config/app_config.dart`），不要寫死。

---

## 5. 測試與 CI

### 5.1 後端整合測試（`tests/runner.js`）
針對「跑起來的 server + DB」做契約/旅程/不變式測試，每個 case 自建資料並清理。
```bash
# 需要：一個已 migrate 的 DB + 一個正在跑的 server
$env:TEST_BASE_URL="http://localhost:3001/api"   # PowerShell
node tests/runner.js                 # 全部
node tests/runner.js --section=contracts
node tests/runner.js --list          # 只列出 case
```
- 預設登入 `admin/12345`（migrate 已 seed）；其他角色由測試自建。
- 需直連 DB 的 invariants 用 `TEST_DB_URL`（或 `DATABASE_URL`）；沒設則自動 skip。
- 寫測試規範見 `backend/tests/FRAMEWORK.md`。

### 5.2 前端測試
```bash
cd frontend
flutter test                 # 全套（目前 377 pass）
```

### 5.3 CI（GitHub Actions，push / PR 觸發）
| Repo | Workflow | 內容 |
|------|----------|------|
| backend | `.github/workflows/ci.yml` | 起 `postgres:15` → `migrate.js`（schema+seed）→ 啟 server → `tests/runner.js`（37 pass / 1 skip） |
| frontend | `.github/workflows/ci.yml` | `flutter pub get` → `analyze`（advisory）→ `flutter test`（377 pass） |

CI 專用環境變數（在 workflow 內設，正式環境**不要**設）：
- `DB_SSL=false`：連 CI 的無 SSL Postgres。
- `DISABLE_RATE_LIMIT=true`：localhost 大量請求不被限流／IP 黑名單擋。
- `OPENAI_API_KEY` / `GEMINI_API_KEY`=dummy：避免模組載入即建 AI client 而崩潰（見 §9 故障排除）。

---

## 6. 部署（正式環境）

正式機在 `/opt/tree-app/backend`，以 **PM2** 跑 process `tree-backend`（port 3000）。

### 6.1 自動部署（GitHub webhook）
push 到 `main` → GitHub webhook 打 `POST /webhook/deploy`（HMAC 用 `DEPLOY_WEBHOOK_SECRET` 驗簽）→ 執行 `scripts/deploy.sh`：
1. 記錄當前 commit 當 rollback 點
2. `git pull origin main`
3. `npm install --production`
4. **增量** migration：`node scripts/run_pending_migrations.js`（不重新 COPY CSV）
5. `pm2 reload tree-backend`（zero-downtime）
6. `/health` 驗證，失敗自動 rollback

部署日誌：`/opt/tree-app/logs/deploy.log`（`GET /webhook/status` 可看尾段，需 `ADMIN_API_TOKEN`）。

### 6.2 手動部署 / 排錯
```bash
ssh <lab-host>
cd /opt/tree-app/backend
./scripts/deploy.sh              # 正常（pull + 增量 migration + reload）
./scripts/deploy.sh --dry-run    # 只拉取不重啟
pm2 logs tree-backend            # 看後端 log
pm2 reload tree-backend          # 手動重載
```

> **migrate.js vs run_pending_migrations.js**
> - `migrate.js`：全新空庫一次建好（含 CSV）。**只用於開發/CI/全新庫**。
> - `run_pending_migrations.js`：用 `schema_migrations` 表只跑新增量。**正式部署一律走這支**。
> - 兩支共用 `migrationFiles` 清單；新增 migration 請加進 `scripts/migrate.js` 的清單並照編號排序。

---

## 7. 環境變數速查（後端）

完整範本見 `backend/.env.example`。重點：

| 變數 | 必要性 | 說明 |
|------|--------|------|
| `DATABASE_URL`（或 `DB_HOST/PORT/NAME/USER/PASSWORD`） | 必要 | DB 連線 |
| `JWT_SECRET` | 必要（prod 開機檢查） | 登入簽 JWT；`openssl rand -hex 64` |
| `PORT` | 選用 | 預設 3000 |
| `NODE_ENV` | 選用 | `production` 才會開機自動 migration + 嚴格 env 檢查 |
| `CORS_ALLOWED_ORIGINS` | 建議 | 逗號分隔來源白名單 |
| `DB_SSL` / `DB_SSL_REJECT_UNAUTHORIZED` / `PGSSLMODE` | 選用 | SSL 控制（見 `config/pgSsl.js`） |
| `DEPLOY_WEBHOOK_SECRET` / `ADMIN_API_TOKEN` | 部署用 | webhook 驗簽 / 部署狀態查詢 |
| `ML_SERVICE_URL` / `ML_SERVICE_PUBLIC_URL` / `ML_API_KEY` | ML 用 | ML 代理 |
| `CLOUDINARY_*`（三項） | 照片用 | 樹木影像儲存 |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` / `Claude_API_KEY` / `PLANTNET_API_KEY` / `GOOGLE_CSE_*` | 選用 | AI / 樹種辨識 / 搜尋；未設則對應功能停用 |
| `SKIP_CSV_IMPORT` | 選用 | `migrate.js` 是否跳過匯入測試樹（正式庫建議 1） |

前端：`--dart-define=API_BASE_URL=...`、`--dart-define=ML_SERVICE_URL=...`（見 `lib/config/app_config.dart`）。

---

## 8. 資料模型與領域重點（指路）

### ⚠️ 詞彙對照表（必讀，2026-06-11 全面換詞）

依會議決定，**畫面顯示詞彙**已全面改為「專案/區」二層；**程式碼、資料庫、API 鍵一律未改**。維護時務必對照：

| 畫面詞（新） | 舊畫面詞 | 程式 / DB / API（不變） | 英文 UI |
|---|---|---|---|
| **專案**（上層） | 區位／專案區位 | `project_areas`、`area_name`、JSON 鍵 `專案區位`、`project_location` | Project |
| **區**（下層） | 專案 | `projects`、`project_code`、JSON 鍵 `專案名稱`／`專案代碼`、`project_name` | Block |

- 也就是說：程式裡的 `project`/`專案名稱` 對應畫面上的「**區**」；`area`/`專案區位` 對應畫面上的「**專案**」。
- **角色名稱不在換詞範圍**：`專案管理員` 等五個角色是 DB 值，維持原字。
- 後端回傳的中文錯誤訊息仍可能用舊詞（顯示頻率低，列為接手者待辦）。

- **CSV / 專案語意**（program_name→project_location、block_name→project_name 等）：`PROJECT_DATA_AND_DOMAIN.md`
- **資料庫正規化 / schema**：`DATABASE_NORMALIZATION.md`
- **專案邊界系統**（convex-hull 建議邊界、outlier 排除）：`BOUNDARY_SYSTEM_DESIGN.md`
- **碳匯計算**：`CARBON_CALCULATION.md`
- **VLGEO2 BLE 整合**（NUS/Haglof、CSV TYPE 1P/3P/DME/3D/SET、現場 PHGF）：`VLGEO2_STD_APPLICATION_GUIDE.md`、`frontend` 內 `ble_data_processor.dart` / `data_filter_service.dart`
- **AI Agent / 文字轉 SQL**：`AI_AGENT_GUIDE.md`
- **ML 自架**：`SELF_HOST_ML_GUIDE.md`

---

## 9. 故障排除（踩過的雷）

| 症狀 | 原因 / 解法 |
|------|------------|
| 後端開機即 `OpenAIError: OPENAI_API_KEY ... missing` 後崩潰重啟 | `routes/ai.js`、`geminiService.js` 在模組載入就建 AI client。prod 要設真金鑰；CI 設 dummy。 |
| 全新空庫 `migrate.js` 在 migration 16 報 `relation "project_boundaries" does not exist` | 已修：`06a_project_boundaries_schema.pg.sql`（schema-only）建表。若再遇到缺表，檢查 `migrationFiles` 順序。 |
| 連本機/CI Postgres 報 SSL 錯 | 設 `DB_SSL=false`（或 `PGSSLMODE=disable`）。 |
| 測試大量 429 / IP 被封 | CI/本機跑 runner 設 `DISABLE_RATE_LIMIT=true`。 |
| 部署後 `/health` 失敗 | `deploy.sh` 會自動 rollback；看 `/opt/tree-app/logs/deploy.log` 與 `pm2 logs tree-backend`。 |
| 維護鎖相關崩潰 | 取 client 用 `db.pool.connect()` 而非 `db.connect()`（曾因此 unhandledRejection 打掛 process）。 |

---

## 10. 文件地圖

| 文件 | 用途 |
|------|------|
| **`HANDOFF.md`（本檔）** | 單一入口：跑起來 / 測試 / 部署 / 找路 |
| `WORK_STATUS.md` | 最新工作狀態、已完成、待辦（含 §0a CI） |
| `VERIFICATION_CHECKLIST.md` | 部署後實機驗證清單（§0、§8–§10） |
| `LAB_DEPLOYMENT_GUIDE.md` | 脫離個人帳號、實驗室獨立部署 |
| `BUILD_GUIDE.md` | App 建置細節 |
| `HANDOFF_SECRETS_CHECKLIST.md` | 交接日金鑰/帳號/網址逐項清單（必看） |
| `PROJECT_DATA_AND_DOMAIN.md` | CSV / 專案語意（domain 真相） |
| `FIELD_SURVEY_SOP.md` | 現場調查操作 SOP（拿儀器到現場照著做） |
| `MEETING_MINUTES_20260528.md` | 2026-05-28 會議決議（功能取捨依據） |
| `SURVEY_HISTORY.md` | 同一棵樹多次調查（歷次量測）機制 |
| `ADMIN_AND_INVITE_DESIGN.md` | 管理後台與邀請碼規格 |
| `ML_CORRECTION_UPLOAD.md` | ML 校正資料上傳（訓練資料回收） |
| `HANDOFF_EXTERNAL_GNSS_AND_BLE.md` | 外接 GNSS 技術存檔（已取消採購，文件開頭有狀態聲明） |
| `DATABASE_NORMALIZATION.md` / `BOUNDARY_SYSTEM_DESIGN.md` / `CARBON_CALCULATION.md` | 各子系統設計 |
| `backend/tests/FRAMEWORK.md` | 後端測試框架寫法 |

> 歷史性分析/舊版交接文件已於 2026-06-11 整理移出 repo（原 `docs/history/`、各 roadmap/計畫文件），備份於專案擁有者本機 `handover_backup_20260611/`。

---

## 11. 待辦與下一步

**交接日**：照 `LAB_DEPLOYMENT_GUIDE.md` §0「交接日流程」一次做完（fresh push → 金鑰輪替 → 部署 → webhook → 驗收）。

見 `WORK_STATUS.md`「待辦」與 `VERIFICATION_CHECKLIST.md`。目前重點：
- 把仍標「實機」的 P0 項目盡量轉成自動化測試/腳本（GPS 三選一、新增樹不進待辦、儀器欄位 transfer→history…）。
- 真正非實機不可的項目（雙機、藍牙硬體）才保留人工驗證。

---

## 12. 保留但未掛載／實驗性功能（給後續開發者）

交接原則：**掛在 UI 上的功能保證穩定；實驗性功能保留程式碼但不主打**。以下為刻意保留、供後續接手者繼續開發的部分：

| 功能 | 程式碼位置 | 狀態 |
|------|-----------|------|
| AI 對話（樹木問答） | 前端 `screens/ai_chat_page.dart`、後端 `routes/ai.js` | **掛載中**（首頁卡片/樹木頁入口），依賴 `LLM_*` 環境變數，未設定時降級 |
| AI 永續報告 | `/ai-sustainability-report` 路由、`routes/ai.js` | 掛載中，同上依賴 LLM 設定 |
| 視覺 DBH（純視覺量測） | 前端 `screens/scanner_page.dart`、`services/pure_vision_dbh_service.dart`、後端 `routes/ml_service.js`、`ml_service/`（Python） | **掛載中**（V3 整合表單/編輯頁/首頁「測試掃描」卡），精度仍在研究階段，見 `DBH_PURE_VISION_RESEARCH.md` |
| AR 量測 | `services/ar_measurement_service.dart`、`services/v3/ar_measurement_integration_service.dart`（零引用，整合範例） | 程式碼保留，未主打 |
| WebSocket 即時掃描 | `services/scanner_service.dart`（零引用；對接 ml_service `/ws/scan`） | 程式碼保留，未掛載 |
| ML 訓練資料收集 | 後端 `routes/ml_training_data.js` | 保留 |
| 樹木調查頁（unscoped 模式） | `tree_survey_page.dart` | 底部分頁已移除（與列表重疊）；**保留**供專案/區下鑽與首頁「樹木調查」卡片使用 |
| 自動多邊形邊界建議 | 後端 boundarySuggest | 通用功能、需使用者確認後才寫入 |
| 年碳吸存推估 | `tree_survey_measurements` 歷次快照已就緒（含 create_v2 首筆） | 演算法（存量差分）待累積多期資料後實作，見 `CARBON_CALCULATION.md` |

已刪除（被新版完全取代的死碼，不建議復活）：V1 手動輸入頁（被 V3 整合表單取代）、`/ai-assistant` 重複路由、`ble_live` 死分支。
