# 碳匯計算 — 欄位、公式與文獻

## tree_survey 欄位（請勿合併為單一數值）

| 欄位 | 中文 | 單位 | 意義 |
|------|------|------|------|
| `carbon_storage` | 碳儲存量 | kg CO₂e | 單木**現況**碳儲量（存量） |
| `carbon_sequestration_per_year` | 推估年碳吸存量 | kg CO₂e/年 | **每年**固碳量（流量） |

UI 上合併為**一張卡片、兩列資料**即可；數值上不能只留下其中一個，否則統計頁「總年碳吸存量」與論文敘述會失真。

## 客戶端可重算項目

依 **農業部《森林碳匯調查與監測手冊》第六章**（與後端 `handbookCarbonService.js` 一致）：

1. 材積 V：表 6-2 / 6-3（前端 `frontend/assets/coa/coa_volume_equations.json`；後端同步副本 `backend/data/coa_volume_equations.json`）
2. 地上生物量：V × D × BEF（表 6-4）
3. 總生物量：× (1 + R)
4. 碳量：× CF
5. CO₂e：× (44/12) × 1000 → **kg CO₂e** 寫入 `carbon_storage`

程式入口：

- 前端：`HandbookCarbonService` / `CarbonCalculationService`
- 後端：`services/handbookCarbonService.js`（預設）、`CARBON_CALC_LEGACY_TIPC=1` 時 TIPC 相容式

## 客戶端不重算項目

- **`carbon_sequestration_per_year`**：涉及樹齡與 TIPC 未公開公式；編輯表單僅顯示／提交 DB 既有值，自動試算留白。

## 統計範圍：僅計活立木（淘汰木不計入）

依政府「**活立木生物量法**」（農業部《森林碳匯調查與監測手冊》表 6-4、環境部 AR-TMS0001），碳儲量與年碳吸存量總計**只納入存活樹木**。系統以 `tree_survey.lifecycle_status` 控制：

- `active`：計入活立木碳匯與在庫統計、列入維護待辦。
- `dead` / `fallen` / `removed`（枯死／倒塌／移除）：**不計入**活立木碳匯總計與在庫統計，但**保留歷史**並可單獨統計（`statistics.js` 回傳 `retired` 概況）。

後端所有碳匯/統計查詢均加 `WHERE lifecycle_status = 'active'`，涵蓋 `routes/statistics.js`、`controllers/reportController.js`、`controllers/aiReportController.js`、`services/agentDataTools.js`。生命週期狀態的設定/復原見 `SURVEY_HISTORY.md` 與 `utils/treeLifecycle.js`；端點 `POST /tree_survey/:id/retire`、`/restore`。

> **2026-06-15 修正（枯立木）**：「枯立木」（立枯死木 snag）依專業定義屬**非活立木**，應為 `dead`。早期 migration 31 回填僅認「枯死/死亡」而漏掉「枯立木」，使這類樹被誤計入活立木碳匯。migration 33 已回填 `status LIKE '%枯立%'` → `lifecycle='dead'`，`utils/treeLifecycle.js` 亦同步。各狀況的活立木歸類由 `tree_status_options.lifecycle` 維護：正常/傾斜/病蟲害/**枯萎**=active（枯萎為可回復逆境，仍屬活立木）、枯立木/枯死=dead、倒塌=fallen、已移除=removed；如需調整可於目錄表修改。

## 文獻（論文與口試請引用）

1. 農業部林業及自然保育署 (2024). *森林碳匯調查與監測手冊*.
2. 環境部 (2023). *溫室氣體減量方法學 AR-TMS0001 造林與植林碳匯專案活動* v01.0.
3. 後端 `carbonCalculationService.js` 註解：TIPC 逆向驗證與針闊葉常數簡化說明（論文需揭露偏差）。

## 顯示規範

全系統標籤與單位見 `lib/utils/carbon_display.dart`。
