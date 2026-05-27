# 實驗室部署指南（脫離個人帳號）

> 目標：在他人電腦／實驗室獨立運行，**不依賴開發者個人 Cursor／GitHub／雲端帳號**。

---

## 1. 架構建議（單機實驗室）

```
┌─────────────────┐     Wi‑Fi / LAN      ┌──────────────────────────────┐
│ 調查員 Android   │ ──────────────────► │ 實驗室主機（Windows/Linux）    │
│ Flutter App     │                     │  • Node 後端 :3000             │
└─────────────────┘                     │  • PostgreSQL                │
                                        │  • ML 服務（可選 GPU 機）     │
                                        │  • Nginx 反向代理（建議）      │
                                        └──────────────────────────────┘
```

- **不要**把 JWT、DB 密碼、ML API Key 寫死在 App；使用建置時注入或首次啟動設定。
- **不要**在實驗室機器登入開發者 GitHub；僅用 zip / 內部 git mirror 部署程式。

---

## 2. 脫離個人帳號檢查表

| 項目 | 做法 |
|------|------|
| 原始碼 | 以 release 壓縮包或實驗室 git 伺服器為準，不含 `.env` |
| 資料庫 | 實驗室自建 PostgreSQL，執行 `backend/scripts/migrate.js` |
| 系統管理員 | 部署腳本建立 **lab-admin**（非個人信箱） |
| 調查員帳號 | `POST /api/invites` 發邀請碼，或管理 Web 建立 |
| App 連線位址 | `frontend` 建置參數 / `assets/config.json` 指向實驗室 IP |
| ML 服務 | 實驗室 `.env` 的 `ML_SERVICE_URL`，與個人 Tailscale 分離 |
| 憑證 | 內網可用自簽 + App 僅信任該 CA（或 HTTP 僅限實驗室 VLAN） |

---

## 3. 部署步驟（主機）

### 3.1 依賴

- Node.js 20 LTS
- PostgreSQL 15+
-（可選）Python 3.10+、CUDA（ML）

### 3.2 後端

```bash
cd project_code/backend
cp .env.example .env   # 實驗室填 DATABASE_URL、JWT_SECRET、CORS_ALLOWED_ORIGINS
npm ci
node scripts/migrate.js
npm start
```

`JWT_SECRET` 必須為實驗室專用隨機字串（≥32 字元）。

### 3.3 建立首位管理員

```bash
node scripts/list_users.js   # 確認空庫
# 使用既有 seed 或 SQL 建立 系統管理員，或透過 invite + 手動升級角色
```

建議：使用 `backend/scripts/create_lab_admin.js` 建立實驗室管理員：

```bash
node scripts/create_lab_admin.js --username labadmin --password 'YourSecurePass1' --display '實驗室管理員'
```

### 3.4 Flutter APK

```bash
cd project_code/frontend
flutter build apk --release \
  --dart-define=API_BASE_URL=http://192.168.x.x:3000/api
```

將 APK 分發給調查員；**不要**內含開發者 refresh token。

---

## 4. 設定檔位置（App）

檢查 `lib/config/app_config.dart` 與建置時 `dart-define`，確保實驗室可改 API 位址而無需改程式碼。

---

## 5. 管理用 Web UI（規劃，待實作）

教授／管理員需要**不改程式**即可：

| 功能 | 說明 |
|------|------|
| 使用者與邀請碼 | 建立調查員、重設密碼、停用帳號 |
| 專案與專案區 | CRUD `projects` / `project_areas` |
| 專案邊界 | 地圖檢視／匯入 GeoJSON／觸發建議邊界 |
| 待測量 / 樹木資料 | 查詢、匯出 CSV、修正錯誤列 |
| 系統設定 | ML URL、備份、CORS、維護模式 |

**建議技術**：後端同 repo 加 `admin-portal/`（React/Vue）或輕量 `ejs` 管理頁，共用既有 JWT + `requireRole('業務管理員')` API。

**優先順序**：P0 使用者+邀請 → P1 專案/邊界檢視 → P2 資料庫備份與匯出。

---

## 6. 備份與還原

- 每日 `pg_dump` 實驗室 DB
- 上傳樹木影像目錄一併備份
- 文件化還原：`psql` + migrate 版本號

---

## 7. 與本輪程式修復的關係

部署新版本後請執行 `docs/VERIFICATION_CHECKLIST.md` 全部勾選一次。
