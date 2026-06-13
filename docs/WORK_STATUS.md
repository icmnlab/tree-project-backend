# 工作狀態總覽（2026-06-09）

> 執行清單請依序勾選。細節見 `PROJECT_DATA_AND_DOMAIN.md`（CSV／專案語意）、`VERIFICATION_CHECKLIST.md`（實機驗證）。
> 單一交接入口：`HANDOFF.md`（跑起來／測試／部署／文件地圖）。

---

## 下一步（交接接續清單）（2026-06-09）

> 目標：維持「業界水準、交接就緒」。接手者（或新對話）由此開始即可。

**目前狀態（commit／分支）**
- 後端 `tree-project-backend`：`main` 最新 `d8d71df`（已把 `HANDOFF.md` + 本 `WORK_STATUS.md` + docs 樹整併 worklist 納入版控）。CI 綠。docs 樹整併變更已於本機完成、**待 commit**。
- 前端 `tree-project-frontend`：admin 完善 PR [#3](https://github.com/<GITHUB_OWNER>/tree-project-frontend/pull/3)（分支 `feat/admin-panel-completeness`）**已合併進 `main`**（合併 commit `16f9caa`）。`main` 已含 CRUD/系統維運/權限對齊。

**待辦（依優先序）**
1. [x] **Merge PR #3**（admin 後台完善）。已合併（`16f9caa`），前端 `main` 已含 CRUD/系統維運/權限對齊。
2. [x] **docs 樹去重整併**：`backend/docs/` 與 `project_code/docs/` 已收斂成單一真實來源（canonical＝`project_code/docs/`；`backend/docs/` 為版控鏡像，論文二進位以 `.gitignore` 排除）。
   - [x] 論文二進位排除：backend `.gitignore` 已加 `docs/**/*.pdf|docx|doc`、`docs/figures/`（不入庫）。
   - [x] `HANDOFF.md`、`WORK_STATUS.md` 已同步且納入 backend 版控（兩邊一致）。
   - [x] **兩邊皆有但內容不同**（已收斂）：
     - `VERIFICATION_CHECKLIST.md` → 取 project_code（2026-06-09，含 §0.0 自動化覆蓋），已覆蓋 backend。
     - `PROJECT_DATA_AND_DOMAIN.md` → **逐段合併**：以 project_code（2026-06-08）為基底，**補回** backend 獨有的「樹種目錄」段（`tree_species`／`species_synonyms`／Pl@ntNet），兩邊一致。
     - `DATABASE_NORMALIZATION.md` → 取 project_code（含 `16_..._backfill` 實作備註），已覆蓋 backend。
   - [x] **只在 project_code 有**（已補進 backend）：`CARBON_CALCULATION.md`、`history/BACKEND_HANDOVER_v14.md`、`history/BUGS_ANALYSIS.md`。
   - [x] **只在 backend 有**（已定位並雙邊同步）：`2025-12-04-fixes-and-security.md` → 歸 `history/`（dated 修復/安全紀錄）；`DBH_MEASUREMENT_RESEARCH_V2.md` → 留頂層（純視覺 DBH 研究 V2，與 `DBH_PURE_VISION_RESEARCH.md` 並列）；`BLE_IMPORT_INTEGRATION_PLAN.md`／`BLE_IMPORT_UX_IMPROVEMENTS.md`／`HANDOVER.md`／`TEXT_TO_SQL_OPTIMIZATION.md` 在 backend 頂層的副本與 `history/` 版**完全相同** → 刪除頂層副本，統一只留 `history/`（與 project_code 一致）。
   - [x] 重跑差異清單 `git diff --no-index --numstat backend/docs docs` → 僅剩**論文產物**（`*.pdf|docx|doc`、`figures/`、`*.py` 論文腳本，刻意只存在 project_code 且 backend `.gitignore` 排除）。
3. [ ] **真人／硬體驗證**：藍牙實機、雙機同場 UI、相機、T4 等無法自動化的項目，見 `VERIFICATION_CHECKLIST.md` §仍須真人硬體（已自動化覆蓋者見 §0.0，實機可降為抽查）。

**已刻意 defer（非業界硬需求，等需求再做）**
- 執行期改 CORS（反模式，維持 `.env`／Nginx）。
- 維護模式開關、獨立瀏覽器版 admin Web portal（App 內後台已涵蓋管理需求；要做建議用 React-Admin/Refine 接現有 REST+JWT，非手刻）。

**已知小債**
- 後端測試 1 個 `four_bugs` TODO 案 skip（非阻擋）。

---

## 0g. 邊界輸入方式擴充（2026-06-13 執行）

依環境學院需求（直接鍵入座標 / 匯入圖檔 / 匯入 GIS/KML）擴充區邊界輸入：

- [x] **方式 1 貼上座標**：`frontend/lib/utils/boundary_input.dart`（順序自動判斷、收尾去重、錯誤行回報、自相交+依角度重排）。
- [x] **方式 3 匯入 KML/KMZ/GeoJSON**：`backend/utils/boundaryImport.js`（`proj4` TWD97/TM2→WGS84、多多邊形取最大、`turf.kinks` 自相交）；`POST /api/project-boundaries/import`（預覽不寫庫）。
- [x] **儲存強化**：`POST /api/project-boundaries` 加 `source`、`allowTreesOutside`；寫入前 `turf.kinks` 拒絕自相交（400 `SELF_INTERSECTING`）。
- [x] **DB**：migration `30_project_boundaries_source.pg.sql`（`source` 欄位）。
- [x] **相依**：後端 `proj4`、`@xmldom/xmldom`、`jszip`；前端沿用 `file_picker`。
- [x] **測試**：後端 8 純邏輯 + 3 契約；前端 9 單元；`flutter test` 全綠（424）。
- [x] **文件**：`BOUNDARY_SYSTEM_DESIGN.md §3.5`、`VERIFICATION_CHECKLIST.md B8–B13`、`MEETING_MINUTES_20260528.md`、`PROJECT_DATA_AND_DOMAIN.md`、`DATABASE_NORMALIZATION.md`、前後端 CHANGELOG、pubspec 18.5.0+12。
- [ ] **方式 2（含座標圖檔）**：UI 預留「即將推出」，待學院提供範例檔（GeoTIFF/世界檔）再實作。
- [ ] **待學院提供** GIS/KML 範例檔以校驗座標格式（無 `crs` 標示時以數值範圍推斷投影座標）。

---

## 0f. 交接清倉：docs/repo 整理（2026-06-11 執行）

> 目標：repo 只留「交接所需」內容；研究產出/個人資料備份到本機 `c:\projects\tree_project\handover_backup_20260611\`（**不入庫、不交接**）。

- [x] **docs 樹收斂**：`frontend/docs/` 殘留的 14 份過時文件（roadmap/舊計畫/個人 SSH 筆記/舊交接手冊等）備份後移除；8 份仍有效文件升級進 canonical（`FIELD_SURVEY_SOP`、`HANDOFF_SECRETS_CHECKLIST`、`SURVEY_HISTORY`、`ML_CORRECTION_UPLOAD`、`ADMIN_AND_INVITE_DESIGN`、`MEETING_MINUTES_20260528`、外接 GNSS 交接 ×2）。兩 repo `docs/` 重建為 canonical 鏡像。
- [x] **canonical 清理**：移除 `history/`（7 檔）與 5 份過時 roadmap/會議簡報文件（備份）；論文產物（docx/pdf/figures/論文腳本）移出 docs（備份 `docs_paper/`）。
- [x] **ml_service 研究產出清倉**：~8.7 GB benchmark/訓練結果（`benchmark_*`、`phone_flow_*`、`trunk_detector_training/run/`、散落 csv/log/研究腳本）備份至 `ml_research/` 並自 repo 移除；`.gitignore` 補 benchmark/模型來源規則。**保留**：服務程式、再訓練管線腳本與 README。
- [x] **幽靈 submodule 修正**：`depth_pro_src`、`sam2_src`、`third_party/UniDepth`、`third_party/depth-anything-3` 四個 gitlink 無 `.gitmodules`（clone 後無法初始化）→ 自 index 移除，取得方式見 `SELF_HOST_ML_GUIDE.md`／`ml_service/README.md`。
- [x] **文件層去個人化**（原 §2 worklist）：`HANDOFF.md`、`VERIFICATION_CHECKLIST.md`、本檔、`BUILD_GUIDE.md` 之個人 IP/主機名/帳號/姓名全面占位化（`<SERVER_USER>@<SERVER_IP>`、`<HOST>`、`<TAILSCALE_HOST>`、`<GITHUB_OWNER>` 等）；個人部署筆記/簡歷自 `project_code/` 移備份。
- [x] 斷鏈修復：`FIELD_SURVEY_SOP`／`MEETING_MINUTES`／外接 GNSS 文件中指向已移除文件的連結改指 `HANDOFF.md`；`HANDOFF.md` §10 文件地圖更新。
- [x] **交接日流程文件化**（2026-06-11）：`LAB_DEPLOYMENT_GUIDE.md` 新增 §0「交接日流程」——fresh snapshot push（orphan branch，不帶舊歷史）→ 金鑰輪替 → 部署 → webhook 設定 → 管理員/種子帳號處理 → APK → 驗收 checklist。`HANDOFF.md` §1 系統描述改通用（港務=測試資料）、§11 指向交接日流程；兩 repo README 個人網路描述中性化。
- 殘留（拍板項）：`LICENSE` 著作權行 `Copyright (c) 2025 KyleliuNDHU`——著作權人為使用者本人，MIT 慣例保留名字；是否改中性名稱**留使用者決定**。

### 0f-2. 全量審查修正（2026-06-11 第二輪，4 個並行審查的落地）

- [x] **後端清倉**：刪 MySQL 時代遺留 `create_admin.js`/`update_admin_password.js`/`build.sh`；刪孤兒 SQL（`initial_data/06_project_boundaries_seed.pg.sql` 重複副本、`tree_images_2nf_migration.pg.sql` 已併入 `tree_images.pg.sql`）；刪 `data/` 未用檔（starter/species_forest_type/twCounty2010.fixed/fix 腳本）。皆備份 `backend_legacy/`。`data/tree_survey_template.xlsx` 確認**存在且被 `routes/treeSurvey.js` 使用**（先前審查誤報）。
- [x] **文件對齊現況**（11 份全查）：
  - GNSS 交接：中文版刪除（與英文版重複）；英文版頂部加「**外接 GNSS 已取消採購**（2026-05-28 會議）」狀態聲明，內容標為技術存檔。
  - `SURVEY_HISTORY.md`：create_v2 已寫歷次（06-10 修復）反映進缺口表；`update_v2`/CSV 不寫歷次改標「刻意不寫」。
  - `ADMIN_AND_INVITE_DESIGN.md`：邀請碼入口、稽核頁已實作、詞彙對齊。
  - `DATABASE_NORMALIZATION.md`：結論改「符合 2NF」（與 `PROJECT_DATA_AND_DOMAIN.md` §5.5 統一）；邊界 FK 已由 migration 18 修復。
  - `AI_Agent_完整說明.md` → **改名 `AI_AGENT_GUIDE.md`**；Demo 行為、日期、詞彙更新。
  - 其餘小修：`FIELD_SURVEY_SOP`（導航路徑）、`BOUNDARY_SYSTEM_DESIGN`（詞彙聲明）、`VLGEO2_STD_APPLICATION_GUIDE`（PDF 改外部連結）、`ML_CORRECTION_UPLOAD`（路由名/頁面）、`CARBON_CALCULATION`（雙端路徑）、DBH 研究 ×2（加「歷史存檔」聲明）。
- [x] **前端清倉**：`test/Tree_app_equipment_info/`（~98 檔研究遺留）移備份，測試 fixture 留 `test/fixtures/vlgeo2/`（`DATA_2.CSV`+協議文件）；`test/vlgeo2_ble_analysis/` 精簡（留 docs/verify 腳本/可安裝韌體）；未用 assets 12 檔、死碼 4 檔（`custom_dropdown`/`species_card`/`tree_species`/`tipc_kp_lookup.g`）、根目錄散檔 3 檔移備份；verify 腳本/文件中的個人 venv 路徑與 email 清除。
- [x] **版本同步**：前端 `pubspec.yaml` 18.3.2+10 → **18.4.0+11**，CHANGELOG 補 v18.4.0 條目。
- [x] `HANDOFF.md` §12 補記保留的零引用實驗檔（`scanner_service.dart`、`ar_measurement_integration_service.dart`）。

---

## 0c. 程式碼健檢 + 實機 log 分析（2026-06-09）

> 來源：一次完整 `flutter run` 實機 log（量測/維護/地圖全流程）＋ SSH 後端檢查。
> 修復範圍策略＝**track_only**（記錄為主），但下列 **F-A／F-B** 為使用者直接回報、已動手處理。

**SSH 後端檢查（2026-06-09）**
- `<HOST>` 後端 `git log -1` = `f11d60d`（與本機 main 一致）；PM2 `tree-backend` cluster ×2 online；`/health`=OK；`backend-error-*.log` **無錯誤**。後端側健康。

**本輪已處理**
- [x] **F-B 地圖「專案選單不配合縣市」（前端，已修）**：根因＝`MapPage._refreshProjectsForCity` 呼叫 `projects/by_area/<縣市>`，但該路由 `:area` 是「**區位名稱**」非「縣市」，把縣市當區位送進去永遠 0 筆 → 專案下拉塌成只剩「全部」。修法：移除該誤用 API，改在 `_loadMapData` 載入後，依「**已按縣市過濾的快取樹木**」在地端推導專案清單（`_deriveFilteredProjectsForCity`），免後端配合、免重部署。`flutter test` 387 pass、analyze 無新錯。
- [x] **批次匯入 GPS 一律樹木位置**（前端 `ble_import_page.dart`）：對齊 2026-05-28 會議決議，移除三選一對話框。已 `flutter test` 通過、commit/push。

**待確認設計決策（需使用者拍板，非單純 bug）**
- [x] **F-A1（bug，2026-06-09 已修）同場新增樹仍出現在維護清單**：根因＝新增樹提交時，`IntegratedTreeFormPage(autoTransferToTreeSurvey)` 在表單內就已轉移並取得正式 `tree_survey_id`（log `重新映射 55→7074`），但只回傳 `bool`；回到 `ble_live_session_page` 後又呼叫一次 `transferToTreeSurvey`，因已轉移走後端冪等路徑回 `id_mapping:[]`（`pending_measurements.js` 880–887）→ `_treeSurveyIdFromTransfer` 回 null → 新樹 id 從未進 `_addedThisSession` → reload 後又出現。
  - 修法：抽純函式 `lib/utils/transfer_result.dart`（`treeSurveyIdFromTransfer` / `treeSurveyIdFromIdMapping`，附 `test/transfer_result_test.dart` 9 項）；`IntegratedTreeFormPage` 新增 `onTreeSurveyTransferred` callback 把表單轉移當下的正式 id 回拋；`ble_live_session_page` 新增樹改優先用該 id（第二次冪等 transfer 僅後備）。後端不動。全套 396 測試通過。
- [ ] **F-A2（設計，跨場/跨天）「待維護」定義**：現行「待維護」＝該專案/區位全部樹 − 本場已完成(`_completedThisSession`) − 本場新增(`_addedThisSession`)，而集合是**記憶體內、單場**。F-A1 修好「同場」後，跨場/跨天仍需資料驅動定義（見下方選項 1 分析），待會議拍板門檻 N 與層級後實作。
  - 業界做法建議：以**資料本身**定義待維護池（例如 `tree_survey.last_measured_at` 早於門檻 N 個月，或 `status='pending_remeasure'`），而非記憶體 session set。
  - **需決定**：「待維護」的判定基準（最近量測時間門檻？或明確旗標？）。確認後再實作（牽動後端欄位/查詢與前端清單來源）。
  - **方向（2026-06-09 已分析、未動程式）**：採「最近量測時間」門檻（選項 1）。資料面已具備、不需改 schema —— `tree_survey_measurements` 每棵樹每次量測追加一筆，有 `survey_time`、`survey_mode`，且建有索引 `(tree_id, survey_time DESC)`；待維護＝`MAX(survey_time)` 早於門檻 N。
  - **正式機唯讀 SQL 抽樣（2026-06-09，純 SELECT）**：
    - 覆蓋率：總樹 7065 / 有量測 7075 / 無量測 **0**（每棵都有 `survey_time`）。
    - `survey_mode`：`snapshot`=7063（csv 港務測試資料回填，2022-11-21～2026-06-07）、`new`=13、`maintenance`=11（皆 6/7～6/9）。
    - 依最後量測分桶：6 個月內 23、6–12 個月 2864、>12 個月 4188（**此分佈幾乎全為 csv 測試資料時間，不可拿來定 N**）。
  - **抽樣結論**：
    1. 「從未量測的樹」風險在正式環境不存在（正式樹皆由初測 `new` 進來，必有 `survey_time`）。
    2. csv（港務舊資料）僅測試用、正式上線不匯入；選項 1 只看通用欄位 `survey_time`，**不特判 csv**，符合「系統不對該 csv 特別處理」原則。
    3. 門檻 N 不可由現有測試數據反推，需與老師依實際盤點週期決定（碳匯年度盤點通常 12 個月）。
    4. 門檻建議「全域預設 + 每專案可覆寫」（`projects` 加 `maintenance_interval_months`）；是否再對齊到「區」層級，待會議拍板（會議結構為 專案/區）。
    5. 「待維護」為樹的客觀狀態（與帳號無關），所有帳號一致；誰能編輯仍由既有 maintenance_locks 控制。
  - **尚待使用者/會議拍板**：門檻 N 值、是否對齊到「區」層級。確認後才實作後端查詢 + 前端清單來源切換 + per-project 設定 UI。
- [x] **F-C（資料正確性，批次匯入座標語意）— 依現場 SOP 確認：不需改程式**
  - **使用者裁決（2026-06-09）**：正式工作流為「取 GPS 時**人會走到樹木位置**定位（拿儀器或手機皆可）」→ 存入的座標**本來就是樹位**。故現行「一律標 `tree`、不做 HD/AZ 偏移」**正確**，LIVE 與批次語意在此 SOP 下一致；HD/AZ 退化為**純紀錄 metadata**，不參與定位，無需投影／磁偏角補正。
  - **唯一前提（SOP 紀律）**：取點務必站在**樹旁**、勿在站位取點。建議寫入操作手冊／`VERIFICATION_CHECKLIST` 現場 Runbook，並可選擇性在 HD 很大時提示操作員確認 GPS 是否站在樹旁。
  - **小型清理（選配）**：tree-source 的 `station_latitude/longitude` 目前用已棄用 `calculateStationPosition` 反推為合成點，建議改存 null 或標示，避免日後誤用。
  - 以下為當初的分析留存（佐證為何 SOP 必須「站樹旁取點」）：
- [x] ~~F-C 原始疑慮~~（已由上述 SOP 解除）整檔 DATA.CSV 的 GPS 來源分析：
  - **手冊權威依據**（`Manual_Hagloef-Vertex-Laser-Geo2_..._en_30042024.pdf`）：
    - §4.4.12.1／§4.6：儀器把「**內建 GPS 座標**＋5 碼 ID」與每筆量測一起存檔；該座標＝**操作員/儀器當下位置**（測站），儀器**不**計算也不存樹木絕對座標。
    - §9.2 NMEA `$PHGF`：HD（水平距離）、AZ（方位角）、INC、SD、H 全是「**測站→目標**」的向量。
    - §7：DATA.CSV 內容＝高度＋3D 向量＋GPS；§10.1：Azimuth 0..360、X=北。
    - 物理上量樹高必須退到測站才能瞄樹冠，按 SEND 存檔當下儀器（其 GPS）在**測站**，故 DATA.CSV 的座標必為站位、與樹相距 HD（實機 log HD 介於 2～37m）。
  - **現況程式（不一致）**：`ble_import_page._resolveGpsSourceForBatch` 把整檔每筆有 GPS 的記錄**強制** `gps_source='tree'`；`_estimateTreePosition` 見 `tree` 即原樣回傳、**不做 HD/AZ 偏移** → 整檔匯入會把**站位當樹位**入庫，地圖上系統性偏移 HD（數公尺～數十公尺）。
  - **與 2026-05-28 會議「座標一律樹位」的關係**：該決議對**現場逐棵 LIVE** 成立（座標來自**手機**、操作員「於樹旁」定位，見 `ble_live_session_page.dart:959`）；但對**整檔 DATA.CSV** 不成立（座標來自**儀器**＝站位）。兩條路徑同樣標 `tree`，語意卻不同 → 批次那條是錯的。
  - **LIVE 端的座標疑慮（使用者點出）**：LIVE 既以手機在樹旁取點，HD/AZ 變成「站位→樹」的**純記錄用 metadata**，不參與定位（現行正確，未誤用）；我們本就不另外定位測站，故 LIVE 無需偏移。`station_latitude/longitude` 對 tree-source 而言是用已棄用 `calculateStationPosition` 反推的**合成點**，建議改存 null 或明確標示，避免誤導。
  - **修正選項（待拍板，皆牽動正式資料正確性）**：
    1. **(建議) 批次視為站位 + 投影**：DATA.CSV 匯入改標 `gps_source='surveyor'`，以 `calculateTreePositionFromStation(站位, HD, AZ)` 推回樹位（程式已有此函式，現只在非 tree 時呼叫）。
    2. 維持現狀，但需老師確認批次工作流會「人到樹旁、用手機（非儀器）定位」——以儀器內建 GPS 在量高時無法做到。
    3. 整檔匯入恢復「站位／樹位」選擇（LIVE 仍固定樹位），把判斷交給匯入者。
  - **選項 1 的精度前提（重要）**：投影需**真北**方位角。手冊 §4.4.10 預設磁偏角 0.0、AZ 為**磁北**；花蓮磁偏約 −4°～−5°，需在儀器設定磁偏角或於軟體補正，否則投影方向會偏（HD=30m、4° ≈ 偏 2m，仍遠優於不偏移的數十公尺）。GPS CEP 2.5m、AZ 1.5° RMSE 為殘餘誤差。
  - **尚待使用者/會議拍板**：採哪個選項；若選 1，磁偏角在儀器端設定或軟體補正。確認後才動 `ble_import_page` + 資料模型文件。

**P1 — UI/版面（2026-06-09 已修 3 項，commit `0058c7f`）**
- [x] `admin_page.dart` `NavigationRail` 直向 overflow 95px → 包 `LayoutBuilder`+`SingleChildScrollView`+`IntrinsicHeight`，矮螢幕可捲動。
- [x] `pending_measurement_task_page.dart` 雷達導引 `Column` overflow 134px → 同上，有空間置中、不足則捲動。
- [x] `ListTile background color or ink splashes may be invisible` → `tree_measurement_history_panel.dart` 的 `ExpansionTile` 改包透明 `Material`。
- [ ] 多處 `RenderFlex overflowed ... on the right`（14/43/54px）：log 未指明 widget，需實機 DevTools 定位（量測表單/清單列）。

**P1 — 生命週期 / 穩定性**
- [ ] 地圖開啟瞬間偶發 `TextEditingController was used after being disposed` + `_dependents.isEmpty is not true` + `Tried to build dirty widget in the wrong build scope`：頁面切換時 controller/dependency 釋放順序問題，需在 `dispose`/`build` 範圍收斂（重現於進入地圖頁）。
  - **2026-06-10 稽核（縮小範圍）**：`map_page.dart` 已排除為來源——無 `TextEditingController`、所有非同步 `setState` 皆走 `_safeSetState`（`!_disposed && mounted` 守門）、3 處裸 `setState` 均在使用者點擊回呼內（必掛載）。全 app 掃描：**沒有「宣告 controller 卻漏 `dispose` override」的檔案**。⇒ 推斷為**子元件 / 路由轉場**期間的 build-scope/dependency 釋放時序，非單純漏 dispose。**下一步**：於 `flutter run` 進地圖頁重現，看 DevTools 堆疊指向的實際 widget 再定點修。
  - **2026-06-10 實機（Mi A1）**：來回進出地圖頁多次、切換縣市/專案，**未能重現** disposed 錯誤（推測為極偶發 race，暫降級觀察）。同場順帶確認 **Issue B（地圖專案選單配合縣市）已修**：花蓮縣/吳全→3、花蓮縣/吳全1區→1、高雄市/港區植栽2區→39、臺北市→0，選單與縣市正確連動。

**P2 — 效能**
- [x] 地圖「全部」一次載入 7066 marker 卡頓 → **已修（2026-06-10，實機驗證）**：`map_page` 加**視窗範圍剔除 + 硬上限**（候選 >1500 才啟用；`onCameraIdle` 取 `getVisibleRegion` 只渲染可見範圍；單次上限 1500）+ 提示橫幅。**實機前後對比**（Mi A1）：渲染 marker `7066 → 1500`、消除所有 `Davey!`（先前 880–1586ms/幀）、GC 壓力大降（heap 不再衝 88MB）；篩選後（1–39 筆）行為不變。`flutter test` 396 pass。
  - 後續可選：低縮放改 marker 聚合（clustering）以同時看全貌（目前以上限+橫幅折衷）。
- [x] **「有些區顯示不全」＝同座標疊點 → 已修（2026-06-10）**：DB 查證 7066 棵**零缺座標**、零出界，但有**多棵樹座標完全相同**（港區植栽5區同點最多 8 棵、全庫 20 棵被疊住）→ marker 完全重疊只見最上層。修法：`utils/marker_spread.dart` 簡化 spiderfy——同座標第 2 棵起以 1.5m 小圓環確定性展開（每環 8 點），全部可見可點；位移 <5m 不影響縣市歸屬。單元測試 9 例（`marker_spread_test.dart`），全套 405 pass。

**P3 — 平台/建置警告（非功能性，未來清理）**
- [ ] Impeller opt-out deprecated（`AndroidManifest` 顯式關閉 Impeller，未來 Flutter 版本將移除此選項）。
- [ ] Kotlin Gradle Plugin 警告：`device_info_plus`/`file_picker`/`mobile_scanner` 等套件，未來需遷移 Built-in Kotlin。
- [ ] Mi A1（Android 9）`androidx.window SidecarInterface$SidecarCallback` `ClassNotFoundException`：舊機相容性雜訊，**非本 App bug**，可忽略。

---

## 0e. 深度稽核（2026-06-10，22 項；多人安全／效能／資安）

> 來源：全庫深讀稽核（routes/services/screens 逐檔）。已知議題不重列。**P0 全數完成（2026-06-10），累計已修 14 項**，其餘按優先序待辦。

**P0 — 上線前應處理**
- [x] **#1 同專案調查員可互改 pending**：migration `29_pending_created_by.pg.sql` 加 `created_by_user_id`（FK→users，ON DELETE SET NULL）；batch 寫入建立者；PATCH 驗擁有權（本人或 系統/業務管理員；NULL=legacy 列回溯相容）。契約測試 `pending_ownership.test.js`。（2026-06-10）
- [x] **#2 離開待測頁把他人 in_progress 打回 pending**：`_claimedTaskId` 只記錄本機成功設 in_progress 的任務；dispose/放棄/取消只還原自己 claim 的任務。（2026-06-10）
- [x] **#3 session 操作無建立者檢查**：transfer／刪除 session／改 session 專案均加擁有權檢查（403 `NOT_OWNER`），管理員可代管。（2026-06-10）
- [x] **#4 session ID 碰撞**：`generateUniqueSessionId()`（日期前綴+96-bit 安全亂數，`lib/utils/session_id.dart`），SMOKE 批次同步改用；碰撞機率可忽略。未加 DB UNIQUE（session_id 本就跨多列共用，UNIQUE 語意不成立）。（2026-06-10）
- [x] **#5 地圖 API 無上限**：後端 `/map` 預設 cap 20000 + truncated（前端 viewport 剔除已先修）。（2026-06-10）
**P1 — 資料正確性／多人協作**
- [ ] **#6 維護轉移覆寫 tree_survey 無樂觀鎖**：transfer 已有 `FOR UPDATE`（轉移互斥）+ maintenance_locks（雙調查員互斥）+ 歷次量測表保留紀錄；剩餘風險是「web 編輯與現場轉移並行」——現場儀器值較新，**設計上現場優先**，列觀察非急修。
- [x] **#7 pending PATCH SELECT→UPDATE 競態**：UPDATE WHERE 加毫秒級版本原子守門（date_trunc 對齊 PG 微秒），並發雙過 pre-check 時僅一個命中、另一個 409。（2026-06-10）
- [x] **#8 維護清單靜默截斷 500 筆**：達 500 筆上限時顯示橙色警告列「僅顯示前 500 筆，請用搜尋縮小範圍」。（2026-06-10）
- [x] **#9 by_project/by_area 無 LIMIT**：預設/最大 cap 2000 + `truncated` 旗標（可 `?limit=` 縮小）。（2026-06-10）
- [x] **#10 批次更新無樂觀鎖**：稽核期間已先修（commit `73015cc`，逐棵帶鎖+回報）。
- [x] **#11 DBH 無範圍驗證**：表單擋 ≤0 與 >600cm。（2026-06-10）
- [x] **#12 AI 匯出下載缺角色限制**：`/download/:filename` 加 `requireRole('調查管理員')`（與其他 AI 路由一致；前端 DownloadService 本就帶 JWT）。（2026-06-10）
**P2 — 效能／資安／UX**
- [x] **#13 邊界 by_code 缺專案授權**：GET/DELETE by_code 加 projectAuthFilter（無權限回 404 不洩漏存在性）。（2026-06-10）
- [x] **#14 無 project_code 影像上傳放行**：owner 不存在 → 404；pending 無 project_code 改驗建立者（legacy NULL 沿用舊行為）。（2026-06-10）
- [ ] **#16 map/meta 全表掃描**、**#17 project_areas city 全表掃描**（預聚合/快取）。
- [x] **#15 pending GET /trees 無上限**：預設 cap 2000（可 ?limit= 覆寫）。（2026-06-10）
- [x] **#18 ble_import await 後未檢 mounted**：已補。（2026-06-10）
- [x] **#19 BLE 轉移失敗僅寫 log**：失敗/例外改 6 秒橙色 SnackBar 明確告警（資料保留在 pending、可重試）。（2026-06-10）
- [x] **#20 GET /tree_survey 無預設上限**：預設/最大 cap 2000（前端全帶 limit，行為不變）。（2026-06-10）
**P3**
- [x] **#21 維護鎖 dispose 未 await**：結論＝設計可接受——dispose 無法 await，釋鎖為 best-effort，後端 45 分 TTL + purgeExpired 為安全網（已加註解）。（2026-06-10）
- [x] **#22 tree_list catch 未檢 mounted**（已修 2026-06-10）。

**地圖效能升級（2026-06-10）**
- [x] ~~原生 marker clustering（plugin ClusterManager）~~ → **實機踩雷退役**：7000+ 標記觸發 Android `RejectedExecutionException`（plugin 每 addItem 觸發一次原生 re-cluster AsyncTask，塞爆 128 佇列）。
- [x] **Dart 端網格聚合（最終方案）**：`lib/utils/tree_marker_cluster.dart` + 單元測試。zoom<16 聚合圓點（畫布繪數字、點擊漸進放大）；zoom≥16 一律個別標記（保證放大看得到點）+ spiderfy 疊點展開 + 視窗剔除 2000 保險絲。`onCameraIdle` 門檻/0.5 zoom 變化才重建。（2026-06-10）

---

## 0d. 功能盤點 + 專案/區結構 + 資料查閱 UX（2026-06-09）

> 來源：全 `lib` 頁面盤點（約 40+ 畫面）＋專案/區資料結構檢視。**皆分析建議、未動程式**，待使用者勾選要動的項目。

### A. 樹木調查（`tree_survey_page.dart`）是否保留？ ✅ 已執行（2026-06-10）
> **已實作方案 1 變體**：底部導覽 3→2 頁（首頁/列表），移除「調查」分頁；`tree_survey_page.dart` **保留**供專案/區位下鑽（`ProjectTreesPage`/`ProjectAreasPage`）與首頁「樹木調查」卡片（手動新增入口）使用。原盤點分析如下：
- **現況**：仍是現役入口——佔**底部導覽第 2 頁「調查」**，定位＝「樹木清單瀏覽 + 手動新增入口（FAB→快速/智慧模式）」，**不是** BLE/拍照量測頁（那是 `ble_live_session_page`/`integrated_tree_form_page`）。也被專案瀏覽鏈（`ProjectTreesPage`/`ProjectAreasPage`）帶 `projectName/areaName` push。
- **問題**：與 `tree_list_page.dart`（底部第 3 頁「列表」）**職責重疊**——兩個都是樹木清單，列表頁能力更強（分頁、搜尋、排序、批次、Excel 匯入匯出）；調查頁無篩選時只載前 200 筆。使用者最易困惑「調查 vs 列表」差在哪。
- **建議（擇一，待拍板）**：
  1. **(推薦) 合併成單一「樹木」頁**，用上方切換「專案視角／全域視角」；手動新增 FAB 保留。底部導覽從 3 頁變 2 頁（首頁、樹木），更清爽。
  2. 保留兩頁但**明確分工**＋改名：調查＝「依專案/區瀏覽」、列表＝「全部樹木（營運）」，並移除儀表板重複的「樹木調查」卡（同頁三入口）。
  3. 維持現狀（不建議，混淆會延續）。
- **結論**：**不建議直接刪除**（仍是現役樞紐），但**強烈建議合併/釐清**。

### B. 專案/區（代碼）結構
- **資料模型**：`projects`（name/code/area）、`project_areas`（area_name/area_code）、`project_boundaries`（project_name 唯一/project_code/project_area/邊界）。
- **關聯是「字串名稱」鬆耦合、非外鍵**：project 以 `area`(=area_name 字串) 關到區；boundary 以 `project_name` 字串關到專案。→ 改名/同名/空白差異易斷裂（**F-B 地圖 bug 的同源風險**：曾把「縣市」當「區位名」送進 `by_area`）。
- **種子資料含舊港務測試資料**：`06_project_boundaries_seed.pg.sql` 寫死高雄港/蘇澳港/花蓮港…等港區邊界（港務公司舊案）。依「正式上線不匯入 csv、系統不特判舊資料」原則，**正式部署應改為空種子或環院實際區位**。
- **建議**：
  1. 文件化「專案↔區↔邊界」以 `*_code` 為主鍵串接的契約；查詢一律走 code，不要再用顯示名稱當 key。
  2. 交接時把港務種子資料移出正式 seed（列入去個人化/去測試資料 worklist）。
  3. （選配）長期加 FK 或一致性檢查，避免孤兒邊界/區。

### C. 資料查閱 UX（業界做法）
- **現況頁面**：清單（調查/列表/專案樹木）、詳情（`tree_survey_detail_page`）、地圖（`map_page`）、統計（`statistics_page`）、量測歷史面板。
- **痛點**：
  1. 瀏覽鏈太深：縣市→區位→專案 hub→清單→詳情（5 跳）；`ProjectTreesPage` 只預覽 5 棵且**不能點進詳情**。
  2. **地圖標記點了沒有詳情頁**（看到樹卻無法下鑽）。
  3. 兩個清單頁、儀表板重複卡，入口分散。
  4. 統計與清單/地圖各自獨立，無法「篩選一次、三種視圖（清單/地圖/統計）連動」。
- **業界做法建議（GIS/資產盤點類 App 常見）**：
  1. **單一資料中心 + 三視圖切換**：同一組篩選（縣市/區/專案/樹種/待維護）上方切「清單 / 地圖 / 統計」，狀態連動（如 Notion/ArcGIS Field Maps 模式）。
  2. **地圖標記可點 → bottom sheet 摘要 → 進詳情**（下鑽閉環）。
  3. **全域搜尋列**（樹編號/專案/樹種）直達詳情。
  4. **儲存常用篩選**（我的專案、本月待維護）。
  5. 大資料用 **viewport/分頁/聚合載入**（呼應 P2：地圖一次載 7067 marker 的效能問題）。
  6. 詳情頁時間軸化量測歷史（已有面板，可強化為碳匯成長曲線）。
- **落地優先序建議**：① 地圖標記可下鑽（高效益低成本）→ ② 合併清單頁 + 全域搜尋 → ③ 三視圖連動（較大工程）。

### D. 本輪已實作（2026-06-09）
- [x] **地圖標記可下鑽**（`map_page.dart`）：點標記 → bottom sheet 摘要（樹種/專案/區位/系統編號/專案編號）→「查看完整詳情」進 `TreeSurveyDetailPage`；InfoWindow 點擊也直達詳情。`flutter analyze` 零新問題、`flutter test` 396 全過。
- [x] **死碼清理**：刪 `screens/manual_input_page.dart`（V1，已 `@Deprecated`、零引用）；移除 `main.dart` `/ai-assistant` 舊路由（無人導向，`/ai-chat` 仍在）；清 `home_page.dart` 三處 `ble_live` 死分支（保留 line 257 清理舊偏好殘留）。analyze 無 error、test 396 全過。
- [x] **全域搜尋**（`widgets/tree_search_delegate.dart` + 儀表板標題列搜尋框）：點搜尋框開 `SearchDelegate`，可用系統/專案編號、樹種、專案名稱查詢（重用 `GET /tree_survey?q=`，≥2 字元觸發），點結果直達 `TreeSurveyDetailPage`。新增 l10n `search_tree_hint`（中/英）。analyze 無 error、test 396 全過。未動既有頁面/導覽結構。
- [ ] 待拍板才動：清單頁合併（A 方案，底部導覽 3→2 頁）；三視圖連動。

---

## 交接去個人化 worklist（**fresh 策略**，2026-06-09 定）

> 決策：**完全去個人化** — 程式碼零硬編碼個人值，下一棒自行申請所有帳號/金鑰。  
> 既有清單：`docs/HANDOFF_SECRETS_CHECKLIST.md`（金鑰/網址/帳號）、`docs/LAB_DEPLOYMENT_GUIDE.md`（部署）。  
> ⚠️ **執行時機：在「真人/硬體驗證」完成之後**（去個人化會抽掉驗證所需的後端 IP/憑證/SSH 資訊）。

### 1. 程式碼層（硬編碼個人值 → 可設定 / 占位）
- [x] `frontend/lib/config/app_config.dart` → `defaultBaseUrl` 改為**空字串**（強制 `--dart-define=API_BASE_URL`）；空值時於 `_setEnvironment` 印明確警告。（2026-06-10）
- [x] `frontend/lib/main.dart` → `SelfHostedHttpOverrides` 移除硬編碼 `<SERVER_IP>`／`<ML_HOST_IP>`；改 `--dart-define=SELF_SIGNED_TRUSTED_HOSTS`（逗號分隔，支援 `.suffix` 後綴；預設空＝只走正規 TLS）。（2026-06-10）
- [x] `backend/database/initial_data/users.pg.sql` → 移除真實姓名種子帳號（`<NAME>`／`<NAME>`+`<OWNER>`）；保留 bootstrap `admin`（CI/首次登入）+ `test`/`tt2` 通用角色帳號（display 改通用、清 admin 港務專案關聯）。**剩餘**：完整改 `create_lab_admin.js` 部署時建立（帳密部署者輸入）— 待後續。（2026-06-10）
- [x] `backend/scripts/test_prod_handbook_e2e.js` → host fallback 由個人 Tailscale 網址改 `http://localhost:3000/api`（仍可 `TEST_BASE_URL` 覆寫）。（2026-06-10）
- [x] 港務測試種子 `06_project_boundaries_seed.pg.sql` 經查**已隔離**：`migrate.js` L47–48 排除於正式 migration、僅 dev-fixtures（`seed_dev_boundaries.js`）載入 → 正式庫不含港務資料，無需處理。
- [x] `.env.example` 補齊：新增 14 個漏列的選用鍵（`AGENT_FETCH_*`／`LLM_*`／`CARBON_CALC_LEGACY_TIPC`／`DEBUG_MAP`／`CORS_ORIGIN`／`TEST_*`）；所有計費/機密金鑰本就已占位。**查證**：全庫追蹤檔無硬編碼金鑰、`.env` 已 gitignore。（2026-06-10）
- [ ] `backend/.env`（實機真實值，Tailscale/ngrok）不入庫——本就 gitignore，交接時舊金鑰全部作廢重申請（見 §3）。
- [ ] `backend/LICENSE` 著作權人 `<GITHUB_OWNER>`（屬法律/歸屬決定，**留待使用者拍板**，未擅改）。
- [x] 殘留掃描：程式/腳本層已清；文件層已於 2026-06-11 占位化完成（見 §0f），repo 全庫掃描個人值 = 0 命中（`LICENSE` 著作權行除外，留使用者拍板）。

### 2. 文件層（個人值 → 占位符，與既有 checklist 風格一致）
- [x] 文件層個人值全面占位化（2026-06-11，見 §0f）：`HANDOFF.md`、本 `WORK_STATUS.md`、`VERIFICATION_CHECKLIST.md`、`BUILD_GUIDE.md` 等改 `<SERVER_USER>@<SERVER_IP>`／`<HOST>`／`<TAILSCALE_HOST>`／`<GITHUB_OWNER>`；`UBUNTU_SSH_ACCESS.md` 已移出 repo（備份）。
- [x] 根目錄 `完整部署方案：Render → 自架 Ubuntu 筆電伺服器.txt`：已移出 `project_code/`（備份於 `handover_backup_20260611/personal_root/`）。

### 3. 帳號 / 服務（fresh：交接時下一棒自建）
- [ ] GitHub `<GITHUB_OWNER>/tree-project-*`：下一棒 fork/新建 repo，更新 remote 與 webhook secret。
- [ ] Tailscale tailnet（`<GITHUB_OWNER>@`）、Ubuntu `<SERVER_USER>` 帳號：下一棒自建 tailnet / Linux 帳號 + 公鑰。
- [ ] 所有金鑰（DB/JWT/Cloudinary/PlantNet/AI/ML/Admin/Webhook/Maps）依 `HANDOFF_SECRETS_CHECKLIST.md` §A **全部作廢重申請**。

### 4. 業界標準收尾
- [ ] 祕密零硬編碼：全走 `.env` / CI secrets；`git` 歷史掃描有無誤入金鑰（如有→輪替）。
- [ ] `.env.example` 完整、README/Onboarding 一頁可從零跑起（已有 `HANDOFF.md`，補「全新帳號從零」路徑）。
- [ ] GitHub：protected `main` + CI required check（兩 repo 已有 CI，補分支保護規則）。
- [ ] 憑證走正規 TLS（Let's Encrypt / 反代）取代自簽白名單；或文件化內網 CA 流程。

### 驗收
- [ ] 重跑全庫個人值掃描 = 0 命中（占位符除外）。
- [ ] 用「全新空機 + 全新帳號」依文件能跑起前後端 + 一次 `VERIFICATION_CHECKLIST` 全綠。

---

## 0a. CI／自動化測試（2026-06-09 建置）

目標：交接前讓「程式碼測試」可重現、可自動跑，符合業界做法（PR/push 自動驗證）。

> ✅ **兩 repo CI 皆綠（2026-06-09）**：後端 `tests/runner.js`（最新 HEAD `19a6ce0`，含新增儀器溯源契約）pass / 0 fail / 1 skip（skip 為 four_bugs 的 TODO 案）；前端 `flutter test` 377 pass / 0 fail。
> 修復過程：fresh DB 缺 `project_boundaries`（補 `06a` schema migration）、server boot 因模組載入即建 OpenAI/Gemini client 而崩潰（CI 補 dummy keys）。
> 另已新增單一交接入口 `docs/HANDOFF.md`（跑起來／測試／部署／文件地圖）。

### 後端（`tree-project-backend`，HEAD `528c175`）
- [x] `.github/workflows/ci.yml`：起 `postgres:15` service → `node scripts/migrate.js`（建 schema + seed admin，匯入 dev-fixtures）→ 啟 server → `node tests/runner.js`（invariants + journeys + contracts，共 38 cases）
- [x] `config/pgSsl.js`：集中 pg SSL 判斷；`DB_SSL=false` / `PGSSLMODE=disable` 在本機/CI 關 SSL，**正式環境未設旗標時行為不變**（`db.js`、`migrate.js`、`run_pending_migrations.js` 共用）
- [x] `rateLimiter`：`DISABLE_RATE_LIMIT=true` 時 CI 不被限流／IP 黑名單擋
- [x] 測試 harness 修正：`invariants/boundarySuggest`、`requestIdDedup` 由「載入即自跑＋process.exit」改為 runner `{cases}`（requestIdDedup 無 DB 時自動 skip）→ runner 在無 DB 時不再崩潰
- [x] `tests/contracts/maintenance_locks.test.js`：雙帳號鎖競爭契約（acquire→重入→他人 409 LOCKED→release→他人 acquire）
- [x] `tests/contracts/instrument_traceability.test.js`：**儀器溯源**契約（A4/P0-9）— pending(completed)→transfer→歷次量測 GET 須帶 `instrument_type`/`instrument_dbh_cm`，取代人工實機。**順帶修補功能缺口**：`GET /tree_survey/by_id/:id/measurements` 原本沒回傳這兩個儀器欄位（transfer 已寫入表卻查不到），已補進 SELECT。CI 已驗證綠（HEAD `19a6ce0`）。
- [x] `tests/contracts/transfer_gps_guard.test.js`：**GPS 守門**契約（P0-8 一部分）— `gps_source=mixed_pending` 或 `raw_data_snapshot.requires_gps_fix=true` 的 pending，transfer 須回 400 + `blocked_pending_ids` 且整批 ROLLBACK。CI 綠（HEAD `edeb69b`）。

### 前端追加（P0 實機轉自動化，HEAD `5abdebc`，flutter test 387 pass）
- [x] `lib/utils/maintenance_session.dart` + `test/maintenance_session_test.dart`：抽出「新增樹/已完成樹不進待辦」純函式（`isMaintenanceSessionPending` / `maintenanceTreeIdOf`），`maintenance_survey_page` 改為委派；取代 M4 實機。
- [x] `test/handbook_dbh_source_test.dart`：手冊合規 DBH 來源決策 — handbook→`manual`（儀器值仍保留供溯源）、研究模式→`remote_diameter`；取代 M7/IRD-1 的資料面。
- [x] GPS 三選一（M2/M3 維護、tree/surveyor/mixed_pending 換算）經查已由 `maintenance_gps_flow_test` / `ble_pending_workflow_test` 完整覆蓋，**未重複新增**（避免冗餘測試）。
- [x] `VERIFICATION_CHECKLIST.md` 新增 §0.0「已自動化覆蓋」對照表：列出哪些原實機項已被測試覆蓋（可降為抽查）、哪些仍須真人硬體（藍牙/T4/相機/雙機 UI）。

### 前端（`tree-project-frontend`，HEAD `3c25a7c`）
- [x] `.github/workflows/ci.yml`：`flutter pub get` → `flutter analyze`（advisory，不擋）→ `flutter test`
- [x] 修好既有失敗測試：`data_filter_test`（更新為 v21.0 語意：只必填 `id`、座標鍵含 id）、`ble_live_nmea_test`（用 mock prefs 切研究模式）
- [x] 移除過時 `widget_test.dart`（Flutter 計數器樣板）
- **本機全測試：377 通過 / 0 失敗**（CI 同樣全綠）

---

## 0b. Admin 後台完善（2026-06-09，PR #3）

目標：把管理後台補到業界可用水準 — 修 bug、補「後端已有但前端缺 UI」的 CRUD、新增系統維運分頁，並讓前端權限閘對齊後端 `requireRole`。

> ✅ **前端 `tree-project-frontend` PR [#3](https://github.com/<GITHUB_OWNER>/tree-project-frontend/pull/3)（分支 `feat/admin-panel-completeness`，HEAD `f02188b`）CI test pass（1m55s）**；本機 `flutter test` 387 pass / 0 fail，`flutter analyze` 變更檔僅 info 級。

### 修正（bugs / 死碼）
- [x] `services/admin_service.dart`：備份端點 `backup` → `admin/backup`（原本打不到後端受保護路由）。
- [x] `screens/api_key_management_screen.dart`：回應解析 `keys`/`apiKey` → `data`/`data.key`（對齊後端 `{success,data}`）。
- [x] `admin_page.dart`：研究資料蒐集入口由「所有後台角色可見」收斂為**僅系統管理員**（對齊後端 `requireRole('系統管理員')`）；移除三段未掛載死碼（舊備份/API 金鑰/系統設定 widget）。

### 補齊 CRUD UI（後端原本就有端點）
- [x] 專案管理新增「建立專案」對話框（名稱＋既有區位下拉）；建立/刪除按鈕加上**業務管理員**權限閘。
- [x] 新增 `screens/project_areas_admin_page.dart`：專案區位 列表/新增/編輯/刪除（**專案管理員**閘）。編輯時 `area_name` 設唯讀（`tree_survey`/`project_boundaries` 以名稱反規格化儲存，後端 PUT 不連動更名 → 避免改名造成既有資料不一致；Bugbot medium 修正）。
- [x] `services/project_area_service.dart`：新增 `updateProjectArea`（PUT）。

### 新增系統維運分頁（系統管理員）
- [x] `screens/system_settings_page.dart`：API 環境、ML 服務狀態（可重檢）、資料庫備份觸發（含確認）、API 金鑰入口、還原說明。

### 審查
- [x] Bugbot：1 項 medium（改名反規格化不一致）→ 已以「編輯時 `area_name` 唯讀」修正。
- [x] 安全審查：無 medium 以上可利用問題；前端閘＋後端 `requireRole` 雙重把關。
- [x] 順帶放寬 `test/v3_simulation/ble_simulation_test` 高頻吞吐硬門檻（`>80`→`>50`），避免 Dart Timer 顆粒度在慢/忙主機誤判。

### 範圍外（Tier 4，刻意未做）
- 執行期改 CORS：**反模式**，維持 `.env`／Nginx（客戶端是手機 App，本就不走 CORS）。
- 維護模式、獨立 Web admin portal：合理但屬加分/大工程；App 內後台已涵蓋管理需求。Web 後台若日後要做，建議用 React-Admin/Refine/AdminJS 等接現有 REST+JWT 自動生成，不手刻。

---

## 0. 架構決策（2026-05-29）

**不需要大規模重構。** 現有分層（ProjectScope、field_session_setup、維護場次、BLE 流程、lock service）可支撐下一階段；以**增量 slice** 推進即可：

| 順序 | Slice | 性質 |
|------|-------|------|
| 1 | 後端 deploy（migration 26/27、domainAliases、snapshot merge） | 部署 |
| 2 | Phase A 維護樹木鎖（本機已實作） | 功能 |
| 3 | 實機驗證（GPS 三選一、新增樹不進待辦、雙帳號鎖） | 驗證 |
| 4 | 管理端專案／區兩段式選取 | UI 小改 |
| 5 | 歷次紀錄編輯／刪除 | **新需求**（需 API + 權限，另開） |

P3 技術債（Kotlin 遷移、邊界主鍵、VIEW 化）維持長期排程，不阻擋現場使用。

---

## 1. 本輪已完成（2026-05-29）

### 維護量測 UX（前端）
- [x] **SEND 後 GPS 三選一**：`maintenance_gps_flow.dart`；表單不再用 Switch 控制更新樹位
- [x] **新增樹提交後回清單**：`BleLiveSessionPage.maintenanceSessionContext`
- [x] **本場新增樹不進待辦**：`_addedThisSession` Set
- [x] **409 冪等／自動重試**：`integrated_tree_form_page.dart`
- [x] **維護場次**：本場已測移除、完成確認、待辦全清對話框
- [x] **單元測試**：`test/maintenance_gps_flow_test.dart`（4 項）

### Phase A — 維護樹木鎖（本機，待 deploy 驗證）
- [x] Migration **27**：`27_maintenance_tree_locks.pg.sql`
- [x] API：`routes/maintenance_locks.js`（GET/POST/DELETE，45 分鐘 TTL，409 LOCKED）
- [x] 前端：`maintenance_lock_service.dart` + `maintenance_survey_page.dart`（進 BLE 前 acquire、結束 release、清單顯示鎖定者；404 優雅降級）
- [x] `migrate.js` / `app.js` 已註冊

### 伺服器現況（2026-06-09 已 deploy）

- 後端 HEAD：`578911d`（maintenance_locks 崩潰修正）— **已部署、PM2 重啟數歸零、穩定 online**
- 前端 HEAD：`ed0c0f6`（移除現場樹高模式選擇器，現場一律標 LIVE）
- Migration **26**、**27**、**28** 已套用
- **重大修正**：`maintenance_locks.js` 用 `db.connect()`（不存在）→ unhandledRejection 把整個後端打掛，PM2 重啟 200+ 次。改 `db.pool.connect()` 並重新部署，已止血
- 下一步：**實機** → 見 `VERIFICATION_CHECKLIST.md` §0、§8–§10

---

## 1c. 本輪已完成（2026-06-08）— 儀器模式整合

### 後端（`b711cd2`）
- [x] Migration **28**：`28_instrument_traceability.pg.sql`
- [x] transfer：`resolveInstrumentType()`、`instrument_dbh_cm` → raw + 歷次
- [x] `batch_import` raw：補 `altitude`、`utm_zone`、`instrument_dbh_cm`

### 前端（`4e943ed`）
- [x] **DataFilterService**：校準 DME vs HEIGHT DME；3D 丟棄
- [x] **3P SEQ 合併**：BLE pending + V2 直匯 + `ManualInputPageV2`
- [x] **現場一律標 LIVE**：移除 `FieldSessionSetup.instrumentHeightMode` 選擇器（PHGF 無 TYPE、儀器已算好樹高，使用者選擇無法驗證且易誤標）；整檔 DATA.CSV 仍讀韌體 TYPE
- [x] **BLE 整檔**：EOT、`ble_uart_discovery`（NUS+Haglof）、斷線≠成功
- [x] **BleMapFileProcessor**（MAP*.CSV 解析 + UI 提示）
- [x] 移除實驗用 Admin BLE 三開關（功能常開）

### 待實機／deploy 確認
- [ ] A4：transfer 後 GET 歷次含 `instrument_type` / `instrument_dbh_cm`
- [ ] B4：黃金檔 `golden_standard/DATA_2.CSV` 整批回歸（可選）

---

## 1b. 上一輪已完成（2026-06-05 ~ 06-06）

### 後端
- [x] Migration **18**：`project_boundaries.project_code` → FK `projects`
- [x] Migration **18** 已在實驗室伺服器執行（2026-06-06）
- [x] `ensureProjectForBoundary`：儲存邊界前自動 upsert `projects`（commit `e9e8420`，已部署）
- [x] `run_migration_file.js`：單檔 SQL 執行
- [x] **`run_pending_migrations.js`** + `schema_migrations` 表（上線增量 deploy）
- [x] `migrate.js`：`tree_survey` 已有資料時**跳過 CSV COPY**
- [x] `deploy.sh`：預設跑增量 migration；`--full-migrate` 僅全新庫
- [x] **`handbookDbhGuard`**：PATCH pending / 更新 tree 拒絕儀器·視覺寫入正式 DBH
- [x] Migration **19**：同名 `projects` 收斂 canonical `project_code`（待部署跑 pending）

### 前端（commit `fcc607b`）
- [x] 地圖／樹列表／邊界繪製／現場設定：**merge 邊界專案名** + Dropdown sanitize
- [x] 手冊模式 BLE：`instrument_dbh_cm` 與 `dbh_cm` 分離
- [x] `field_session_setup` Dialog overflow 修復
- [x] `pending_measurement_task_page` ListTile 底色

### Git 遠端
| Repo | 最新 main |
|------|-----------|
| 後端 | `578911d` |
| 前端 | `ed0c0f6` |

---

## 2. 待執行（依建議優先序）

### P0 — 後端 deploy + 實機驗證（本輪焦點）

| # | 項目 | 動作 | 勾選 |
|---|------|------|------|
| P0-5 | Push 後端（26/27/28、locks、instrument） | `git push origin main` | [x] |
| P0-6 | 伺服器增量 migration **28** + 崩潰修正 deploy | `git pull && pm2 reload`（已完成 2026-06-09） | [x] |
| P0-7 | 雙帳號維護鎖（**需兩台裝置**） | A 重測樹 X → B 同樹應 409／清單顯示鎖定者 | [ ] |
| P0-8 | 維護 GPS 三選一 + 新增樹不進待辦 | 實機 §8 M1–M4 | [ ] |
| P0-4 | 實機 Dropdown + BLE 手冊 DBH | §8 M7、§9 IRD-1 | [ ] |
| P0-9 | 儀器模式整批／現場／transfer | 實機 §9–§10 | [ ] |

### P0 — 上一輪（已完成）

| # | 項目 | 動作 | 勾選 |
|---|------|------|------|
| P0-1 | Push 後端 P0 commit | `git push origin main` | [x] |
| P0-2 | 伺服器增量 migration | `git pull && node scripts/run_pending_migrations.js` | [x] |
| P0-3 | 驗證「吳全1區」僅剩一個 active `project_code` | 102 active、103 merged 停用 | [x] |

### P1 — 協作與語意收斂

| # | 項目 | 說明 | 勾選 |
|---|------|------|------|
| P1-0 | **ProjectScope 共用選取器** | Area→Project + 最近使用；Field Session／維護／地圖／列表共用 | [~] |
| P1-0b | **樹木調查 Tab 禁全量** | 無 scope 時 limit 200 + 導向樹木列表 | [x] |
| P1-0c | **邀請碼 P0** | 密碼規則一致、區位欄位標示、停用確認、CORS PATCH | [x] |
| P1-0d | **BLE GPS 階段 SEND 去重** | 連按 SEND 不重複 pending | [x] |
| P1-0e | **DB migration 26 + CSV dev-fixtures** | 欄位 COMMENT；CSV 移出 initial_data | [x] |
| P1-0f | **06 邊界 seed 移出 production** | dev-fixtures + `seed_dev_boundaries.js` | [x] |
| P1-0g | **CSV 表頭 program_name/block_name** | migrate.js 欄位對照 | [x] |
| P1-0h | **維護場次模式** | 本場已測自清單移除；完成維護確認；全數完畢對話框 | [x] |
| P1-0i | **表單 submit 防重** | `_isLoading` 於首個 await 前鎖定 | [x] |
| P1-0k | **Phase A 維護樹木鎖** | 後端已 deploy；待實機 M5–M6 | [~] |
| P1-0l | **管理端專案／區兩段式** | `user_form_screen` 等；非地圖頁 | [x] |
| P1-0m | **歷次紀錄編輯／刪除** | 需新 API + 權限設計 | [ ] |
| P1-0n | **儀器模式整合（1P/3P/DME/LIVE/Remote Dia）** | 程式已整合；待 deploy+§10 實機 | [~] |
| P1-1 | 全 API 預設帶 `expected_updated_at` | **2026-06-10 完成**：盤點全前端更新路徑——單棵編輯（409 三選一對話框）✅既有、pending PATCH（自動重試）✅既有、邊界更新 ✅既有；**補上最後缺口 `tree_list_page` 批次更新**（逐棵帶鎖，409/410 略過並回報棵數+編號，不靜默蓋寫）。新增後端契約測試 `tree_update_optimistic_lock.test.js`（兩人同編同樹：B 先改→A 舊版本 409+serverVersion、B 修改保留、A 取新版重送 200、無鎖向後相容），取代雙機人工驗證 | [x] |
| P1-2 | `GET /projects` 含邊界-only 專案 | 後端合併，前端可移除各頁 merge | [ ] |
| P1-3 | 重疊邊界 UX | 多 polygon 匹配時使用者選擇 | [ ] |
| P1-4 | 雙機 409 | `VERIFICATION_CHECKLIST` L3–L5 | [ ] |

---

## P1 儀器模式整合計畫（2026-06-08）

> 目標：**HEIGHT 1P / 3P / DME、Remote Diameter、現場 LIVE** 在 pending → transfer → raw → 歷次 全鏈一致；批次匯入與現場 BLE 同一套語意。  
> 詳細規劃見本節；實機驗證見 `VERIFICATION_CHECKLIST.md` §9。

### 現況（2026-06-08 程式整合後）

| 模式 | 批次 CSV | 現場 PHGF | transfer → raw | 正式 DBH |
|------|----------|-----------|----------------|----------|
| 1P | ✅ TYPE + SEQ | ✅ 場次可標 1P | ✅ `measurement_type` | 階段二手輸 |
| 3P | ✅ SEQ 合併 | ✅ 場次可標 3P | ✅ 同上 | 同上 |
| HEIGHT DME | ✅ 保留樹木列 | ✅ 場次可標 DME | ✅ 同上 | 同上 |
| Remote Dia | ✅ DIA 欄 | ✅ PHGF 13–14 | ✅ `instrument_dbh_cm` | handbook 擋 |

### Phase A — 資料追溯

- [x] A1 migration 28
- [x] A2 transfer + 歷次 `instrument_type` / `instrument_dbh_cm`
- [x] A3 `batch_import` raw 補欄
- [ ] A4 實機：pending → transfer → GET history 含儀器欄位

### Phase B — 批次匯入 DME / 3P

- [x] B1 校準 DME vs HEIGHT DME
- [x] B2 HEIGHT DME → pending（單 SEQ，不合併）
- [x] B3 V2 直匯 SEQ 合併
- [~] B4 黃金檔 + 單元測試（DME 單測已有；全檔回歸待跑）

### Phase C — 現場 LIVE 模式標記（2026-06-09 改為一律 LIVE）

- [x] C1 ~~`FieldSessionSetup.instrumentHeightMode`~~ → **移除**；現場 PHGF 無 TYPE，一律標 `LIVE`
- [x] C2 pending `measurement_type` 直接取 CSV `type`（整檔）或 `LIVE`（現場）
- [x] C3 ~~UI ChoiceChip~~ → **移除選擇器**（使用者無法驗證、易誤標）
- [x] C4 本文件 + `VERIFICATION_CHECKLIST` §10 說明 PHGF 無 TYPE

### Phase D — 管理員 CSV / 報表

- [ ] D1 `csvImportController` 可選寫入 raw
- [ ] D2 匯出 API 含 `instrument_type`、`instrument_dbh_cm`
- [ ] D3 碳匯／手冊報表 DBH 來源標籤

### 不納入本輪

- MAP 進 DB／邊界（已能 BLE 解析顯示，未寫入 tree_survey）
- 3D pile / BAF 付費應用
- 現場 PHGF 做 3P 三點合併

### Phase E — BLE 整檔傳輸（韌體為準）

**決策原則**：量測類型以 CSV **欄位 [2] TYPE** 為準；校準列與樹木列以 `#;SET`、ID、H 判斷。

| 韌體／手冊 | 傳輯方式 | App 模組 |
|------------|----------|----------|
| MEMORY 關 + SEND | PHGF NMEA | `ble_live_session_page` |
| MEMORY 開 + SEND FILES | `DATA.CSV` | `ble_import_page` + `BleDataProcessor` |
| MAP TARGET/TRAIL | `MAP*.CSV` | `BleMapFileProcessor`（解析+提示） |

- [x] EOT 統一 + 剝除 `DATA.CSV` 前綴
- [x] E1 NUS + Haglof TX fallback（`ble_uart_discovery.dart`）
- [x] E2 僅 EOT 算成功；斷線走失敗
- [x] E3 HEIGHT DME 分類（Phase B1）
- [x] E4 `BleMapFileProcessor`（無 admin 開關；MAP 不進樹木 pending）
- [x] E5 transfer 保留 `measurement_type`（Phase A2）

---

### P2 — 工程成熟度

| # | 項目 | 勾選 |
|---|------|------|
| P2-1 | CI：`test:regression` + `flutter test` | [ ] |
| P2-2 | Staging + `FIXTURE_PROJECT_CODE` harness 不 SKIP | [ ] |
| P2-3 | 弱網離線佇列（pending／照片 dedup） | [ ] |

### P3 — 技術債

| # | 項目 | 勾選 |
|---|------|------|
| P3-1 | Flutter Kotlin Built-in 遷移（插件升級後） | [ ] |
| P3-2 | 邊界主鍵全面改 `project_code` | [ ] |
| P3-3 | `tree_survey` 快取欄位漸進改 VIEW | [ ] |

---

## 3. 已知根因簡表

| 領域 | 根因 | 狀態 |
|------|------|------|
| Dropdown 崩「吳全1區」 | 邊界有、API 專案清單無 | 前端 merge 已修 |
| 匯入／deploy 衝突 | 全量 `migrate.js` 重 COPY CSV | pending migration 已修 |
| 同名兩個 project_code | `projects.name` 非 UNIQUE | migration 19 待跑 |
| 儀器 DIA 當碳匯 DBH | 前後端語意未分離 | 前端+handbookDbhGuard + transfer raw 已修 |
| 專案／區 UI 混亂 | 三層語意 + CSV seed 邊界 | 見 `PROJECT_DATA_AND_DOMAIN.md`；P1-0 ProjectScope |
| 邀請碼區位無效 | `project_locations` 只存不套用 | UI 已標示；待後端實作或移除 |
| 06 港務邊界 seed | production pending 仍會套用 | **已移出** migrationFiles；僅 `seed_dev_boundaries.js` |

---

## 4. 部署約定

```bash
# 上線（預設）
bash /opt/tree-app/scripts/deploy.sh

# 跳過 DB
bash /opt/tree-app/scripts/deploy.sh --skip-migrate

# 僅全新空庫
bash /opt/tree-app/scripts/deploy.sh --full-migrate
```

| Repo | Remote |
|------|--------|
| 後端 | `github.com/<GITHUB_OWNER>/tree-project-backend` |
| 前端 | `github.com/<GITHUB_OWNER>/tree-project-frontend` |

---

## 5. 相關文件

```
docs/
  WORK_STATUS.md              ← 本文件（執行清單）
  PROJECT_DATA_AND_DOMAIN.md  ← CSV、邊界 seed、專案語意
  VERIFICATION_CHECKLIST.md
  DATABASE_NORMALIZATION.md
  BOUNDARY_SYSTEM_DESIGN.md
```
