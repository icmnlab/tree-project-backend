# Dev fixtures（非 production deploy）

| 檔案 | 用途 |
|------|------|
| `tree_survey_data.csv` | 港務測試樹木；僅 `migrate.js --full` 空庫 COPY |
| `tree_survey_column_map.json` | CSV 表頭 `program_name` / `block_name` → DB 欄位對照 |
| `06_project_boundaries_seed.pg.sql` | 港務 convex-hull 邊界；**不**在 production pending migration |

## 邊界 seed（僅本機／測試庫）

```bash
node scripts/seed_dev_boundaries.js
node scripts/seed_dev_boundaries.js --dry-run
```

正式環境：App **手動繪製**或**匯入座標檔**（見 `BOUNDARY_SYSTEM_DESIGN.md`）。
