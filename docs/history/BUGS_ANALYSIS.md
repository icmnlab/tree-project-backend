# 🐛 Bug 分析與追蹤

> 最後更新: 2024-12-02

---

## ✅ 已修復的 Bug

### Backend

| Bug | 原因 | 修復方式 | Commit |
|-----|------|----------|--------|
| 登入失敗 | role enum 類型轉換問題 | 修正 SQL 查詢 | `6e4c82d` |
| DB pool 關閉錯誤 | 腳本 import 時自動執行導致 pool 提前關閉 | 加入 `require.main === module` 檢查 | `992323c` |
| OOM 記憶體溢出 | 批次處理過大 | 減少 batch size、加入冷卻機制 | `94b672d`, `f5bca94` |
| SQL 注入漏洞 | 驗證不完整 | 完整黑名單 + 正則檢查 | `2cbd34c` |
| 統計 SQL 錯誤 | 欄位名稱錯誤 | 修正 SQL 語句 | `9ca3852` |
| 超長訊息問題 | 回應過長 | 加入長度限制 | `1cc69e6` |

### Frontend

| Bug | 原因 | 修復方式 | Commit |
|-----|------|----------|--------|
| iOS 建置失敗 | DT_TOOLCHAIN_DIR 問題 | 修改 Podfile | `bdc1702` |
| iOS 數字鍵盤無小數點 | 鍵盤類型設定 | 啟用 decimal input | `fc42d77` |
| 樹種資料載入錯誤 | API 回應處理問題 | 修正解析邏輯 | `898d0c0` |
| Android 圖標被裁切 | 圖標太滿 | 加入 padding | `ec38476` |
| Admin UI 文字溢出 | 卡片寬度問題 | 強制垂直排版 | `4f8e143` |

---

## ⚠️ 已知問題 / 待改善

### 高優先級

1. **地圖 Marker 效能**
   - 描述: 大量 Marker 顯示時可能卡頓
   - 影響: 使用者體驗
   - 建議: 實作 Marker clustering

2. **Render 冷啟動**
   - 描述: 免費方案閒置後首次請求很慢
   - 影響: 使用者體驗
   - 建議: 升級方案或加入 keep-alive

### 中優先級

3. **Chat V2 複雜查詢**
   - 描述: 非常複雜的自然語言查詢可能生成錯誤 SQL
   - 影響: 功能準確度
   - 建議: 持續優化 schema 描述和 prompt

4. **iOS 權限提示**
   - 描述: 首次安裝需要手動授權
   - 影響: 使用者引導
   - 建議: 加入權限引導頁面

### 低優先級

5. **Excel 匯出檔名**
   - 描述: 檔名使用 timestamp，不直覺
   - 建議: 使用查詢關鍵字命名

---

## 📊 測試覆蓋狀態

```
Backend 測試: 185 個測試全部通過 ✅

測試類別:
├── 意圖分類測試 ✅
├── SQL 驗證測試 ✅  
├── 安全審計測試 ✅
├── 進階安全審計 ✅
├── 極端案例測試 ✅
├── API 整合測試 ✅
└── Chat 整合測試 ✅
```

---

## 🔍 Debug 指南

### Chat V2 問題排查

1. **查詢無結果**
   - 檢查意圖分類是否正確（data_query vs knowledge）
   - 檢查生成的 SQL 是否有語法錯誤
   - 查看 console log 的 SQL 語句

2. **SQL 被拒絕**
   - 檢查是否觸發黑名單關鍵字
   - 檢查是否有危險的 pattern

3. **回應太慢**
   - 檢查 SQL 是否有 LIMIT
   - 檢查是否查詢過多資料

### 常用 Debug 指令

```bash
# 查看 backend log
cd backend && npm run dev

# 測試特定功能
node tests/intentClassification.test.js

# 檢查資料庫連線
node -e "require('./config/db').query('SELECT 1').then(console.log)"
```
