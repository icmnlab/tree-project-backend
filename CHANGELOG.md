# Changelog

所有主要版本變更記錄。

> **版本紀錄說明（交接用）**
> - 本檔依**時間倒序**記錄對外可見里程碑（功能、資料庫 migration、測試、文件）。**請保留並持續維護**——刪除 CHANGELOG 不符合一般開源／企業交接慣例。
> - **2026-04-28 ～ 2026-06-09** 區間未逐日寫入條目（當時變更已併入下方 **2026-06-10 起**各條目，或見 git history / `docs/WORK_STATUS.md` 工作清單）。不必事後補寫每一個 commit；若需追溯細節以 `git log` 為準。
> - 版本號 `v18.x` 與前端 `pubspec.yaml` 對齊；後端無獨立 semver 檔，以日期條目為主。

---

## (2026-06-15i) — 簡轉繁守門：簡繁共用字不再誤轉（朴樹 ≠ 樸樹）

**問題**：`(2026-06-15h)` 的 `toTraditional` 直接以 OpenCC `cn→tw` 轉換，假設輸入全為簡體。對**簡繁共用字**（如「朴」，簡體可對應繁體「樸」或「朴」）在**已是繁體**的字串中會誤轉——把目錄中正確的「朴樹」（朴樹屬 Celtis）寫成「樸樹」。此為每次寫入都會污染既有正確繁體名的資料完整性風險（部署前以伺服器 `normalize:species` dry-run 發現）。

- **守門邏輯**：`utils/chineseConvert.js` 改為先以 `tw→cn` 偵測——若「繁轉簡」會改變字串，代表它已含**繁體限定字**（已是繁體／繁簡混合），即原樣回傳、不再轉換。完全簡體輸入（如「朴树」）OpenCC 片語字典仍正確處理（朴树→朴樹，保留「朴」）。此守門同時保證**冪等**（銀楓樹 不會被再轉），且不破壞既有目錄繁體名。
- **效果**：`银枫树→銀楓樹`、`朴树→朴樹`、`夏栎→夏櫟` 仍正確；`朴樹`/`臺灣欒樹` 等既有繁體名保持不變。
- **測試**：`tests/invariants/chineseConvert.test.js` 新增「簡繁共用字不誤轉」案（朴樹 保留、朴树 正確轉換、冪等）。

---

## (2026-06-15h) — 樹種名一律台灣繁體（簡轉繁）+ 補批次匯入生命週期漏洞

**問題 1（樹種繁簡混雜）**：Pl@ntNet 辨識回傳的中文俗名多為**簡體**（如「银枫树」），直接入庫造成與系統繁體目錄不一致（`银枫树` vs `銀楓樹`），也讓樹種目錄/同義詞比對失準。
**問題 2（批次匯入漏洞）**：`(2026-06-15g)` 修了 create/update/CSV 三路徑的生命週期推導，但 **`treeSurveyBatchController`（App 批次匯入 BLE/現場資料）** 仍漏設 `lifecycle_status`——批次帶枯死/倒伏狀態的樹仍被當活立木。

- **簡轉繁進入點**：新增 `utils/chineseConvert.js`（`opencc-js` cn→tw，含台灣詞彙；對已繁體無操作、轉換失敗 fallback 原值）。`speciesIdentificationService` 在 Pl@ntNet 回應處統一轉繁（影響顯示／自動新增樹種／同義詞）。
- **寫入路徑全覆蓋**：`create_v2`、`update_v2`、`batchImport`、`csvImport`、現場量測 transfer（`pending_measurements`）入庫前一律對 `species_name` 簡轉繁，確保任何來源都存繁體。
- **補批次匯入生命週期**：`treeSurveyBatchController` 比照其他路徑，以 `lifecycleFromStatus(status)` 推導 `lifecycle_status` 並寫 `retired_at`/`retired_reason`。
- **既有資料回填**：新增 `scripts/normalize_species_traditional.js`（`npm run normalize:species`，預設 dry-run，需 `--apply`）——簡轉繁 `tree_survey`/`tree_survey_measurements`/`tree_species`/`species_synonyms`（撞名自動合併、去重），並**補無樹種編號**（`species_id` 空但 `species_name` 對得到目錄→回填）。冪等。
- **新依賴**：`opencc-js@1.3.1`（純 JS 詞庫，無原生編譯）。
- **測試**：`tests/invariants/chineseConvert.test.js`（5 純函式案：簡轉繁、idempotent、非字串、清單去重）本機全綠；完整 runner（含契約測試）於部署時在 Ubuntu 由 `deploy.sh` 執行驗證。

---

## (2026-06-15g) — 修正「枯死/倒伏/移除卻仍計為活立木」：新增/編輯/匯入皆連動生命週期

**問題**：只有「維護量測」流程會由樹況推導 `lifecycle_status`；直接「新增（create_v2）」「編輯（update_v2）」「CSV 匯入」三條路徑**未連動**，導致樹況為枯死/枯立木/倒伏/移除的樹仍被當作活立木（誤計碳匯、仍出現在維護待辦）。

- **修正三條寫入路徑**：`treeSurveyCreateController`、`treeSurveyUpdateController`、`csvImportController` 入庫時統一以 `utils/treeLifecycle.lifecycleFromStatus(status)` 推導 `lifecycle_status`，淘汰木一併寫 `retired_at`/`retired_reason`；編輯把樹況改回存活字樣時自動清空淘汰欄位（與維護流程一致）。
- **既有資料回填**：`35_backfill_lifecycle_alignment.pg.sql`（冪等）將 `lifecycle_status='active'` 但樹況明確為非活立木者對齊 runtime 邏輯（補上 31/33 未涵蓋的「倒伏」與早期 create_v2 漏設的列；關鍵字與優先序與 `lifecycleFromStatus` 完全一致，只認 active→retired，不動人工已設淘汰/復原）。已登記 `scripts/migrate.js`。
- **測試**：`tests/contracts/tree_lifecycle_retire.test.js` 新增 2 案——create_v2 `status=枯立木`→`dead`、update_v2 改 `倒伏`→`fallen` 再改回 `正常`→`active` 清空。

---

## (2026-06-15f) — 使用者帳號：schema-only + 指令建立管理員

- **`users.pg.sql` 改 schema-only**：移除預寫入的 `admin`/`test`/`tt2` 種子列；正式庫不再自 migration 帶入任何帳號。
- **正式環境**：首次部署後執行 `node scripts/create_lab_admin.js --username ... --password ...`（部署者自訂強密碼）。
- **開發／CI**：新增 `scripts/seed_dev_users.js`（`NODE_ENV=production` 會拒絕執行）；GitHub Actions 在 `migrate.js` 後自動執行。契約測試預設仍用 `admin/12345`（僅限 dev/CI）。
- **文件／CI**：`HANDOFF.md`、`LAB_DEPLOYMENT_GUIDE.md`、`README.md`、`.github/workflows/ci.yml` 同步更新。

---

## (2026-06-15e) — 交接收尾：管理員自我保護、去示範資料、文件去交接語氣

- **管理員自我保護（多人安全）**：`PUT /users/:id`、`PUT /users/:id/status` 新增防呆——管理員不能停用或變更自己的角色（`DELETE /users/:id` 原本已禁刪自己）。避免最後一位管理員把自己鎖在系統外。新增契約測試 `tests/contracts/admin_self_protection.test.js`（停用/降級/刪除自己→400；改暱稱仍可）。後端 runner **80 pass**。
- **資料庫去示範資料**：`project_areas.pg.sql` 改為 **schema-only**，原 9 筆示範港區種子移至 `dev-fixtures/project_areas_seed.pg.sql`（與邊界種子 06 同模式），由 `scripts/migrate.js` 僅在開發路徑（未設 `SKIP_CSV_IMPORT`）載入。正式部署（`run_pending_migrations.js`）不會載入，正式庫 `project_areas` 起始為空表。樹種、樹況選單等**必要參考資料**保留。
- **migration 34 對齊**：改為「補充 08」——只對 08 未涵蓋的 `tree_survey` 自由文字欄（`status`/`notes`/`tree_notes`/`survey_notes`）加 U+FFFD CHECK，不再與 08 重複。
- **文件去交接語氣**：`HANDOFF_SECRETS_CHECKLIST.md` 重寫為中性「機密與環境設定指南」（移除「視為已外洩／取代個人帳號／換成接手者帳號」等措辭，改為「需要設定哪些、放在哪、去哪申請」）。`LAB_DEPLOYMENT_GUIDE.md`、`HANDOVER_CHECKLIST.md` 同步中性化。文件以「下一位開發者依此即可獨立建置」為前提撰寫。

---

## (2026-06-15d) — 亂碼（U+FFFD）防護：API 驗證 + DB CHECK（測試 79 全綠）

修補 May 3 「亂碼 bug」的最後一塊：以錯誤編碼解碼 CSV 時產生的 U+FFFD（`�`）一旦寫入即永久損毀，現於兩層阻擋。

- **API 層（第一道防線）**：`utils/textValidation.js` 既有 `decodeBufferAuto`/`assertCleanUtf8`（CSV 上傳路徑沿用不變）。本次新增輕量 `hasReplacementChar`/`findReplacementCharField`，接於 `createTreeV2`、`batchImportTrees`：入庫前掃描使用者文字欄位（樹種/狀況/備註等），含 U+FFFD → `400 INVALID_TEXT_ENCODING`（批次指出第幾筆），乾淨資料不受影響。
- **資料庫層（第二道防線）**：U+FFFD 的 DB CHECK 早於 `08_text_integrity_check.pg.sql` 已存在（涵蓋 `tree_survey` 的 `project_name`/`project_location`/`species_name`、`tree_species.name`、`projects.name`、`project_areas.area_name`）。本次 `34_text_no_replacement_char.pg.sql` **僅補上** 08 未涵蓋的 `tree_survey` 自由文字欄（`status`/`notes`/`tree_notes`/`survey_notes`），不重複既有約束；同 08 以 **NOT VALID** 加入。
- **測試**：`tests/invariants/four_bugs.test.js` 的 Bug 1 由 SKIP 改為實測（含 U+FFFD→400、乾淨資料→成功）。後端 runner **79 pass / 0 fail / 0 skip**。

---

## (2026-06-15c) — 修正 tree_survey 查詢未輸出英文 `lifecycle_status` 鍵（契約測試紅燈）

- **問題**：`GET /tree_survey`、`/map`、`/by_id/:id` 僅以中文別名 `生命週期`/`淘汰時間`/`淘汰原因` 輸出生命週期欄位，未提供穩定的英文鍵。前端因有 `lifecycle_status ?? 生命週期` 後備而正常運作，但契約 `tree_lifecycle_retire`（讀 `lifecycle_status`）在實機 DB 跑出紅燈（「初始應為 active」）。
- **修正**：三個查詢同時輸出正規英文鍵 `lifecycle_status`／`retired_at`／`retired_reason`（保留中文別名以相容既有顯示）。前端本即優先讀英文鍵，無行為回歸。
- **影響檔**：`routes/treeSurvey.js`。測試：`contracts/tree_lifecycle_retire.test.js` 轉綠（後端 runner 78 pass / 1 skip）。

---

## (2026-06-15b) — 樹況選單目錄（內建+自訂可共享）+ 修正枯立木碳匯歸類

新增可共享的「樹況選單目錄」，並修正「枯立木（立枯死木）」被誤計為活立木的問題。

- **資料庫（2NF）**
  - `33_tree_status_options.pg.sql`：新增 `tree_status_options` 目錄表（代理主鍵 `id`、`name` UNIQUE、`lifecycle`、`is_builtin`、`is_active`、`created_by`、`sort_order`）。`name` 為候選鍵，`lifecycle` 等非鍵欄位完全相依於鍵，符合 2NF/3NF。
  - 內建種子：正常/傾斜/病蟲害/枯萎=`active`；枯立木/枯死=`dead`；倒塌=`fallen`；已移除=`removed`（參考 `tree_survey_data.csv` 既有狀況）。
  - **修正 migration 31 漏網**：原回填僅認「枯死/死亡」，漏掉「枯立木」（立枯死木 snag 屬非活立木）。本檔回填 `status LIKE '%枯立%'` → `lifecycle='dead'`，避免誤計入活立木碳儲量。
  - 已登記於 `scripts/migrate.js`；增量部署 `run_pending_migrations.js` 自動套用。
- **API**
  - `GET /api/tree-statuses`：列出啟用中的樹況（供新增／維護量測表單下拉；任何已登入者可讀）。
  - `POST /api/tree-statuses`：新增自訂樹況（`調查管理員` 以上）；未給 `lifecycle` 時由狀況文字推導。**多人同時新增同名以 `UNIQUE(name)` + `ON CONFLICT DO UPDATE … RETURNING (xmax=0)` 收斂**，回 `created` 旗標，不重複建立。
- **生命週期推導（`utils/treeLifecycle.js`）**：新增「枯立」→`dead`、「倒伏」→`fallen`；「枯萎」維持 `active`（可回復逆境，仍屬活立木）。前後端推導邏輯一致。
- **測試**
  - `tests/invariants/treeLifecycle.test.js`：新增枯立木→dead、枯萎→active、倒伏→fallen 案例（7 pass）。
  - `tests/contracts/tree_statuses.test.js`：GET 內建對照、POST 自訂含「枯立」自動 dead、重複新增收斂、未登入 401。
  - `tests/contracts/tree_lifecycle_retire.test.js`：retire(dead)→by_id 回讀 dead+retired_at、restore→active 清空、非法 lifecycle→400。
- **API 密鑰現況註記**：`config/apiKeys.js` 的 `validateApiKey` 目前未被任何路由／中介層呼叫（全站走 JWT）；admin 產生的金鑰目前不具實際驗證效力，屬休眠功能（見 `docs/HANDOFF.md`）。

---

## (2026-06-15) — 交接整備：補齊淘汰/復原端點、文件對齊

- **修正：`POST /tree_survey/:id/retire`、`/restore` 端點補上**：前一版前端詳情頁已呼叫此二端點，但後端遺漏實作（會 404）。本次於 `routes/treeSurvey.js` 補齊：
  - `retire`：驗證 `lifecycle_status ∈ dead|fallen|removed`，設 `retired_at`/`retired_reason` 與對應 `status` 文字，寫稽核 `RETIRE_TREE`。
  - `restore`：清 `retired_at`/`reason`、`lifecycle_status='active'`、`status='正常'`，寫稽核 `RESTORE_TREE`。
  - 權限定為 `調查管理員`+`projectAuth`（與維護量測流程一致；低於 `DELETE` 的 `專案管理員`）。
- **文件對齊**：`README.md` 角色權限矩陣與 `tree_survey` 端點清單補上 retire/restore；`docs/BOUNDARY_SYSTEM_DESIGN.md` §3.5 新增「匯入純文字座標檔 (.txt/.csv)」一列（前端解析，與貼上座標同驗證）。

---

## (2026-06-13) — 維護量測：樹種繼承、照片跟隨歷史、樹木生命週期（淘汰/復原）

新增「樹木生命週期」與維護量測強化，全盤考量程式碼與資料庫。

- **資料庫**
  - `31_tree_lifecycle_status.pg.sql`：`tree_survey` 新增 `lifecycle_status`（active|dead|fallen|removed）、`retired_at`、`retired_reason`，並依既有 `status` 文字保守回填淘汰狀態。
  - `32_tree_images_measurement_link.pg.sql`：`tree_images` 新增 `measurement_id`（軟連結 `tree_survey_measurements.id`），讓照片可跟隨某一次量測歷史。
  - 兩檔已登記於 `scripts/migrate.js`，增量部署 `run_pending_migrations.js` 會自動套用；canonical schema 同步更新。
- **碳匯帳務（依政府活立木生物量法）**：枯死/倒塌/移除木**不計入活立木碳儲量總計與在庫統計**，但保留歷史並單獨統計。涵蓋 `routes/statistics.js`（新增 `retired` 概況）、`controllers/reportController.js`、`controllers/aiReportController.js`、`services/agentDataTools.js`。
- **維護 transfer（`routes/pending_measurements.js`）**
  - 樹種繼承安全網：重測未填樹種時沿用既有樹種（不再覆寫成「待辨識」），並以繼承樹種重算碳儲量。
  - 由本次樹況推導生命週期：標記枯死/倒塌/移除即淘汰（設 `retired_at`/`reason`）；恢復正常則自動復原。
  - 將本次拍的照片綁定到新建立的量測歷史（`tree_images.measurement_id`）。
- **端點**
  - `POST /api/tree_survey/:id/retire`（`調查管理員`+專案權限）：軟性淘汰（dead|fallen|removed），寫稽核 `RETIRE_TREE`。
  - `POST /api/tree_survey/:id/restore`：復原為存活，寫稽核 `RESTORE_TREE`。
  - 樹木清單/地圖/單筆查詢回傳 `lifecycle_status`/`retired_at`/`retired_reason`。
  - `GET /api/tree-images/tree/:treeId` 支援 `?latest=1`（最新一張）與 `?measurement_id=`（依歷史分組），回傳含 `measurement_id`。
- **工具/測試**：`utils/treeLifecycle.js`（`lifecycleFromStatus`/`isRetiredLifecycle`，純邏輯）；`tests/invariants/treeLifecycle.test.js`（6 案，全綠）。

---

## (2026-06-13) — KML 匯入多幾何容錯（依學院實檔）

- `utils/boundaryImport.js`：同一份 Google Earth KML 常同時含圖釘(Point)/路徑(LineString)/多邊形(Polygon)。匯入優先序改為 ① Polygon →（無）② LineString 視為封閉邊界 →（無）③ ≥3 個 Point 依文件順序連成邊界；後兩者各帶警告。
- 用學院實際匯出的 `未命名的地圖專案.kml`（9 圖釘 + 多邊形「區塊1」）實測：正確採用多邊形、9 頂點、約 12.1 公頃、不自相交。
- 測試：`tests/invariants/boundaryImport.test.js` 新增 3 案（純 Point fallback、LineString fallback、Point+Polygon 優先採用 Polygon）。

---

## (2026-06-13) — 邊界匯出 KML

- 新增 `GET /api/project-boundaries/export.kml?project=<名稱>`（或 `?code=<代碼>`，`projectAuthFilter` 權限）：將指定區的已儲存邊界輸出為 KML（`application/vnd.google-earth.kml+xml`，座標 `lng,lat,0`、環自動閉合），可在 Google Earth 開啟，與既有匯入形成雙向。
- 權限：若使用者有專案過濾清單，匯出對象的 `project_code` 不在清單內回 403；查無邊界回 404。
- 測試：`tests/contracts/project_boundary_import.test.js` 新增匯出案例（驗 KML 內容、`lng,lat` 序、404）。

---

## (2026-06-13) — 邀請碼可刪除紀錄

- 新增 `DELETE /api/invites/:inviteId`（`requireRole('業務管理員')`）：硬刪除單筆邀請碼紀錄並寫稽核 `DELETE_INVITE`。
  `registration_invites` 無被其他表以外鍵參照，刪除不影響已用此碼完成註冊的帳號（註冊時 `project_codes` 已複製至使用者）。
- 配合前端「邀請碼管理」新增「刪除紀錄」與依日期分組顯示（`GET /invites` 已回傳 `created_at`，本次未變更）。

---

## (2026-06-13) — 邊界輸入方式擴充（方式 1 貼座標 + 方式 3 GIS 匯入）

- 新增 `utils/boundaryImport.js`：解析 **KML / KMZ / GeoJSON** → 統一輸出 `[[lat,lng],...]` 開放環。KML 依規格固定 WGS84；GeoJSON 讀 `crs` 或以數值範圍推斷，**TWD97/TM2(EPSG:3826/3825) 以 `proj4` 自動轉 WGS84**；多多邊形取面積最大並警告；`turf.kinks` 偵測自相交。
- 新增 `POST /api/project-boundaries/import`（`requireRole('專案管理員')`，multipart `file`，上限 `BOUNDARY_IMPORT_MAX_MB`，預設 5MB）→ **僅回傳預覽，不寫庫**（沿用「建議邊界」預覽→確認模式）。
- `POST /api/project-boundaries`：新增 `source`（draw|coords|kml|geojson|suggest）與 `allowTreesOutside` 旗標；**寫入前一律以 `turf.kinks` 拒絕自相交**（400 `SELF_INTERSECTING`）；界外既有樹木檢查在前端明確確認後可由 `allowTreesOutside` 略過。
- DB migration `30_project_boundaries_source.pg.sql`：`project_boundaries` 加 `source VARCHAR(20)`（既有列 NULL）；同步 `06a` schema 與 route `initializeTable`。
- 相依套件：新增 `proj4`、`@xmldom/xmldom`、`jszip`（KML 以 xmldom 手動解析，避免 ESM 互通問題）。
- 測試：`tests/invariants/boundaryImport.test.js`（8 純邏輯案例，免 DB）+ `tests/contracts/project_boundary_import.test.js`（自相交拒絕、source 回讀、GeoJSON 匯入預覽）。
- 部署強化 `scripts/deploy.sh`：cluster `pm2 reload` 偶爾留下未替換的舊 worker（實測曾殘留數天，造成請求在新／舊程式碼間輪詢、回應不一致）；reload 後新增殘留偵測（uptime>120s）→ 自動 `pm2 restart` 強制全部換新版。
- 新增 `scripts/setup_tailscale_tls.sh`：一鍵讓 nginx 對 ts.net 名稱提供 **Tailscale 有效憑證**（解決 Android 拒絕自簽憑證導致手機連不上後端）；含 nginx 備份/`nginx -t`/回滾與 90 天 renew cron。
- 新增 `docs/boundary_samples/`：邊界輸入實機測試樣本（貼座標 txt、WGS84/TWD97 GeoJSON、KML、防呆缺小數點 txt），對應驗證表 B8–B14。

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
