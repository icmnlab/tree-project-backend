# 四種新增輸入 × 一種編輯 — 寫庫欄位、ID 與同步對照

> **適用對象**：接手開發者、交接驗收、後端維運  
> **版本**：2026-06-18  
> **搭配閱讀**：`FIELD_SURVEY_SOP.md`（現場操作）、`SURVEY_HISTORY.md`（歷次量測）、`HANDOFF.md` §12（實驗功能）

---

## 1. 五條資料路徑（四新增 + 一編輯）

| # | 名稱 | 首頁／入口 | 前端頁面 | 寫庫 API | 是否寫歷次 |
|---|------|-----------|----------|----------|-----------|
| **1** | VLGEO2 現場連線 | 儀表板「VLGEO2 現場連線」 | `BleLiveSessionPage` → `IntegratedTreeFormPage` | `PATCH` pending → **`POST /pending-measurements/transfer`**（每棵提交後自動 transfer） | ✅ |
| **2** | 藍牙批次 → 待測量 | 「藍牙匯入」→「待測量任務」 | `BleImportPage` → `PendingMeasurementTaskPage` → 整合表單 | 同上（批次或手動觸發 transfer） | ✅ |
| **3** | 智慧模式新增 | 「樹木調查」→ 新增 → 智慧模式 | `ManualInputPageV3` | **`POST /tree_survey/create_v2`** | ✅（首筆 `survey_mode=new`） |
| **4** | 快速模式新增 | 「樹木調查」→ 新增 → 快速模式 | `TreeInputPageV2` | **`POST /tree_survey/create_v2`** | ✅ |
| **編輯** | 修正既有樹 | 樹木詳情 → 編輯 | `TreeEditPageV2` | **`PUT /tree_survey/update_v2/:id`** | ❌ **刻意不寫**（修正快照，非新量測） |

> **維護量測**是路徑 1 的變體：`survey_mode=maintenance` + `target_tree_id`，transfer 時 **UPDATE** 既有 `tree_survey` 並追加歷次。  
> **SOP 主推路徑 1**；路徑 2 程式保留但 `FIELD_SURVEY_SOP.md` §9 標為暫緩主推。

---

## 2. `tree_survey` 欄位 — 四條新增路徑是否一致？

**結論：核心調查欄位一致，但 BLE 與手動路徑在「備註拆分」與「儀器附表」上有刻意差異；智慧模式表單送出的欄位比快速模式少。**

### 2.1 核心欄位（四條新增皆會寫入）

| 欄位 | BLE transfer（1、2） | create_v2（3、4） | 說明 |
|------|---------------------|-------------------|------|
| `system_tree_id` | 伺服器 `ST-{n}` | 同上 | 見 §4 |
| `project_tree_id` | 伺服器 `PT-{n}`（依 `project_code`） | 同上 | 見 §4 |
| `project_code` | pending 場次設定 | 表單 | trigger 09 同步 `project_id`、區名 |
| `project_location` / `project_name` | pending | 表單（trigger 覆蓋） | DB 鍵名不變；畫面詞見 `HANDOFF.md` 詞彙表 |
| `species_id` / `species_name` | 表單；維護未填則**繼承**既有樹 | 表單；後端可 lookup | 入庫前 `toTraditional` |
| `x_coord` / `y_coord` | pending 手機 GPS | 表單 GPS 或手 key | BLE：**儀器不傳 GPS** |
| `tree_height_m` | BLE 儀器 | 表單 | |
| `dbh_cm` | 表單 `measured_dbh_cm`（手冊：手動胸徑） | 表單 | 儀器 DIA **不**當正式 DBH |
| `status` | 從 `measurement_notes` 解析 `樹況:` 前綴 | 表單 `status` | 見 §2.3 |
| `survey_notes` | `measurement_notes` 全文 | `survey_notes` / `survey_remark` | |
| `survey_time` | `completed_at` | 表單 | |
| `carbon_storage` | 後端重算（手冊公式） | 後端重算（忽略前端預覽值） | 見 `CARBON_CALCULATION.md` |
| `lifecycle_status` 等 | 由 `status` 推導 | 同上 | `lifecycleFromStatus` |

### 2.2 僅部分路徑會寫的欄位

| 欄位 | 路徑 1、2（BLE） | 路徑 3、4（手動） | 風險 |
|------|-----------------|------------------|------|
| `notes`（註記） | **不寫**（維持 NULL／預設） | 快速模式有 `note`；**智慧模式未送** | 智慧新增缺「註記」 |
| `tree_notes`（樹木備註） | **不寫** | 僅快速模式有 `tree_remark`；**智慧模式未送** | 同上 |
| `carbon_sequestration_per_year` | **NULL**（後端不推算） | 快速模式可送；智慧模式未送 → 0 | 年吸存皆待演算法 |
| `tree_measurement_raw` | ✅ 儀器距離、方位、raw JSON | ❌ 無 | 僅 BLE 可追溯儀器 |
| 歷次 `instrument_type` / `instrument_dbh_cm` | ✅ | ❌ | 契約測試 `instrument_traceability.test.js` |

### 2.3 前端表單差異（容易「漏填」的來源）

| 項目 | 整合表單（1、2） | 智慧模式（3） | 快速模式（4） | 編輯 |
|------|-----------------|--------------|--------------|------|
| 樹況選單 | 動態 `TreeStatusService` | 動態 | 靜態 chip | 靜態（已補淘汰項，未接動態目錄） |
| GPS | **必填**（無 GPS 不建 pending） | 建議自動抓 | 可手 key | 可改座標 |
| 樹高 | BLE 預填 | 手動 | 手動 | 可改 |
| 照片 | 建議；transfer 前盡量 sync | 背景 `TreeImageService` | 通常無 | 可補 |
| 備註欄位 | 合併進 `measurement_notes` | 僅 `note` → `notes` | `note` + `tree_remark` + `survey_notes` | 同快速 |

**整合表單樹況格式**：送出時可能為 `樹況: 正常 | 使用者備註`；transfer 用 `parseTreeStatusFromNotes()` 取 `樹況:` 前綴，其餘進 `survey_notes`。

---

## 3. 編輯路徑（`update_v2`）

- 更新 `tree_survey` 快照欄位；**不**新增 `tree_survey_measurements` 列（見 `SURVEY_HISTORY.md`）。
- 支援 `expected_updated_at` 樂觀鎖（409 + 衝突 UI）。
- 樹況變更會連動 `lifecycle_status`（與 create / transfer 同一套 `lifecycleFromStatus`）。
- 複查既有樹應走**維護量測 + transfer**，不要只靠編輯假裝新量測。

---

## 4. ID 生成（四條新增共用規則）

實作：`treeSurveyCreateController.js`（create_v2）、`pending_measurements.js`（transfer 新樹分支）。

1. **交易內 advisory lock**：`SELECT pg_advisory_xact_lock(1)` — create_v2 與 transfer **共用同一把鎖**，避免 `ST-` / `PT-` 碰撞。
2. **`system_tree_id`**：`ST-{MAX+1}`，排除 `is_placeholder=true` 與非 `ST-數字` 格式。
3. **`project_tree_id`**：依 `project_code` 分開計數 `PT-{MAX+1}`，排除 `PT-0` 與 placeholder。
4. **回傳給前端**：create_v2 回 `id`、`system_tree_id`、`project_tree_id`；transfer 回 `id_mapping[]`（`pending_id` → `tree_survey_id`）。
5. **觸發器 09**：INSERT 時若缺 `project_id`，依 `project_code` 補連結並覆蓋 `project_location` / `project_name` cache。

### 4.1 現場連線的 ID 同步（路徑 1）

```
BLE SEND → 建立 pending（session_id 整場共用）
→ 整合表單 PATCH completed
→ transfer（可能表單內已 transfer 一次，ble_live 再冪等 transfer）
→ id_mapping 回傳正式 tree_survey_id
→ 照片 owner pending→survey；measurement_id 綁定該次歷次
```

- `lib/utils/transfer_result.dart`：從 transfer 回應解析正式 id（避免冪等第二次 mapping 空陣列導致維護清單錯亂）。
- `IntegratedTreeFormPage.onTreeSurveyTransferred`：表單內 transfer 成功時回拋 id 給 `BleLiveSessionPage`。

---

## 5. 背景同步

| 機制 | 觸發 | 後端 | 適用路徑 |
|------|------|------|----------|
| `TreeImageService` | App 啟動／存照後 | `POST /tree-images/upload` | 3、4、整合表單；transfer 時遷移 pending 照片 |
| `MLDataSyncService` | 每 30 分鐘（需 `ENABLE_ML_CORRECTION_UPLOAD`） | `/ml-training/...` | 研究用修正紀錄 |
| `HandbookCarbonService` | 啟動 preload | 無（assets JSON） | 表單**預覽**碳；正式值後端算 |
| pending transfer | 提交後 | `POST /transfer` | 1、2 |

---

## 6. ML / 邊緣推論（選用，不影響主流程必填欄位）

僅在啟用視覺 DBH 時相關；**正式現場 SOP 仍以手動胸徑為準**。

| 層級 | 硬體 | 模型 | 角色 |
|------|------|------|------|
| 手機 | CPU / NPU（TFLite） | YOLOv8n | **僅 bbox 預覽**，不決定最終 DBH |
| 邊緣伺服器 | Intel **iGPU**（OpenVINO） | YOLOv8m-seg | 伺服器端樹幹 mask |
| 邊緣伺服器 | Intel **NPU**（OpenVINO） | Depth Anything v3 metric-large | 公制深度 → DBH |

部署：`backend/ml_service/start.ps1 -Preset da3`；環境變數見 `ml_service/README.md`、`HANDOVER_CHECKLIST.md` §2.1。  
研究精度與 benchmark 見 `DBH_PURE_VISION_RESEARCH.md`（論文級細節非維運必讀）。

---

## 7. 首頁預設隱藏的功能（程式保留）

正式 APK 預設 `ENABLE_EXPERIMENTAL_UI=false`（`lib/config/app_config.dart`）。下列儀表板卡片**預設不顯示**：

| 卡片 id | 功能 | 恢復方式 |
|---------|------|----------|
| `test_scan` | 掃描測試 Demo | `--dart-define=ENABLE_EXPERIMENTAL_UI=true` |
| `ai` | AI 助理 | 同上 + LLM 金鑰 |
| `report` | 碳匯永續報告 | 同上 |
| `v3` | 系統設定（校準、ML 同步） | 同上 |

**預設保留顯示**：現場連線、維護量測、藍牙匯入、待測量、樹木調查、地圖、區管理、統計、**樹種辨識**。  
底部導覽為 **2 Tab**（首頁／樹木列表）；`TreeSurveyPage` 僅經卡片或下鑽進入。

---

## 8. 已知缺口與後續建議

| 項目 | 狀態 | 建議 |
|------|------|------|
| 智慧模式缺 `tree_remark` / `survey_notes` 分欄 | 已知 | 若要與快速模式一致，擴充 `manual_input_page_v3` payload |
| BLE transfer 不寫 `notes` / `tree_notes` | 設計取捨 | 儀器細節在 `tree_measurement_raw`；使用者備註在 `survey_notes` |
| 快速／編輯頁樹況靜態清單 | 技術債 | 改接 `TreeStatusService` 與 V3 一致 |
| `ManualInputPageV2` | 僅 `BleImportPage` 批次匯入子路徑 | 非第四輸入；SOP 不主推 |
| 年碳吸存 | 全路徑未正式推算 | 待 `CARBON_CALCULATION.md` 差分演算法 |

---

## 9. 相關程式索引

| 用途 | 路徑 |
|------|------|
| create_v2 | `backend/controllers/treeSurveyCreateController.js` |
| transfer | `backend/routes/pending_measurements.js` |
| update_v2 | `backend/controllers/treeSurveyUpdateController.js` |
| 生命週期 | `backend/utils/treeLifecycle.js` |
| 整合表單 | `frontend/lib/screens/v3/integrated_tree_form_page.dart` |
| 智慧／快速新增 | `frontend/lib/screens/v3/manual_input_page_v3.dart`、`tree_input_page_v2.dart` |
| 實驗 UI 旗標 | `frontend/lib/config/app_config.dart` |
| 契約測試 | `backend/tests/contracts/tree_lifecycle_retire.test.js`、`instrument_traceability.test.js` |
