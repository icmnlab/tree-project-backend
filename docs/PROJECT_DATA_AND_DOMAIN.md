# 歷史資料、上線資料流與專案／區位語意

> 更新：2026-06-07  
> 對照：`DATABASE_NORMALIZATION.md`、`BOUNDARY_SYSTEM_DESIGN.md`、`WORK_STATUS.md`

---

## 1. `tree_survey_data.csv` 是做什麼的？

| 項目 | 說明 |
|------|------|
| **本質** | 港務／歷次調查的**靜態種子資料**（約 7000+ 棵），來自早期 Excel／匯出檔 |
| **誰用** | 僅 **`node scripts/migrate.js` 全新空庫**時，以 PostgreSQL `COPY` 灌入 `tree_survey` |
| **上線後** | **不應再跑**這段 COPY；正式資料來自 **App 現場量測、管理員 CSV 匯入 API、維護重測** |
| **業界做法** | 種子檔與 schema migration **分離**；生產 deploy 用 `run_pending_migrations.js` + `schema_migrations` |

### CSV 欄位語意

| CSV 欄 | 語意 |
|--------|------|
| `project_location` | **港區**（高雄港、臺中港）→ `project_areas` |
| `project_code` | **穩定主鍵** → `projects.project_code` |
| `project_name` | **樣區名**（高雄港區植栽1區）→ `projects.name` |

---

## 2. CSV 與自動邊界、混亂的關係

```
tree_survey_data.csv → migrate COPY → tree_survey（GPS）
    → 離線 convex hull → 06_project_boundaries_seed.pg.sql（35 個港務樣區邊界）
```

- **06 seed 邊界**：依歷史 CSV 樹位**預先算好**寫進 SQL，不是每次 deploy 重算。
- **手繪邊界**（如吳全1區）：後來疊加，若未建 `projects` 列會與 API 清單脫鉤（已修）。
- **上線後**不再從 CSV 畫邊界；新 polygon 由管理員繪製或建議邊界。

---

## 3. 專案／區／區位 — 標準語意

| 詞 | DB | 語意 |
|----|-----|------|
| 專案區位 | `project_areas.area_name` | 港區（高雄港） |
| 專案名稱 | `projects.name` | 樣區（植栽1區、吳全1區） |
| 專案代碼 | `projects.project_code` | **全系統主鍵** |
| 邊界 | `project_boundaries` | 樣區 polygon |

權威順序：`projects` → `project_boundaries` → `tree_survey`（快取由 trigger 09 同步）。

---

## 4. 上線資料通道

| 通道 | 用途 |
|------|------|
| App 現場 | 主要寫入 |
| CSV 匯入 API | 批次補遺 |
| `run_pending_migrations.js` | 僅 schema，**無 CSV** |
| `tree_survey_data.csv` | 開發種子 only |

## 5. 樹種目錄（非「本地資料庫」）

| 來源 | 用途 |
|------|------|
| **`tree_species`**（PostgreSQL） | 唯一主檔：`id` / `name` / `scientific_name`；表單下拉、辨識綁定 `species_id` |
| **`species_synonyms`** | 俗名／別名 → canonical species |
| ~~`tree_species.json`~~ | **已移除**（早期靜態 fallback；id 格式與 DB 不一致） |

Pl@ntNet 辨識後：`matchLocalSpecies()` 查 PostgreSQL；若無匹配且信心 ≥15% 則 `autoAddSpeciesFromIdentification()` 寫入 `tree_species`。

執行清單見 `WORK_STATUS.md` §2。
