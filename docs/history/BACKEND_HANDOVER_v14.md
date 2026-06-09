# 🌳 TreeAI 專案交接文件

> **最後更新**: 2025-12-02  
> **專案版本**: Frontend v14.0.0 / Backend latest  
> **狀態**: ✅ 已同步至 GitHub 最新版本  
> **聯絡方式**: 411135055@gms.ndhu.edu.tw

---

## 📌 專案概述

**智慧樹木管理系統 (Sustainable TreeAI)** - 基於大語言模型的永續發展分析平台

### GitHub Repositories
| Repository | 連結 |
|------------|------|
| **Frontend** | `<GITHUB_OWNER>/tree-project-frontend` (Flutter) |
| **Backend** | `<GITHUB_OWNER>/tree-project-backend` (Node.js/Express) |

### 技術棧
- **Frontend**: Flutter 3.x, Dart, Google Maps, Riverpod
- **Backend**: Node.js, Express, PostgreSQL
- **AI**: Google Gemini API, OpenAI API (多模型支援)
- **部署**: Render (Backend)

---

## 🚀 近期重大更新摘要

### Backend (最近 29 commits)

#### 1️⃣ **Chat V2 - Text-to-SQL 系統** ⭐ 核心功能
- 以資料為主、LLM 為輔的查詢策略
- 實作 `services/sqlQueryService.js` - 安全的 SQL 生成服務
- 意圖分類：區分「查資料」vs「問知識」
- 歷史對話功能（10 筆 / 15 分鐘過期）
- SQL 執行錯誤自動重試（LLM 自動修正語法）
- 查詢結果自動匯出 Excel 下載

#### 2️⃣ **安全性強化** 🔒
- 完整 SQL 注入防護（黑名單 + 正則檢查）
- 185 個測試全部通過
- 新增測試檔案：
  - `tests/securityAudit.test.js`
  - `tests/advancedSecurityAudit.test.js`
  - `tests/sqlValidation.test.js`
  - `tests/intentClassification.test.js`
  - `tests/edgeCases.test.js`
  - `tests/apiIntegration.test.js`
  - `tests/chatIntegration.test.js`

#### 3️⃣ **效能優化** ⚡
- 新增 `/tree_survey/map` 精簡 API（減少約 70% 傳輸量）
- 資料庫連接池優化
- 移除不需要的 RAG 腳本（加速部署）
- OOM 防護（批次處理 + 冷卻機制）

#### 4️⃣ **其他修復**
- 修復登入 SQL role enum 類型轉換
- 統計 SQL 修復
- 健康檢查端點

### Frontend (最近 11 commits)

#### 1️⃣ **UI/UX 大幅改進** 🎨
- TIPC 臺灣港務公司風格配色（深藍色系）
- 漸層背景、彩色陰影、圓角設計
- AI 聊天訊息支援 Markdown 連結渲染

#### 2️⃣ **地圖頁面優化** 🗺️
- 移除 Android 縮放控制按鈕
- 新增選單切換功能
- iOS 權限修復

#### 3️⃣ **iOS 建置修復** 🍎
- 修復 DT_TOOLCHAIN_DIR 問題
- 修復 iOS 鍵盤數字輸入（小數點支援）
- iOS deployment target 更新至 14.0

#### 4️⃣ **App Icon 更新** 📱
- Android 圖標加 padding 防止裁切
- iOS 圖標維持不變

#### 5️⃣ **VLGEO2 藍牙傳輸** 📡 ⭐ 重要功能
- **BLE 連接**：Nordic UART Service 實作
- **CSV 解析**：33 欄位完整解析（GPS、樹高、距離等）
- **雜訊處理**：兩階段 PacketLogger 雜訊過濾
- **精度驗證**：與官方 APP 誤差僅 **0.9%**
- 相關檔案：
  - `lib/screens/ble_import_page.dart` (914 行)
  - `lib/services/ble_data_processor.dart` (220 行)
  - `lib/services/ble_field_validator.dart` (298 行)

---

## 📁 專案結構

```
project_code/
├── backend/                    # Node.js 後端
│   ├── app.js                  # 主程式入口
│   ├── config/
│   │   ├── db.js               # PostgreSQL 連接池
│   │   └── apiKeys.js          # API 金鑰管理
│   ├── routes/
│   │   ├── ai.js               # AI Chat API (含 V2 Text-to-SQL)
│   │   ├── treeSurvey.js       # 樹木調查 CRUD
│   │   ├── users.js            # 使用者認證
│   │   └── ...
│   ├── services/
│   │   ├── sqlQueryService.js  # ⭐ Text-to-SQL 核心服務
│   │   ├── geminiService.js    # Gemini API 封裝
│   │   └── openaiService.js    # OpenAI API 封裝
│   ├── tests/                  # 測試檔案
│   └── scripts/                # 資料庫遷移/工具腳本
│
├── frontend/                   # Flutter 前端
│   ├── lib/
│   │   ├── main.dart           # 主程式入口 + 主題設定
│   │   ├── constants/colors.dart # TIPC 配色常數
│   │   ├── screens/            # 頁面元件
│   │   ├── services/           # API 服務層
│   │   └── models/             # 資料模型
│   ├── android/                # Android 專案設定
│   ├── ios/                    # iOS 專案設定
│   └── assets/                 # 靜態資源
│
└── .docs/                      # 專案文件
    └── HANDOVER.md             # 本交接文件
```

---

## 🔧 開發環境設定

### Backend
```bash
cd backend
npm install
# 設定 .env 檔案（參考 .env.example）
npm run dev
```

### Frontend
```bash
cd frontend
flutter pub get
flutter run
```

### 環境變數 (Backend .env)
```
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
JWT_SECRET=...
```

---

## 🧪 測試

### 執行所有測試
```bash
cd backend
npm test
```

### 個別測試
```bash
node tests/intentClassification.test.js  # 意圖分類
node tests/sqlValidation.test.js         # SQL 安全驗證
node tests/chatIntegration.test.js       # Chat API 整合（需 .env）
```

---

## 📋 待辦/已知問題

### 待優化項目
- [ ] Chat V2 複雜查詢可能需要更精確的 schema 描述
- [ ] iOS 首次安裝需手動授權位置/相機權限
- [ ] 地圖 Marker 大量顯示時效能待優化

### 注意事項
- Backend 部署在 Render 免費方案，閒置會休眠
- Gemini API 有每分鐘請求限制
- SQL 查詢限制最多回傳 100 筆資料

---

## 📞 聯絡資訊

- **GitHub**: <GITHUB_OWNER>
- **專案**: tree-project-frontend / tree-project-backend

---

## 📝 給新 AI 助手的說明

這是一個 **智慧樹木管理系統**，主要功能包括：

1. **樹木調查管理** - CRUD 操作、QR Code 掃描
2. **AI 聊天助手** - 支援自然語言查詢資料庫（Text-to-SQL）
3. **碳匯計算** - 基於樹木數據計算碳儲存量
4. **地圖視覺化** - Google Maps 整合
5. **統計報表** - 資料分析與 PDF/Excel 匯出
6. **管理後台** - 管理員功能面板

**重要檔案：**
- `backend/services/sqlQueryService.js` - AI 聊天的核心邏輯
- `backend/routes/ai.js` - AI 相關 API endpoints
- `frontend/lib/main.dart` - Flutter 主題設定
- `frontend/lib/ai_assistant_page.dart` - AI 聊天頁面

**目前架構：**
- 使用 Text-to-SQL 取代 RAG，直接查詢資料庫
- 支援多 AI 模型（Gemini、OpenAI 相容 API）
- 前端使用 TIPC 深藍色系 UI 風格
