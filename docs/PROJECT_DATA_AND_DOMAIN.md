# 歷史資料、上線資料流與專案／區位語意

> 更新：2026-06-08  
> 對照：`DATABASE_NORMALIZATION.md`、`BOUNDARY_SYSTEM_DESIGN.md`、`WORK_STATUS.md`

---

## 1. `tree_survey_data.csv` 是做什麼的？

| 項目 | 說明 |
|------|------|
| **本質** | 港務／歷次調查的**靜態種子資料**（約 7000+ 棵），來自早期 Excel／匯出檔 |
| **路徑** | `backend/dev-fixtures/tree_survey_data.csv`（2026-06 自 initial_data 移出） |
| **誰用** | 僅 **`node scripts/migrate.js` 全新空庫**時，以 PostgreSQL `COPY` 灌入 `tree_survey` |
| **上線後** | **不應再跑**這段 COPY；正式資料來自 **App 現場量測、管理員 CSV 匯入 API、維護重測** |
| **業界做法** | 種子檔放 repo 或 artifact storage，**與 migration 分離**；生產 deploy 只跑 **增量 schema migration**（本專案：`run_pending_migrations.js` + `schema_migrations` 表） |

### CSV 欄位與語意（一列 = 一棵樹）

| CSV 欄 | DB 欄 | UI 語意 |
|--------|-------|---------|
| `program_name` | `tree_survey.project_location` | **專案**（港區，例：高雄港）→ `project_areas.area_name` |
| `project_code` | `project_code` | **穩定主鍵** → `projects.project_code` |
| `block_name` | `project_name` | **區**（樣區，例：高雄港區植栽1區）→ `projects.name` |
| 其餘 | GPS、樹種、DBH、碳匯等 | 調查業務欄位 |

`migrate.js` 以 `CSV_HEADER_TO_DB` 對照表頭；舊表頭 `project_location` / `project_name` 仍相容。

---

## 2. 為何會從 CSV「自動畫邊界」？這跟混亂有關嗎？

**有關，但是設計取捨 + 後續手繪疊加造成的。**

```
tree_survey_data.csv
    ↓ migrate.js COPY（僅開發／首次建庫）
tree_survey（每棵樹有 GPS）
    ↓ 離線腳本產生 convex hull + 10m buffer（僅 dev-fixtures，非 production）
dev-fixtures/06_project_boundaries_seed.pg.sql  →  node scripts/seed_dev_boundaries.js
```

| 現象 | 原因 |
|------|------|
| 地圖上看到港區樣區邊界 | 若跑過 **dev seed**，polygon 來自歷史 CSV 樹位 convex hull |
| production deploy | **`run_pending_migrations.js` 不再套用 06**；邊界由 App **手動繪製**或**匯入座標檔** |
| 「吳全1區」只在邊界、不在 `/projects` | **手繪邊界**後來新增，當時未同步 `projects` 表（已用 migration 18 + `ensureProjectForBoundary` 修） |
| 同名專案兩個 `project_code`（102、103） | 歷史匯入／手動建專案**未強制 name UNIQUE**（migration 19 收斂） |
| App 裡「專案」「區」「區位」混用 | 三層語意疊在同一 UI，見下節 |

**上線後**：新邊界應由**專案管理員手繪**或匯入座標檔；不會再從 CSV 重算。既有 DB 若曾跑過 dev seed，polygon 可保留作測試參考或手動刪除。

---

## 3. 專案／區 — 標準語意（2026-05 定案，請全隊統一）

> **表名與 DB 欄位名暫不 rename**；以 COMMENT + API `domain` 別名 + 前端 `ProjectScope` 統一 UI。

| UI 詞 | 前端 `ProjectScope` | DB 欄（快取／權威） | 舊稱（勿再用） |
|-------|---------------------|---------------------|----------------|
| **專案** | `programName` | `project_location` ← `project_areas.area_name` | 專案區位、港區 |
| **區** | `blockName` | `project_name` ← `projects.name` | 樣區名、舊 UI「專案」 |
| **代碼** | `projectCode` | `projects.project_code` | — |

### 易混欄位

| DB 欄 | 語意 |
|-------|------|
| `project_boundaries.project_area` | 常與 UI「專案」同值；**不是** UI「區」 |
| `pending_tree_measurements.project_area` | UI「專案」 |
| `pending_tree_measurements.project_name` | UI「區」 |

### 測試 CSV（`dev-fixtures/tree_survey_data.csv`）

| CSV 欄 | UI | 範例 |
|--------|-----|------|
| `project_location` | **專案** | 高雄港 |
| `project_name` | **區** | 高雄港區植栽1區 |
| `project_code` | 代碼 | 3 |

詳見 `backend/dev-fixtures/tree_survey_column_map.json`。

---

## 3（舊）. 專案／區／區位 — 歷史對照（deprecated 用詞）

| 我們用的詞 | DB / API | 正確語意 | 錯誤理解 |
|-----------|----------|----------|----------|
| ~~**專案區位**~~ | → UI **專案** | 港區／縣市（高雄港、臺中港） | ≠ 樣區名 |
| ~~**專案（名稱）**~~ | → UI **區** | **樣區／區塊**（高雄港區植栽1區） | ≠ 整個港 |
| **專案代碼** | `projects.project_code` | **全系統穩定主鍵**（寫入、權限、FK 一律用它） | 不要用 name 當鍵 |
| **區 / Block** | `project_boundaries.project_area`、現場 `project_area` | 常與「專案區位」混用；App 現場多指**同港區下的分區標籤** | 需與 `project_areas` 對齊 |
| **邊界** | `project_boundaries.boundary_coordinates` | 某 **project_name** 的 GIS 多邊形 | 不等於 `projects` 列是否存在 |

### 資料權威順序（業界 single source of truth）

1. **`projects`**：`project_code` + `name` + `area_id` → 專案是否存在、屬哪個港區  
2. **`project_boundaries`**：polygon + 快取 `project_code` / `project_area`（應與 1 同步）  
3. **`tree_survey`**：`project_code` 為準；`project_name` / `project_location` 為 **trigger 09 維護的快取**  

---

## 4. 上線後資料怎麼進系統？（業界對照）

| 通道 | 用途 | 本專案 |
|------|------|--------|
| 行動 App 現場 | 主要寫入 | BLE → pending → 整合表單 → `tree_survey` |
| 管理 CSV 匯入 | 批次補遺／離線整理 | `csvImportController` + advisory lock |
| Schema migration | 結構演進 | `run_pending_migrations.js`（**無 CSV**） |
| 種子／fixture | 測試 only | `tree_survey_data.csv`、`QA-FIXTURE` seed |

---

## 5. 樹種目錄（非「本地資料庫」）

| 來源 | 用途 |
|------|------|
| **`tree_species`**（PostgreSQL） | 唯一主檔：`id` / `name` / `scientific_name`；表單下拉、辨識綁定 `species_id` |
| **`species_synonyms`** | 俗名／別名 → canonical species |
| ~~`tree_species.json`~~ | **已移除**（早期靜態 fallback；id 格式與 DB 不一致） |

Pl@ntNet 辨識後：`matchLocalSpecies()` 查 PostgreSQL；若無匹配且信心 ≥15% 則 `autoAddSpeciesFromIdentification()` 寫入 `tree_species`。

---

## 5.5 資料庫正規化結論（2NF 符合度，2026-06-10）

**結論：符合 2NF。**

- 2NF 的定義是「符合 1NF，且每個非鍵屬性完全相依於整個主鍵（沒有部分相依）」。
  部分相依只會發生在**複合主鍵**的表。本系統所有資料表（`tree_survey`、`projects`、
  `project_areas`、`tree_species`、`users`、`pending_tree_measurements`、
  `tree_measurement_raw`、`tree_images`、`project_boundaries`…）一律使用
  **單欄代理鍵**（`id SERIAL/BIGSERIAL PRIMARY KEY`），不存在部分相依 → 2NF 成立。
- 主要實體均已拆出主檔並以 FK 關聯：`projects`（`project_code` UNIQUE）、
  `project_areas`、`tree_species`（+`species_synonyms`）、`users`（+`user_projects`）。
  歷史量測拆到 `tree_measurement_raw` / `tree_survey_measurements`，影像拆到
  `tree_images`（見 `tree_images_2nf_migration.pg.sql`）。
- 已知的**刻意反正規化**（3NF 層級的取捨，非 2NF 問題）：`tree_survey` 上的
  `project_name` / `project_code` / `project_location` / `species_name` 為讀取效能快取欄，
  正典值在 `projects` / `tree_species`，由 cascade trigger（migration 09/10/11）同步，
  改名時自動回填。這是業界常見的 read-optimized 設計，已有觸發器保證一致性。

---

## 6. 執行清單（照 WORK_STATUS.md 追蹤）

見 **`docs/WORK_STATUS.md` §2**：P0 部署策略、專案去重、手冊 DBH 護欄、專案語意收斂。
