# 工作狀態總覽（2026-06-07）

> 執行清單請依序勾選。細節見 `PROJECT_DATA_AND_DOMAIN.md`（CSV／專案語意）、`VERIFICATION_CHECKLIST.md`（實機驗證）。

---

## 1. 本輪已完成（2026-06-05 ~ 06-07）

### 後端
- [x] Migration **18**：`project_boundaries.project_code` → FK `projects`
- [x] Migration **18** 已在實驗室伺服器執行（2026-06-06）
- [x] `ensureProjectForBoundary`：儲存邊界前自動 upsert `projects`（commit `e9e8420`，已部署）
- [x] **`run_pending_migrations.js`** + `schema_migrations` 表（上線增量 deploy）
- [x] `migrate.js`：`tree_survey` 已有資料時**跳過 CSV COPY**
- [x] `deploy.sh`：預設跑增量 migration；`--full-migrate` 僅全新庫
- [x] **`handbookDbhGuard`**：PATCH pending / 更新 tree 拒絕儀器·視覺寫入正式 DBH
- [x] Migration **19**：同名 `projects` 收斂 canonical `project_code`（伺服器已跑）
- [x] **P1-2** `GET /projects` 合併 boundary-only 專案（`utils/projectCatalog.js`）
- [x] Migration **20**：邊界 stub + 再次 dedupe + active name UNIQUE
- [x] `ensureProjectForBoundary` / `POST /projects/add`：禁止同名 active 重複
- [x] 樂觀鎖：PATCH pending / update_v2 使用**伺服器** `updated_at` 做 WHERE（修假 409）
- [x] transfer 寫 `tree_survey_measurements` 失敗時整批 rollback（不再 silent skip）

### 前端（本輪 WIP，待 commit + 實機 L1–L2）
- [x] 地圖／樹列表／現場設定：改依 `GET /projects`（移除各頁 boundary merge）
- [x] 整合表單：提交前 `fetchTaskById` 刷新樂觀鎖基準

### Git 遠端
| Repo | 最新 main（部署前） |
|------|-----------|
| 後端 | `53e6a8b` + 本機 WIP |
| 前端 | `fcc607b` + 本機 WIP |

---

## 2. 待執行（依建議優先序）

### P0 — 部署本輪修復

| # | 項目 | 動作 | 勾選 |
|---|------|------|------|
| P0-1 | Commit + push 後端／前端 | 含 migration 20、P1-2 | [ ] |
| P0-2 | 伺服器增量 migration | `git pull && node scripts/run_pending_migrations.js && pm2 reload tree-backend` | [ ] |
| P0-3 | 驗證 boundary-only 樣區出現在 Dropdown | 高雄南星第1樣區等 | [ ] |
| P0-4 | 實機 L1–L2（409 假衝突） | `flutter run --dart-define=ENABLE_FIELD_LOGS=true` | [ ] |

### P1 — 協作與語意收斂

| # | 項目 | 說明 | 勾選 |
|---|------|------|------|
| P1-1 | 全 API 預設帶 `expected_updated_at` | 樹木編輯、pending 提交 | [ ] |
| P1-2 | `GET /projects` 含邊界-only 專案 | 後端合併，前端移除各頁 merge | [x] |
| P1-3 | 重疊邊界 UX | 多 polygon 匹配時使用者選擇 | [ ] |
| P1-4 | 雙機 409 | `VERIFICATION_CHECKLIST` L3–L5 | [ ] |

### P2 — 工程成熟度

| # | 項目 | 勾選 |
|---|------|------|
| P2-1 | CI：`test:regression` + `flutter test` | [ ] |
| P2-2 | Staging + `FIXTURE_PROJECT_CODE` harness 不 SKIP | [ ] |
| P2-3 | 弱網離線佇列（pending／照片 dedup） | [ ] |

### P3 — 技術債

| # | 項目 | 勾選 |
|---|------|------|
| P3-1 | Flutter Kotlin Built-in 遷移（插件升級後） | [ ] |
| P3-2 | 邊界主鍵全面改 `project_code` | [ ] |
| P3-3 | `tree_survey` 快取欄位漸進改 VIEW | [ ] |

---

## 3. 已知根因簡表

| 領域 | 根因 | 狀態 |
|------|------|------|
| Dropdown 崩「吳全1區」 | 邊界有、API 專案清單無 | 前端 merge 已修 |
| 匯入／deploy 衝突 | 全量 `migrate.js` 重 COPY CSV | pending migration 已修 |
| 同名兩個 project_code | `projects.name` 非 UNIQUE | migration 19 待跑 |
| 儀器 DIA 當碳匯 DBH | 前後端語意未分離 | 前端+handbookDbhGuard 已修 |
| 專案／區 UI 混亂 | 三層語意 + CSV seed 邊界 | 見 `PROJECT_DATA_AND_DOMAIN.md` |

---

## 4. 部署約定

```bash
bash /opt/tree-app/scripts/deploy.sh              # 增量 migration（預設）
bash /opt/tree-app/scripts/deploy.sh --skip-migrate
bash /opt/tree-app/scripts/deploy.sh --full-migrate # 全新空庫 only
```

---

## 5. 相關文件

- `PROJECT_DATA_AND_DOMAIN.md` — CSV、邊界 seed、專案語意
- `VERIFICATION_CHECKLIST.md`
- `DATABASE_NORMALIZATION.md`
- `BOUNDARY_SYSTEM_DESIGN.md`
