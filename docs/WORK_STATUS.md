# 工作狀態總覽（2026-05-27）

> 本文件整合產品路線圖、BUG 審計、修復紀錄、驗證與部署；與 `APP_PRODUCT_ROADMAP.md` 互補。  
> 口試 handover 佇列：`口試準備/_session_handover/work_queue.md`

---

## 1. 本輪已完成

### 產品功能（P0）
- [x] 三種拍照模式 + `ScannerPage` 整合拍照（YOLO 框）
- [x] 現場測量 Wizard + BLE 手選裝置
- [x] `X-Request-Id` 批次去重（後端）
- [x] 邀請碼註冊（`POST /api/register`、`RegisterPage`）
- [x] i18n 主要流程（`lib/l10n/app_strings.dart`）

### 409 樂觀鎖修復
- [x] `in_progress` 後刷新 `updated_at`（待測量 / BLE / 整合表單 `_lockUpdatedAt`）
- [x] 提交檢查 `success`、manualMerge 更新 lock
- [x] `tree_survey` GET 回傳 `updated_at`

### 專案邊界修復
- [x] 路由順序（`/:projectName` 移到最后）
- [x] 登出清邊界快取
- [x] 繪製頁依專案解析 `project_code`
- [x] UPSERT `COALESCE` 保留 code/area
- [x] `find_project` / `batch_match` / `check` / `status` 權限過濾

### 文件
- [x] `VERIFICATION_CHECKLIST.md` — 一次驗證用
- [x] `LAB_DEPLOYMENT_GUIDE.md` — 實驗室脫離個人帳號
- [x] `DATABASE_NORMALIZATION.md` — 2NF 說明

---

## 2. 進行中 / 待做

| 優先 | 項目 | 說明 |
|------|------|------|
| P1 | 邊界驗證 fail-closed | 本輪改 async 失敗不放行、BLE 強制刷新快取 |
| P1 | 重疊邊界 UX | 多專案匹配時讓使用者選擇 |
| P1 | 管理 Web UI | 見 `LAB_DEPLOYMENT_GUIDE.md` §5 |
| P2 | 邊界主鍵改 `project_code` | DB 遷移 + App 全面改 code |
| P2 | 全 App i18n（ARB） | 其餘頁面字串 |
| P2 | `create_lab_admin.js` | 實驗室首次建管理員腳本 |

---

## 3. 已知 BUG 根因（簡表）

| 領域 | 根因 | 狀態 |
|------|------|------|
| 假 409 | PATCH in_progress 前進 `updated_at`，UI 未刷新 | 已修 |
| 邊界 by_code 404 | Express 路由順序 | 已修 |
| 錯專案 code | 繪製頁用 widget 固定 code | 已修 |
| 跨帳號邊界 | 單例快取未清 | 已修 |
| 樹木無鎖 | GET 無 `updated_at` | 已修 |
| 更名不同步 | `project_name` 非 FK | 待 DB 演進 |

---

## 4. Git 推送約定

| Repo | Remote | 路徑 |
|------|--------|------|
| 後端 | `github.com/KyleliuNDHU/tree-project-backend` | `project_code/backend` |
| 前端 | `github.com/KyleliuNDHU/tree-project-frontend` | `project_code/frontend` |

**原則**：功能完成 + 通過相關測試後 push `main`；不提交 `.env`、大型 third_party 子模組變更。

---

## 5. 驗證

請依 **`VERIFICATION_CHECKLIST.md`** 勾選；問題用清單末尾模板回報。

---

## 6. 相關路徑

```
project_code/docs/
  WORK_STATUS.md          ← 本文件
  APP_PRODUCT_ROADMAP.md
  VERIFICATION_CHECKLIST.md
  LAB_DEPLOYMENT_GUIDE.md
  DATABASE_NORMALIZATION.md
```
