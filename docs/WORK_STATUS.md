# 工作狀態總覽（2026-06-07 晚）

> 執行清單請依序勾選。細節：`PROJECT_DATA_AND_DOMAIN.md`、`VERIFICATION_CHECKLIST.md`、`frontend/docs/EXPERIMENTAL_FEATURES.md`

---

## 1. 已完成（可勾掉）

### 現場／後端核心
- [x] 假 409：PATCH pending 毫秒 pre-check 通過後不再 `WHERE updated_at`（`bb3d655`）
- [x] 歷次量測冪等：`tree_survey_measurements.pending_id` UNIQUE + transfer skip（migration 21）
- [x] BLE 計數：UI 用 `completedCount+1`（`7cbe799`）
- [x] `by_area` 補漏：migration 21 回填 `area_id` + orphan 查詢
- [x] 生產啟動：`app.js` → `run_pending_migrations.js`（不再全量 COPY CSV）（`68e6c5e`）
- [x] 樹種目錄 SSOT：移除 `tree_species.json` fallback，只用 PostgreSQL
- [x] 同名專案 UX：孤兒 `area_id` 指派到目前港區（`POST /projects/add`）
- [x] Ubuntu 部署：`68e6c5e` online，log 為 `[Startup] Pending migrations completed`

### 前端精簡
- [x] 首頁隱藏：AI 助理、永續報告、掃描 Demo、V3 設定（`ENABLE_EXPERIMENTAL_UI` 可恢復）
- [x] **保留**首頁「樹種辨識」卡片
- [x] 移除 bundled / backend 冗餘 `tree_species.json`
- [x] 手冊模式預設：視覺 DBH 不寫入正式 DBH（研究模式可開）

### Git 遠端
| Repo | main |
|------|------|
| 後端 | `68e6c5e` |
| 前端 | `9310b4a`（樹種卡片保留：本機待 commit 小改） |

---

## 2. 待執行 — P0（本週）

| # | 項目 | 動作 | 勾選 |
|---|------|------|------|
| P0-1 | 前端小改 commit | `species` 從 experimental 名單移除 | [ ] |
| P0-2 | 實機 L1–L2 | 409、BLE 計數、專案 test／區塊 reassign | [ ] |
| P0-3 | `tree_survey_page` overflow | Row @652 小螢幕 `Expanded` | [ ] |
| P0-4 | 環境學院正式庫策略 | 空庫 + pending migrations；**不**跑 CSV／港務 seed | [ ] |

---

## 3. 待執行 — P1（產品／語意）

| # | 項目 | 說明 | 勾選 |
|---|------|------|------|
| P1-1 | 專案／港區術語統一 | UI：港區 → 樣區；文件對齊 `PROJECT_DATA_AND_DOMAIN.md` | [ ] |
| P1-2 | `projects.area_id NOT NULL` | 新專案強制 FK；逐步移除 `by_area` orphan fallback | [ ] |
| P1-3 | 重疊邊界 UX | 多 polygon 匹配時使用者選擇 | [ ] |
| P1-4 | 雙機樂觀鎖實測 | VERIFICATION L3–L5 | [ ] |
| P1-5 | 匯入模板調整 | 管理員 CSV 模板改環境學院欄位，與港務 seed 脫鉤 | [ ] |
| P1-6 | Webhook deploy 穩定 | dirty tree 時 deploy 失敗 — 文件化 `git reset --hard` 流程 | [ ] |

---

## 4. 待執行 — P2（資料庫／程式精簡）

> **原則：** 現場表不刪；研究／legacy 表可標記 deprecated 或 migration 22+ 選擇性 DROP（需先查 prod 是否有資料）。

| # | 表／功能 | 現況 | 建議 | 勾選 |
|---|----------|------|------|------|
| P2-1 | RAG `tree_knowledge_embeddings*` | migrate 已移除建表；**prod 可能仍有舊表** | SSH `\\dt *embed*` 確認 → 空表可 DROP | [ ] |
| P2-2 | `tree_carbon_data` / `species_region_score` / `emission_factors` | 已不在 migrate | 同上查 prod → DROP + 清 README／agent dead query | [ ] |
| P2-3 | Admin `/run-script` RAG 腳本 | 指向已刪的 `generateEmbeddings.js` 等 | 移除 case 或改「已廢止」 | [ ] |
| P2-4 | `chat_logs` | AI 聊天仍寫入（若開 experimental UI） | 保留；定期 cleanup 已有 | [ ] |
| P2-5 | `tree_management_actions` | 後端 API 有、**前端無入口** | 保留 schema；或標 research-only | [ ] |
| P2-6 | `ml_training_*` | BLE 修正上傳預設關 | 研究用保留；正式可不建表（新庫） | [ ] |
| P2-7 | `research_dataset` | 管理後台研究蒐集 | 保留（論文用） | [ ] |
| P2-8 | `tree_measurement_raw` | BLE transfer 寫儀器原始參數 | **保留**（儀器整合核心） | [ ] |
| P2-9 | `users.associated_projects` | 雙寫 `user_projects` | 過渡期保留；長期 deprecate | [ ] |
| P2-10 | 港務 `tree_survey` ~7063 筆 | 測試種子 | 環境學院正式庫不匯入；dev 可保留 | [ ] |
| P2-11 | `agentDataTools.js` | 仍查 `tree_carbon_data` | 刪 dead query 或改 handbook 公式 | [ ] |
| P2-12 | 前端 `api_service` carbon-sink | 路由已不存在 | 刪 dead methods | [ ] |

### 必須保留（勿刪）
`projects` · `project_areas` · `project_boundaries` · `tree_survey` · `tree_survey_measurements` · `pending_tree_measurements` · `tree_species` · `species_synonyms` · `tree_images` · `user_projects` · `tree_measurement_raw`

---

## 5. 待執行 — P3（工程／論文）

| # | 項目 | 勾選 |
|---|------|------|
| P3-1 | CI：`test:regression` + 關鍵 `flutter test` | [ ] |
| P3-2 | Staging + `FIXTURE_PROJECT_CODE` harness 實機 | [ ] |
| P3-3 | 弱網離線佇列（pending／照片 dedup） | [ ] |
| P3-4 | Flutter Kotlin Built-in 遷移 | [ ] |
| P3-5 | 圖資中心主機遷移（新 SSH／baseUrl） | [ ] |
| P3-6 | VLGEO2 V3.7 韌體文件收斂 | [ ] |

---

## 6. 部署約定

```bash
bash /opt/tree-app/scripts/deploy.sh              # 增量（預設）
bash /opt/tree-app/scripts/deploy.sh --skip-migrate
# 勿在正式庫：--full-migrate
```

環境變數建議：`SKIP_CSV_IMPORT=1`（雙保險）

---

## 7. 相關文件

- `PROJECT_DATA_AND_DOMAIN.md` — CSV、樹種 SSOT、專案語意
- `VERIFICATION_CHECKLIST.md` — 實機勾選
- `frontend/docs/EXPERIMENTAL_FEATURES.md` — 隱藏功能如何恢復
