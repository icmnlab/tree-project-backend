# 專案邊界 — 全系統設計與情境對照

> 回答：「先新增專案 → 智慧表單／地圖／BLE 會不會出問題？」  
> 程式協調：`lib/services/v3/project_boundary_coordinator.dart`

---

## 1. 核心原則

1. **專案（`projects`）與邊界（`project_boundaries`）分離** — 新建專案**不會**自動有 polygon。  
2. **無邊界 = 手動模式** — 允許調查，但 GPS **不會**自動匹配到該專案（除非點落在別專案邊界內）。  
3. **有邊界後** — 自動匹配、座標驗證、BLE 指派、地圖顯示皆依 polygon；**必須刷新快取**才一致。  
4. **權威專案 metadata** — 以 `projects` 表為準；邊界列的 `project_area` / `project_code` 僅為快取，BLE 與匹配後會用 `ProjectBoundaryCoordinator.enrichProjectFields` 補齊。

---

## 2. 使用者旅程與系統行為

### 2.1 新建專案（無邊界）

```
新增專案 (projects)
    → 可選：立刻繪製邊界 (ProjectBoundaryDrawPage)
    → 若跳過：status = 無邊界 / canSuggest（≥3 棵 GPS 樹）
```

| 功能 | 無邊界時行為 | 已修復？ |
|------|-------------|---------|
| V3 智慧表單自動匹配 | 不匹配；需手選專案 | ✅ 設計如此 |
| V3 手動模式提交 | 允許；chip 顯示「尚未畫邊界」 | ✅ |
| 地圖 polygon | 不顯示該專案 | ✅ |
| V2 單筆樹木 | 允許提交 | ✅ + server 驗證 |
| BLE 匯入 | 全 outside → 手動指派 | ✅ |
| 整合表單／待測量 | 不驗邊界（儀器流程） | ⚠️ 現為 warnOnly 提示 |

### 2.2 剛畫完邊界（關鍵）

**過去 BUG**：快取 5 分鐘 + 繪製頁儲存未通知 → 地圖／智慧表單仍「看不到／匹配不到」新邊界。

**現在**：

- 繪製頁儲存成功 → `ProjectBoundaryCoordinator.afterBoundaryMutation()`
- V3 新增專案返回 → `afterBoundaryMutation` + 重載地圖 overlay + 刷新 status chip
- V2 新增專案返回 → `afterBoundaryMutation`
- 智慧匹配前 → `beforeAutoMatch()` = `forceRefresh`
- 地圖進入 → `forMapDisplay(forceRefresh: true)`（地圖頁原本即有）
- BLE 匯入 → `getAllBoundaries(forceRefresh: true)`（原本即有）

### 2.3 登出／換帳號

- `AuthService.clearSession()` → `ProjectBoundaryService.clearCache()` ✅

---

## 3. 各頁面職責（單一表）

| 頁面 | 邊界職責 | Coordinator API |
|------|---------|-----------------|
| `manual_input_page_v3` | 匹配、驗證、新專案引導、地圖 overlay | `beforeAutoMatch`, `evaluateSubmit`, `afterBoundaryMutation`, `forMapDisplay` |
| `tree_input_page_v2` | 提交驗證、新專案引導 | `evaluateSubmit`, `afterBoundaryMutation` |
| `project_boundary_draw_page` | CRUD polygon | `afterBoundaryMutation` |
| `map_page` | 顯示、篩選 | `forMapDisplay`（經 service forceRefresh） |
| `ble_import_page` | GPS→專案指派 | `forceRefresh` + `enrichProjectFields` |
| `integrated_tree_form_page` | 提交前 warnOnly | `evaluateSubmit(warnOnly)` |
| `pending_measurement_task_page` | 無直接邊界 | — |

---

## 4. 仍須知／長期改進

| 項目 | 說明 |
|------|------|
| 邊界主鍵為 `project_name` | 專案改名後邊界需手動同步或 DB 遷移 → `project_code` |
| 重疊邊界 | 多專案重疊時取第一個；應加使用者選擇 UI |
| BLE 未用 `/batch_match` | 與後端權限／重疊語意未完全對齊 |
| 刪除專案順序 | 應先刪邊界再刪專案（後端／cleanup 需一致） |

---

## 5. 驗證建議（新增專案路徑）

見 `VERIFICATION_CHECKLIST.md` 第 7 節「新建專案全流程」。
