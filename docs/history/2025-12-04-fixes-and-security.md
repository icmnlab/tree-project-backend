# 2025-12-04 更新與修復紀錄

## 1. 資料庫與後端修復 (Backend)

### 資料庫結構變更
*   **Table**: `tree_survey`
*   **Change**: 新增 `is_placeholder` 欄位 (Boolean, Default: false)。
*   **Purpose**: 用於標記「專案佔位資料」(Project Placeholder)。
    *   當建立新專案時，系統會自動產生一筆 `PT-0` 的資料來佔用該專案代碼。
    *   過去因為缺少此欄位，導致新增專案時發生 `column "is_placeholder" does not exist` 錯誤。

### API 邏輯修正
*   **GET /api/tree_surveys** (樹木列表)
    *   新增過濾條件：`WHERE (is_placeholder IS NULL OR is_placeholder = false)`。
    *   效果：前端列表不再顯示 `__PLACEHOLDER__` (PT-0) 的無效資料。
*   **GET /api/tree_surveys/map** (地圖資料)
    *   新增過濾條件：同上。
    *   效果：地圖上不會出現座標為 (0,0) 或無效的佔位點。

### 專案建立流程
*   現在建立專案時，會正確寫入 `is_placeholder: true`。
*   第一筆使用者輸入的樹木資料將會從 `PT-1` 開始編號 (因為 `PT-0` 已被佔位)。

---

## 2. 安全性增強 (Security)

### Git 忽略清單 (.gitignore)
已全面更新 Backend 與 Frontend 的 `.gitignore` 設定，確保敏感資料不會被上傳。

*   **Backend**:
    *   忽略 `.env` 所有相關檔案。
    *   忽略 `data/apiKeys.json`。
    *   忽略所有 `*.sql` 備份檔 (保留 `initial_data` 用於初始化)。
*   **Frontend**:
    *   忽略 Android Keystore (`*.jks`, `key.properties`)。
    *   忽略 iOS Generated Configs (`Generated.xcconfig`)。
    *   忽略 VS Code Launch Config (`.vscode/launch.json`)。

### Google Maps API Key 保護 (Frontend)
移除了原始碼中硬編碼 (Hardcoded) 的 API Key，改為編譯時注入 (Compile-time Injection)。

*   **Android**:
    *   `AndroidManifest.xml` 改用 `${GOOGLE_MAPS_API_KEY}` 變數。
    *   `build.gradle.kts` 新增邏輯，從 `--dart-define` 讀取 Key。
*   **iOS**:
    *   `Info.plist` 改用 `$(GOOGLE_MAPS_API_KEY)` 變數。
    *   `AppDelegate.swift` 改為動態從 Bundle 讀取 Key。
*   **開發方式**:
    *   已建立 `.vscode/launch.json`，開發時按 F5 即可自動帶入 Key，無需手動輸入指令。

---

## 3. 待辦事項 / 已知限制
*   **刪除專案**: 目前系統尚未實作「刪除整個專案」的 API。若需刪除專案，需手動從資料庫刪除該 `project_code` 下的所有資料。
*   **佔位資料**: 每個專案都會有一筆隱藏的 `PT-0` 資料，這是系統設計用於維持 ID 連續性的必要存在，不會被自動清理。
