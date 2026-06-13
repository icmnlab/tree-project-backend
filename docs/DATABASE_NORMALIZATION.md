# 資料庫正規化說明（二階正規化 2NF）

> 更新：2026-06-11。正式結論見 `PROJECT_DATA_AND_DOMAIN.md` §5.5（**符合 2NF**；本文補充歷史脈絡與刻意反規範的設計取捨）。

## 簡短結論

**所有表皆符合 2NF**（單欄主鍵下不存在部分依賴；`user_projects` 複合鍵欄位皆完全依賴整鍵）。  
**調查業務表**（`tree_survey`、`pending_tree_measurements`、`project_boundaries`）為了現場效能與歷史相容，**刻意冗餘** `project_name`、`project_area` 等字串（屬 3NF 層級的取捨，不違反 2NF）。  
邊界表早期未與 `projects.project_code` 建 FK 的問題，**已由 migration `18_project_boundaries_fk.pg.sql` 修復**（建立 `fk_project_boundaries_project_code`，`ON DELETE SET NULL / ON UPDATE CASCADE`）。

---

## 2NF 定義（複習）

- 表在 **1NF**（欄位原子、有主鍵）
- 所有非鍵欄位 **完全依賴** 整個主鍵（不能只依賴複合鍵的一部分）

---

## 符合 2NF 的區塊

| 表 | 主鍵 | 說明 |
|----|------|------|
| `projects` | `project_code`（或 id） | 專案屬性依賴專案鍵 |
| `project_areas` | `id` | 區位名稱、縣市等依賴區位鍵 |
| `users` | `user_id` | 帳號欄位依賴使用者鍵 |
| `user_projects` | `(user_id, project_code)` | 關聯表，僅依賴複合鍵 |
| `tree_species`（若存在） | 樹種 id | 樹種屬性依賴樹種鍵 |

---

## 未嚴格 2NF／刻意反規範的區塊

### `tree_survey`

- 同時存 `project_code`、`project_name`、`project_location`（專案區位字串）
- `project_name` **函數依賴**於 `project_code`（應可由 `projects` JOIN 得出）→ 違反 3NF，也帶來更名不同步

### `project_boundaries`

- 主鍵語意：`project_name` UNIQUE
- `project_code` 可為 NULL，但**已建 FK**（migration 18：`fk_project_boundaries_project_code`）
- `boundary_coordinates` JSONB 仍以 `project_name` 為主要對齊鍵（建議演進見下）
- `source`（migration 30）：邊界輸入來源（draw|coords|kml|geojson|suggest），完全相依於代理鍵 `id`，不影響 2NF/3NF；既有列 NULL

### `pending_tree_measurements`

- 冗餘 `project_area`、`project_code`、`project_name` 便於離線/批次上傳
- 合理 trade-off，但需與 `projects` 同步策略

---

## 建議演進（實驗室長期）

1. **邊界表主鍵改為 `project_code`**（FK → `projects`），`project_name` 改為可更新快照或 VIEW
2. **`tree_survey`** 寫入以 `project_code` 為準；顯示名稱一律 JOIN
3. 遷移腳本：依 `projects.name` 回填 `project_boundaries.project_code`（**已實作** `16_project_boundaries_backfill.pg.sql`；服務啟動時亦會冪等執行）
4. 應用層（App + 管理 Web）**禁止**只靠名稱字串匹配

---

## 與功能 BUG 的關係

| 正規化問題 | 造成的現象 | 狀態 |
|------------|------------|------|
| 邊界 keyed by name | 區改名後邊界「消失」 | 程式層已緩解 |
| code 可 NULL | 權限過濾漏列、BLE 匹配錯區 | migration 16/18/20 回填+stub |
| 無 FK | UPSERT 覆寫 code 為 NULL | **已修**（migration 18 建 FK） |

程式修復（COALESCE、路由順序、登出清快取、儲存時解析 code）+ migration 16/18/20 已落地；長期仍建議上節的資料模型演進。
