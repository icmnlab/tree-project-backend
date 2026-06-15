# 同一棵樹的多次調查（歷次資料）

> 更新：2026-06-13

## 目前機制（已上線）

| 層級 | 表 / 元件 | 行為 |
|------|-----------|------|
| **快照** | `tree_survey` | 每棵樹一筆「目前值」；最新 transfer / 維護 / 手動編輯會更新；含 `lifecycle_status`/`retired_at`/`retired_reason` |
| **量測歷次** | `tree_survey_measurements` | 每次 **pending transfer**（`new` / `maintenance`）追加一列；migration 17 回填 `snapshot` |
| **量測照片** | `tree_images.measurement_id` | 照片可選綁定某次量測歷史；transfer 時將本次 pending 照片連到新歷史列 |
| **儀器原始** | `tree_measurement_raw` | BLE 距離、GPS、raw JSON；transfer 時寫入 |
| **操作稽核** | `audit_logs` | 登入、建樹、改樹、CSV、淘汰/復原（`RETIRE_TREE`/`RESTORE_TREE`） |
| **前端** | `TreeMeasurementHistoryPanel` | 樹詳情、維護量測、整合表單內時間軸；展開含該次縮圖 |

## 樹木生命週期（lifecycle_status）

| 值 | 意義 | 碳匯 | 地圖/清單 | 維護待辦 |
|----|------|------|-----------|----------|
| `active` | 存活 | 計入活立木碳儲量 | 正常 | 列入 |
| `dead` | 枯死 | **不計入**（活立木生物量法） | 灰階 + 「已淘汰」 | 排除 |
| `fallen` | 倒塌 | **不計入** | 灰階 | 排除 |
| `removed` | 移除/砍除 | **不計入** | 灰階 | 排除 |

- 推導：重測樹況選枯死/倒塌/移除即自動淘汰；恢復正常自動復原（`utils/treeLifecycle.js`）。
- 手動：`POST /tree_survey/:id/retire`、`POST /tree_survey/:id/restore`（`調查管理員`+）。
- 樹種繼承：維護重測未填樹種時沿用既有樹種（前端預填 + 後端安全網），不再覆寫成「待辨識」。

### survey_mode 語意

| 值 | 來源 |
|----|------|
| `new` | 現場 transfer 新建 tree_survey；**或智慧/快速模式手動新增**（2026-06-10 起 `create_v2` 同步寫入初始快照，`pending_id=NULL`） |
| `maintenance` | 對既有 `target_tree_id` 複查 |
| `snapshot` | migration 17 對歷史資料的 baseline 回填 |

## 已知缺口（2026-06-11 修復進度）

| 缺口 | 狀態 |
|------|------|
| transfer 寫歷次失敗被 silent skip | **已修**（失敗則整批 rollback） |
| 手動新增（`create_v2`）不寫歷次 | **已修**（2026-06-10，建樹同 transaction 寫入 `survey_mode='new'` 快照） |
| 手動 `update_v2` / CSV 匯入不寫歷次 | **刻意不寫**：編輯是「修正目前值」而非新量測；CSV 匯入屬測試資料。如需編輯軌跡見 audit_logs 待辦 |
| transfer 無 audit log | 待辦（P1） |
| `UPDATE_TREE` 無 before/after | 待辦（P1） |
| 刪樹 CASCADE 刪歷次 | **改採軟性淘汰**：枯死/倒塌/移除用 `lifecycle_status`（保留歷史/照片、可復原）；硬刪除仍保留給管理員 |

## 實務建議

1. **複查既有樹**：走維護量測 + `survey_mode=maintenance` + `target_tree_id`。
2. **新植／新點**：`survey_mode=new`，transfer 後產生新 `system_tree_id`。
3. **研究匯出**：現階段可查 `tree_survey_measurements` + `tree_measurement_raw`；手動修正尚未全進時間軸。

## 相關文件

- `docs/HANDOFF.md`
- `backend/database/initial_data/15_tree_survey_measurements.pg.sql`
