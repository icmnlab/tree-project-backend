# 同一棵樹的多次調查（歷次資料）

> 更新：2026-06-07

## 目前機制（已上線）

| 層級 | 表 / 元件 | 行為 |
|------|-----------|------|
| **快照** | `tree_survey` | 每棵樹一筆「目前值」；最新 transfer / 維護 / 手動編輯會更新 |
| **量測歷次** | `tree_survey_measurements` | 每次 **pending transfer**（`new` / `maintenance`）追加一列；migration 17 回填 `snapshot` |
| **儀器原始** | `tree_measurement_raw` | BLE 距離、GPS、raw JSON；transfer 時寫入 |
| **操作稽核** | `audit_logs` | 登入、建樹、改樹、CSV 等（**不含 transfer**） |
| **前端** | `TreeMeasurementHistoryPanel` | 樹詳情、維護量測、整合表單內時間軸 |

### survey_mode 語意

| 值 | 來源 |
|----|------|
| `new` | 現場 transfer 新建 tree_survey |
| `maintenance` | 對既有 `target_tree_id` 複查 |
| `snapshot` | migration 17 對歷史資料的 baseline 回填 |

## 已知缺口（2026-06-07 修復進度）

| 缺口 | 狀態 |
|------|------|
| transfer 寫歷次失敗被 silent skip | **已修**（失敗則整批 rollback） |
| 手動 `update_v2` / CSV 不寫歷次 | 待辦（P1） |
| transfer 無 audit log | 待辦（P1） |
| `UPDATE_TREE` 無 before/after | 待辦（P1） |
| 刪樹 CASCADE 刪歷次 | 待辦（P3 soft delete） |

## 實務建議

1. **複查既有樹**：走維護量測 + `survey_mode=maintenance` + `target_tree_id`。
2. **新植／新點**：`survey_mode=new`，transfer 後產生新 `system_tree_id`。
3. **研究匯出**：現階段可查 `tree_survey_measurements` + `tree_measurement_raw`；手動修正尚未全進時間軸。

## 相關文件

- `backend/docs/WORK_STATUS.md`
- `backend/database/initial_data/15_tree_survey_measurements.pg.sql`
