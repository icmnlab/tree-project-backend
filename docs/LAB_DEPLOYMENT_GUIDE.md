# 實驗室部署指南（脫離個人帳號）

> 目標：在他人電腦／實驗室獨立運行，**不依賴開發者個人 Cursor／GitHub／雲端帳號**。

---

## 0. 交接日流程（一次做完）

> 情境：實驗室提供自己的 GitHub repo 與部署主機，原作者把程式碼交過去後即可完全脫手。

### 0.1 推送程式碼到實驗室 GitHub（fresh snapshot）

**不要直接 `git push` 帶完整歷史**——舊 commit 歷史含開發期的個人 IP／帳號等資訊。
改用「單一乾淨快照」開新歷史（兩個 repo 各做一次）：

```bash
cd backend     # frontend 同理
git checkout main && git pull
git checkout --orphan handover
git add -A
git commit -m "Initial handover snapshot"
git remote add lab https://github.com/<LAB_OWNER>/tree-project-backend.git
git push lab handover:main
git checkout main           # 回到原分支，本機歷史不受影響
```

推上去後 CI 會自動跑（workflow 不依賴任何 GitHub Secrets，零設定即可綠）。

### 0.2 金鑰全部重新申請

依 `HANDOFF_SECRETS_CHECKLIST.md` §A 逐項作廢舊金鑰、申請新金鑰，填入部署主機的 `backend/.env`
（範本 `backend/.env.example`）。Google Maps key 填 `frontend/android/key.properties`（範本 `key.properties.example`）。

### 0.3 部署主機（見本指南 §3）

照 §3 安裝依賴、建 DB、跑 `migrate.js`（正式庫設 `SKIP_CSV_IMPORT=1`）、PM2 啟動。

### 0.4 設定自動部署 webhook

實驗室 GitHub repo → Settings → Webhooks → Add webhook：
- Payload URL：`https://<部署主機>/webhook/deploy`
- Content type：`application/json`
- Secret：與主機 `backend/.env` 的 `DEPLOY_WEBHOOK_SECRET` 一致（自訂隨機字串）
- 事件：Just the push event

之後 push 到 `main` 即自動部署（機制見 `HANDOFF.md` §6.1）。

### 0.5 建立管理員、處理種子帳號

```bash
node scripts/create_lab_admin.js --username labadmin --password '<強密碼>' --display '實驗室管理員'
```
並**修改或停用** seed 的 `admin/12345`（`test`/`tt2` 為通用測試帳號，正式庫建議一併停用）。

### 0.6 建置 APK 與驗收

```bash
cd frontend
flutter build apk --release --dart-define=API_BASE_URL=https://<部署主機>/api
```
最後跑一輪 `VERIFICATION_CHECKLIST.md`，並在 GitHub 設定 `main` 分支保護（required CI check）。

> ⚠️ **手機端 TLS 必須是「受信任的有效憑證」**
> Android 預設**拒絕自簽憑證**。若 `API_BASE_URL` 指向自簽憑證的主機（例如直接用
> `https://<IP>/api`，憑證 CN=IP、自簽），App 啟動自檢會出現：
> `CERTIFICATE_VERIFY_FAILED: self signed certificate`，**所有 API 都連不上**。
>
> 正確做法（擇一）：
> 1. **機構網域 + 正式憑證**（最佳）：用學校／圖資中心的網域 + Let's Encrypt（certbot），
>    `API_BASE_URL=https://tree.example.edu.tw/api`。
> 2. **Tailscale 有效憑證**（內網/測試很方便，免費自動簽發）：
>    - 快速法（免 sudo，operator 即可，但繞過 nginx 速率限制）：
>      ```bash
>      tailscale serve --bg --https 443 http://127.0.0.1:3000   # 關閉：tailscale serve --https=443 off
>      ```
>      App 指向 `https://<主機>.<tailnet>.ts.net/api`。
>    - 正式法（保留 nginx 速率限制／安全標頭，需 sudo）：**一鍵腳本**
>      ```bash
>      sudo bash scripts/setup_tailscale_tls.sh   # 自動偵測 ts.net 名稱、產憑證、改 nginx（含備份/測試/回滾）、設 90 天 renew cron
>      ```
>      手動等效步驟：`sudo tailscale cert --cert-file /opt/tree-app/ssl/ts.crt --key-file /opt/tree-app/ssl/ts.key <主機>.<tailnet>.ts.net` →
>      nginx `server_name` 加該 ts.net 名稱、`ssl_certificate` 指向 ts.crt/ts.key → `sudo nginx -t && sudo systemctl reload nginx`。
>      （Tailscale 憑證約 90 天，腳本已設 `/etc/cron.d/tree-tls-renew` 自動續期。）
> 用 `curl https://<主機>/api/health`（**不要加 `-k`**）回 200/401 且無憑證錯誤，即代表手機會信任。

### 0.7 交接日 checklist

- [ ] 兩 repo fresh push 完成、CI 綠
- [ ] `HANDOFF_SECRETS_CHECKLIST.md` §A 金鑰全部輪替完
- [ ] 後端部署完成、`/health` OK
- [ ] webhook 自動部署測試一次（push 小變更 → 自動上線）
- [ ] 管理員帳號建立、seed 帳號處理完
- [ ] APK 建置並在實機登入成功
- [ ] `VERIFICATION_CHECKLIST.md` 跑過一輪
- [ ] 原作者個人帳號（Tailscale／GitHub webhook／雲端服務）全部移除存取

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
- 程式碼以**實驗室自己的 GitHub repo** 為準（見 §0.1 fresh push）；不要在實驗室機器登入開發者個人帳號。

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

## 5. 管理用 Web UI（**已決定 defer，非必做**）

> 2026-06 決議：App 內建管理後台（admin 頁）已涵蓋使用者/邀請碼/專案管理需求，
> 獨立瀏覽器版 Web portal **刻意不做**；未來若有需求，建議用 React-Admin/Refine 接現有 REST+JWT，非手刻。

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
