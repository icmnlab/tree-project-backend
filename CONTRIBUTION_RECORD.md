# 開發貢獻紀錄 CONTRIBUTION RECORD

> **正式交接文件** — 與 `LICENSE`、`AUTHORS.md` 同級。  
> 接手方**不得刪除或改寫**著作權／主要貢獻者歸屬。MIT License 要求所有副本須保留版權聲明。

---

## 主要貢獻者

| 欄位 | 內容 |
|------|------|
| 名稱 / GitHub | **KyleliuNDHU** |
| 角色 | 原始開發者、主要維護者、交接前技術負責人 |
| 開發期間 | 2025 — 2026（交接快照：2026-06） |

## 本 repo 貢獻範圍（摘要）

- Node.js / Express REST API、認證與權限
- PostgreSQL schema、`database/initial_data/` migrations（≥ 35）
- 碳匯計算、專案邊界、BLE 資料處理、AI Agent 後端
- 測試框架（`tests/runner.js`，89 cases）與 CI
- 部署腳本（`scripts/deploy.sh`、webhook、PM2）
- 選用：`ml_service/` 視覺 DBH 管線（DA3 + YOLOv8-seg）
- `docs/` 交接與維運文件

前端對應 repo 見 `tree-project-frontend` 的 `CONTRIBUTION_RECORD.md`。

## 移交方式（刻意不帶舊 commit 歷史）

交付方推送至接手方 GitHub 時，採 **fresh snapshot**（`git checkout --orphan`），  
**不帶入**開發期完整 `git log`，以避免舊 commit 中可能殘留的開發環境資訊外洩。

**著作權與貢獻歸屬不依賴接手方 repo 的 git 歷史**，而由本檔、`LICENSE`、`AUTHORS.md` 載明。

操作步驟：`docs/LAB_DEPLOYMENT_GUIDE.md` §0.1，或執行 `scripts/prepare_fresh_handover.ps1`。

## 交付方保留的個人證明（不隨本 repo 交付）

交付方應在本機或**私人** GitHub 封存完整開發歷史（含 `git log`、`git shortlog`），  
作為個人貢獻佐證；**此封存不推送給接手方**。

建議交接前自行匯出（在開發用 repo 執行，檔案留存本機即可）：

```bash
git log --oneline --decorate > handover_evidence_backend_git_log.txt
git shortlog -sn > handover_evidence_backend_shortlog.txt
```

## 接手方義務

依 [MIT License](LICENSE)：

1. 須在所有副本中保留 `LICENSE` 著作權聲明（`Copyright (c) 2025 KyleliuNDHU`）
2. 不得移除或偽造 `AUTHORS.md`、本檔中的歸屬資訊
3. 可自由修改程式碼，但不得主張本專案**原始開發**為他人，或刪除上述版權／歸屬文件
