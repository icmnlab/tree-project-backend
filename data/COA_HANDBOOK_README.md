# 森林碳匯手冊第六章 — 系統資料說明

## 檔案

| 檔案 | 手冊對照 |
|------|----------|
| `coa_table_6_4.json` | 表 6-4 林型係數（D, BEF, BCEF, R, CF） |
| `coa_volume_equations.json` | 表 6-2 針葉、表 6-3 闊葉材積式 |

> 註：早期的 `coa_species_forest_type.json`（空殼）與 `coa_volume_equations_starter.json`（啟動集）已移除；林型由 `handbookCarbonService` 依樹種推斷。

## 建置

```bash
python backend/scripts/build_coa_volume_equations.py
```

會覆寫 `coa_volume_equations.json`。請同步複製至 `frontend/assets/coa/`。

## 營運計算

- **預設**：`handbookCarbonService`（材積 → 生物量 → CO₂e）
- **舊 TIPC 反推**：僅在 `CARBON_CALC_LEGACY_TIPC=1` 時啟用 `tipc_kp_lookup.json`

## 擴充材積式

在 `build_coa_volume_equations.py` 的 `ENTRIES` 新增 `entry(...)` 後重新執行建置腳本。
公式型別：`power`, `quadratic`, `quadratic_dh`, `linear_dh`, `log_d_h`, `log_d`, `log_d2h`。
