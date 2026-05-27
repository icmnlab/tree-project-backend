# 樹木調查 APP — 產品路線圖

> 最後更新：2026-05-27  
> 範圍：Flutter 前端 + Node 後端 + ML 服務

## 1. 產品目標

支援**現場多人**同時調查：VLGEO2 儀器逐棵上傳、整合拍照（DBH 視覺 + 樹種 + 影像）、專案邊界、待測量任務閉環；並逐步完成**中英文介面**與**帳號邀請**體系。

---

## 2. 相機／拍照模式（已定義）

整合表單與獨立入口皆應支援下列模式（`CameraCaptureMode`）：

| 模式 | 說明 | 實作路徑 |
|------|------|----------|
| **plainPhoto** | 單純拍照，不觸發 AutoPilot | `ImagePicker` / 一般相機 |
| **integrated** | **整合拍照** = DBH 視覺測量 + 樹種辨識 + 拍照；需即時 **YOLO／TFLite 樹幹框**與使用者手動調整框 | `ScannerPage`（即時框 → 拍照 → 量測 → 回傳 `MeasurementResult`） |
| **photoWithSpecies** | 一般相機拍照後僅做樹種辨識 | `ImagePicker` + `SpeciesIdentificationService` |

**重要**：整合表單過去僅用 `TreeImageService.captureImage()` + 靜態 `_runAutoPilot`，**沒有** `ScannerPage` 的即時框；整合模式必須走 `ScannerPage`。

### 2.1 整合拍照流程（目標 UX）

```
相機預覽（TFLite 即時 bbox）
  → 使用者拍照
  → 確認／調整樹幹框（drawBbox）
  → 後端深度 + DBH
  → 回傳表單：影像路徑 + DBH + bbox（供紀錄／複測）
  → 表單內樹種辨識（若尚未由 Scanner 完成）
```

### 2.2 待辦（相機）

- [x] P0：`CameraCaptureService` + 表單模式選擇
- [ ] P1：整合模式完成量測後可選「僅帶照片不回 DBH」
- [ ] P2：多鏡頭／廣角校正提示、距離雷達（若硬體支援）

---

## 3. 現場 BLE／VLGEO2（已定義）

| 項目 | 狀態 | 說明 |
|------|------|------|
| 逐棵 SEND → 待測量 → 整合表單 | ✅ 已實作 | `BleLiveSessionPage` + `sessionId` |
| **手選 BLE 裝置**（非自動連第一台） | ✅ | `BleDeviceScanner` 共用元件 |
| **獨立「現場測量」入口** | ✅ | `FieldSurveyFlowPage` wizard |
| MEMORY 關、GATT 長連 | ✅ 文件化 | 見 `VLGEO2_STD_APPLICATION_GUIDE.md` |
| 一台手機一條 GATT | 設計限制 | 多人各用各機；同一 VLGEO2 不可多機同時連 |

### 3.1 現場測量 Wizard（P0）

1. 選擇流程：VLGEO2 現場連線 / 待測量任務 / 手動整合表單  
2. 若 BLE：掃描列表 → 使用者點選 → `BleLiveSessionPage(device: …)`  
3. 每棵：SEND → 上傳 1 筆 → `IntegratedTreeFormPage`（預設 **integrated** 拍照模式）

---

## 4. 多人／高併發（設計要點）

### 4.1 客戶端

- 每次現場場次使用 **`liveSessionId`**（UUID），上傳待測量時帶 `session_id` / metadata。  
- 上傳請求帶 **`X-Request-Id`**（冪等），避免弱網重試造成重複列。  
- BLE 處理中鎖定 UI，禁止重複 SEND。  
- 離線佇列：待測量本地快取 + 恢復連線後批次同步（既有 `PendingMeasurementService` 延伸）。

### 4.2 後端

| 情境 | 策略 | 狀態 |
|------|------|------|
| 同專案多人同時寫入 | DB 交易 + 權限；PATCH 樂觀鎖 `expected_updated_at` → 409 | ✅ PATCH |
| 批次重複上傳 | `api_request_dedup` + `X-Request-Id`（TTL 24h） | ✅ POST `/batch` |
| ML 服務尖峰 | 佇列 + 每使用者 rate limit；前端指數退避 |
| 單台 VLGEO2 | 僅允許一 GATT；第二台提示「裝置已被連線」 |
| 管理員大量匯入 | 與現場寫入分 queue，低優先 |

### 4.3 權限與資料隔離

- 角色：`調查員` / `專案管理員` / `系統管理員`（既有）  
- 專案邊界、待測量列表依 **user → project** 關聯過濾  
- 稽核 log：`user_id`, `session_id`, `device_ble_mac`（可選）

---

## 5. 國際化 i18n（P1）

- [x] P0 骨架：`LocaleService` + `AppStrings`（zh / en）  
- [x] P1：主要流程（`home_page`、`integrated_tree_form` 拍照、BLE／現場 Wizard）  
- [ ] P2：其餘頁面 + ARB + `flutter gen-l10n`、跟隨系統語言

---

## 6. 帳號體系

- [x] **邀請碼註冊**：`POST /api/register` + App `RegisterPage`（管理員：`POST /api/invites`）  
- [ ] Email 連結、密碼重設、裝置綁定

---

## 7. 已完成的技術里程碑（摘要）

- DBH 引擎路由（`DbhEngine` / `DbhEngineResolver`）  
- BLE 現場 NMEA 解碼 + 逐棵流程  
- 專案邊界建議 API + 繪製 UX  
- Gradle / release 建置（Android 14+）

---

## 8. 實作優先順序

| 優先 | 工作項 | 預估 |
|------|--------|------|
| **P0** | 相機三模式 + 整合表單接 Scanner | 本輪 |
| **P0** | BLE 手選裝置 + 現場測量 Wizard | 本輪 |
| **P1** | i18n 主要流程字串 | 1–2 週 |
| **P1** | 後端 request-id 去重 + 409 衝突 | 1 週 |
| **P2** | 帳號邀請註冊 | 2+ 週 |
| **P2** | Xiang LiDAR API 接線 | 依硬體 |

---

## 9. 2026-05-27 BUG 修復紀錄

### 409 樂觀鎖
- 修復：`in_progress` PATCH 後 UI 仍用舊 `updated_at` → 假 409（整合表單、待測量、BLE 現場）
- 修復：提交成功未檢查 `success`、manualMerge 未更新 lock 基準
- 修復：`tree_survey` GET 補回 `updated_at` 欄位

### 專案邊界
- 修復：Express 路由 `/:projectName` 攔截 `/by_code/...`
- 修復：登出未清 `ProjectBoundaryService` 快取
- 修復：繪製頁切換專案後 `project_code` 寫錯
- 修復：UPSERT 時 `project_code` 被 NULL 覆寫（COALESCE）
- 修復：`find_project` / `batch_match` / `check` / `status` 權限過濾

詳見：`docs/VERIFICATION_CHECKLIST.md`

---

## 10. 關鍵檔案

| 用途 | 路徑 |
|------|------|
| 整合表單 | `frontend/lib/screens/v3/integrated_tree_form_page.dart` |
| YOLO 相機 | `frontend/lib/screens/scanner_page.dart` |
| 相機模式 | `frontend/lib/models/camera_capture_mode.dart` |
| 拍照服務 | `frontend/lib/services/camera_capture_service.dart` |
| BLE 掃描 | `frontend/lib/widgets/ble/ble_device_scanner.dart` |
| 現場 Wizard | `frontend/lib/screens/field_survey/field_survey_flow_page.dart` |
| 現場 BLE | `frontend/lib/screens/ble_live_session_page.dart` |
| VLGEO2 協定 | `docs/VLGEO2_STD_APPLICATION_GUIDE.md` |
| 驗證清單 | `docs/VERIFICATION_CHECKLIST.md` |
| 實驗室部署 | `docs/LAB_DEPLOYMENT_GUIDE.md` |
| 資料庫正規化 | `docs/DATABASE_NORMALIZATION.md` |
