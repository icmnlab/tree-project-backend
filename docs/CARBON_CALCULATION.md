# 碳匯計算 — 欄位、公式與文獻

## tree_survey 欄位（請勿合併為單一數值）

| 欄位 | 中文 | 單位 | 意義 |
|------|------|------|------|
| `carbon_storage` | 碳儲存量 | kg CO₂e | 單木**現況**碳儲量（存量） |
| `carbon_sequestration_per_year` | 推估年碳吸存量 | kg CO₂e/年 | **每年**固碳量（流量） |

UI 上合併為**一張卡片、兩列資料**即可；數值上不能只留下其中一個，否則統計頁「總年碳吸存量」與論文敘述會失真。

## 客戶端可重算項目

依 **農業部《森林碳匯調查與監測手冊》第六章**（與後端 `handbookCarbonService.js` 一致）：

1. 材積 V：表 6-2 / 6-3（`assets/coa/coa_volume_equations.json`）
2. 地上生物量：V × D × BEF（表 6-4）
3. 總生物量：× (1 + R)
4. 碳量：× CF
5. CO₂e：× (44/12) × 1000 → **kg CO₂e** 寫入 `carbon_storage`

程式入口：

- 前端：`HandbookCarbonService` / `CarbonCalculationService`
- 後端：`services/handbookCarbonService.js`（預設）、`CARBON_CALC_LEGACY_TIPC=1` 時 TIPC 相容式

## 客戶端不重算項目

- **`carbon_sequestration_per_year`**：涉及樹齡與 TIPC 未公開公式；編輯表單僅顯示／提交 DB 既有值，自動試算留白。

## 文獻（論文與口試請引用）

1. 農業部林業及自然保育署 (2024). *森林碳匯調查與監測手冊*.
2. 環境部 (2023). *溫室氣體減量方法學 AR-TMS0001 造林與植林碳匯專案活動* v01.0.
3. 後端 `carbonCalculationService.js` 註解：TIPC 逆向驗證與針闊葉常數簡化說明（論文需揭露偏差）。

## 顯示規範

全系統標籤與單位見 `lib/utils/carbon_display.dart`。
