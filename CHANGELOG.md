# Changelog

所有主要版本變更記錄。

---

## (2026-06-13) — 邊界輸入方式擴充（方式 1 貼座標 + 方式 3 GIS 匯入）

- 新增 `utils/boundaryImport.js`：解析 **KML / KMZ / GeoJSON** → 統一輸出 `[[lat,lng],...]` 開放環。KML 依規格固定 WGS84；GeoJSON 讀 `crs` 或以數值範圍推斷，**TWD97/TM2(EPSG:3826/3825) 以 `proj4` 自動轉 WGS84**；多多邊形取面積最大並警告；`turf.kinks` 偵測自相交。
- 新增 `POST /api/project-boundaries/import`（`requireRole('專案管理員')`，multipart `file`，上限 `BOUNDARY_IMPORT_MAX_MB`，預設 5MB）→ **僅回傳預覽，不寫庫**（沿用「建議邊界」預覽→確認模式）。
- `POST /api/project-boundaries`：新增 `source`（draw|coords|kml|geojson|suggest）與 `allowTreesOutside` 旗標；**寫入前一律以 `turf.kinks` 拒絕自相交**（400 `SELF_INTERSECTING`）；界外既有樹木檢查在前端明確確認後可由 `allowTreesOutside` 略過。
- DB migration `30_project_boundaries_source.pg.sql`：`project_boundaries` 加 `source VARCHAR(20)`（既有列 NULL）；同步 `06a` schema 與 route `initializeTable`。
- 相依套件：新增 `proj4`、`@xmldom/xmldom`、`jszip`（KML 以 xmldom 手動解析，避免 ESM 互通問題）。
- 測試：`tests/invariants/boundaryImport.test.js`（8 純邏輯案例，免 DB）+ `tests/contracts/project_boundary_import.test.js`（自相交拒絕、source 回讀、GeoJSON 匯入預覽）。
- 部署強化 `scripts/deploy.sh`：cluster `pm2 reload` 偶爾留下未替換的舊 worker（實測曾殘留數天，造成請求在新／舊程式碼間輪詢、回應不一致）；reload 後新增殘留偵測（uptime>120s）→ 自動 `pm2 restart` 強制全部換新版。

---

## (2026-06-10) — 歷次量測快照補洞：create_v2 首筆入歷史

- `controllers/treeSurveyCreateController.js`：手動新增（智慧/快速模式）原本**只寫 tree_survey 主表**、不寫 `tree_survey_measurements`；年碳吸存推估靠歷次快照差分，首筆缺漏會讓這些樹永遠少一期。現在 create_v2 同一交易內補寫 survey_mode='new' 快照（pending_id=NULL）。
- BLE/維護 transfer 路徑行為不變（原本就寫快照）；`update_v2` 維持不寫快照（網頁編輯視為「更正」而非新量測，業界慣例）。

---

## (2026-06-10) — 多人安全 P0：pending 任務擁有權 + 查詢上限

### pending 任務擁有權（稽核 #1/#3）
- migration `29_pending_created_by.pg.sql`：`pending_tree_measurements` 加 `created_by_user_id`（FK→users，ON DELETE SET NULL）+ 索引；route 啟動自我補欄與正式 migration 並存。
- `POST /batch` 寫入建立者；`PATCH /:id`、`POST /transfer`、`DELETE /session/:id`、`PATCH /session/:id/project` 加擁有權檢查：非本人（且非 系統/業務管理員）→ 403 `NOT_OWNER`；`created_by_user_id IS NULL` 的 legacy 列沿用舊行為。
- 契約測試 `tests/contracts/pending_ownership.test.js`：A 建批次 → B（同專案調查管理員）改/刪/轉專案 403 → A 可改 → 系統管理員可代刪。

### 查詢上限（稽核 #9）
- `GET /tree_survey/by_project/:x`、`GET /tree_survey/by_area/:x`：預設/最大 cap 2000 + `truncated` 旗標（`?limit=` 可調小）。

> 前端同步：session ID 改防碰撞亂數（稽核 #4）、待測頁只還原本機 claim 的任務（稽核 #2）、維護清單截斷警告（稽核 #8）、admin 專案管理列 overflow 修正。

---

## (2026-06-10) — 交接去個人化（程式碼層）

### 移除提交程式碼中的個人值（避免交接後計費／資安風險）
- `database/initial_data/users.pg.sql`：移除真人種子帳號（真實姓名）；保留 bootstrap `admin`（CI／首次登入）+ `test`/`tt2` 通用角色帳號，display 改通用、清除 admin 的舊專案關聯。完整改為部署腳本建管理員待後續。
- `scripts/test_prod_handbook_e2e.js`：移除個人 Tailscale 後備網址，改 `http://localhost:3000/api`（仍可 `TEST_BASE_URL` 覆寫）。
- `.env.example`：補齊 14 個程式有用到但漏列的選用鍵（`AGENT_FETCH_*`、`LLM_*`、`CARBON_CALC_LEGACY_TIPC`、`DEBUG_MAP`、`CORS_ORIGIN`、`TEST_*` 等）。
- 查證：全庫追蹤檔**無硬編碼金鑰**（PlantNet/Cloudinary/AI/JWT/Webhook 皆只在 `.env.example` 占位）；`.env` 已 gitignore。
- 查證：港務測試種子 `06_project_boundaries_seed.pg.sql` 早已排除於正式 migration（僅 dev-fixtures）。

> 對應前端 repo 同步：`app_config.defaultBaseUrl` 與自簽憑證信任清單改 `--dart-define` 驅動（移除硬編碼 Tailscale IP/網址）。

---

## v18.5.1 (2026-04-28) — County detection + V3 species + docs cleanup

### 縣市自動判斷統一化
- `utils/geo.js` 為唯一的縣市解析來源（內政部 1140318 官方界線，22 縣市）
- `routes/project_areas.js`：POST /api/project_areas 自動寫入 finalCity；新增 GET /api/project_areas/county_by_coords?lng=&lat=
- `routes/location.js` 重構為呼叫 `utils/geo.js`，移除舊 inline turf 載入 + 名稱裁切 hack
- `scripts/backfill_county.js`：批次補齊舊資料的 county（dry-run 預設，加 `--apply` 才寫入）

### V3 樹種辨識自動建檔
- `services/speciesIdentificationService.autoAddSpeciesFromIdentification`：主名改用學名 (scientificName)，所有 commonNames 寫進 species_synonyms

### 公開文件 / 機敏資料清理
- README 重寫含完整架構圖 + 8 個功能流程圖（已升級為 Mermaid）
- 新增 `ml_service/README.md`
- 移除所有 source 中硬寫的 Tailscale hostname/IP（webhook.js 註解、ml_service/app.py 預設 CORS、tests）
- `tests/regression.test.js` + `tests/apiIntegration.test.js`：TEST_BASE_URL 改為必填，並自動載 `.env`

### 變更檔案（精簡）
| 類型 | 檔案 |
|------|------|
| feat | `routes/project_areas.js` · `utils/geo.js` · `data/tw_county.geojson` · `scripts/backfill_county.js` |
| refactor | `routes/location.js` · `services/speciesIdentificationService.js` |
| docs | `README.md` · `ml_service/README.md` |
| chore | `routes/webhook.js` · `ml_service/app.py` · `tests/*.test.js` |

---

## v18.5.0 (2026-03-10) - Self-Hosted Deployment & Auto-Deploy

### 自架伺服器部署
- 完整自架部署系統 — 從 Render 遷移至雙機自架架構
- Ubuntu (i3-8130U) 運行 Node.js Backend + PostgreSQL
- Windows (Core Ultra 5) 運行 ML Service (Depth Pro + SAM 2.1)
- PM2 cluster mode (2 instances) + systemd auto-start
- Nginx reverse proxy with self-signed TLS

### 自動部署與回滾
- GitHub Webhook 自動部署 (`POST /webhook/deploy`，HMAC-SHA256)
- Health check 失敗自動 rollback
- `scripts/deploy.sh` — 自動部署（支援 `--skip-migrate`、`--dry-run`）
- `scripts/rollback.sh` — 回滾到任意 commit
- `scripts/backup_db.sh` — PostgreSQL 備份（cron 每天 3:00）
- `scripts/health_check.sh` — 健康檢查（cron 每 5 分鐘）

### 變更檔案
| 類型 | 檔案 | 說明 |
|------|------|------|
| feat | `routes/webhook.js` | GitHub Webhook 自動部署路由 |
| feat | `scripts/deploy.sh` | 自動部署腳本 (含 rollback) |
| feat | `scripts/rollback.sh` | 手動回滾腳本 |
| feat | `scripts/backup_db.sh` | 資料庫備份腳本 |
| feat | `scripts/health_check.sh` | 健康檢查腳本 |
| feat | `ecosystem.config.js` | PM2 cluster 設定檔 |
| chore | `app.js` | 掛載 webhook 路由 (JWT 之外) |

---

## v18.4.0 (2026-02-22) - ML Precision Upgrade & Backend Stabilization

### ML 模型升級
- Depth Pro 與 OpenVINO 整合 — SOTA 深度預測模型
- EXIF 焦距提取與亞像素精度計算
- 多鏡頭融合提升測量穩定度
- `setup_models.py` 自動下載與轉換 OpenVINO 模型

### 後端穩定性
- 增強輸入驗證與錯誤清理
- NumPy 向量化運算提升處理效能
- 修正資料表初始化順序
- `pending_measurements` 新增 `project_area`、`project_code`、`project_name` 支援

### 開發工具
- ngrok header bypass、`start.ps1` 啟動腳本

---

## v18.3.2 (2025-12-14) - 清理 API 使用改進

- 前端退出未提交時自動清理未使用的專案區位和樹種
- `POST /api/project_areas/cleanup` 清理 API
- `DELETE /api/project_areas/:id`、`DELETE /api/projects/:code`

---

## v18.3.0 (2025-12-14) - Phase 4 安全性完成

### 安全性增強
- `projectAuth` 中間件 — 專案權限控管
- 登入失敗監控 — 5 次失敗鎖定 30 分鐘
- 審計日誌系統 — 記錄所有資料修改操作

### 新功能
- 樹種管理 API (`POST /api/tree_species`)
- 樹木影像 API (`POST/GET/DELETE /api/tree_images`)
- 完整回歸測試套件 — 32+ 項自動化測試

### 資料庫變更
- 新增表格：`project_members`、`login_attempts`、`audit_logs`、`tree_images`

---

## v18.0.0 (2025-12-03) - ID 修復與 ML 訓練數據收集

- 修復新專案第一筆樹木 ID 從 PT-2 開始的問題（改用 PT-0 佔位）
- ML 訓練數據收集 API（`/api/ml-training/batch`、`/statistics`、`/export`、`/analysis`）
- 支援 6 種記錄類型：AR測量、樹種辨識、碳儲量、座標、樹高、冠幅

---

## v16.0.1 (2025-12-02) - 錯誤修復

- OpenAI API 兼容性 — `getTokenLimitParams()` 支援 o1/o3 系列
- multer 圖片上傳錯誤處理改進

---

## v15.0.0 (2025-12-02) - 重大更新

- 樹種辨識 API — Pl@ntNet + GBIF + iNaturalist 三合一
- Text-to-SQL 查詢準確度優化
