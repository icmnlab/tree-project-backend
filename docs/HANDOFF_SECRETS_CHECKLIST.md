# 機密與環境設定指南（Secrets & Environment Setup）

> 本系統所有金鑰、主機位址、帳號都以**環境變數／設定檔**提供，不寫死在程式碼裡。
> GitHub 只放程式碼與文件；真實金鑰一律放 `.env`（已被 `.gitignore` 忽略）或本機設定檔。
>
> 本指南說明「需要設定哪些、各放在哪裡、去哪裡申請」。依此設定即可讓系統在任何新環境完整運作。
> 範本檔：`backend/.env.example`、`backend/ml_service/.env.example`、`frontend/android/key.properties.example`。

---

## A. 後端 `.env` 的金鑰 / 服務

於 `backend/.env`（複製自 `.env.example`）填入下列值：

| 服務 | 用途 | 變數 | 取得方式 | 必要性 |
|------|------|------|----------|--------|
| PostgreSQL | 資料庫連線 | `DATABASE_URL`（或 `DB_*`） | 自架 DB 連線字串 | **必要** |
| JWT | 登入簽章 | `JWT_SECRET` | `openssl rand -hex 64` 自行產生 | **必要** |
| Cloudinary | 樹木照片儲存 | `CLOUDINARY_API_KEY` / `_API_SECRET` | cloudinary.com | 選用（無則停用照片上傳） |
| PlantNet | 樹種辨識 | `PLANTNET_API_KEY` | my.plantnet.org | 選用 |
| Gemini / OpenAI / Claude / SiliconFlow | AI 助理（Text-to-SQL／Agent） | `GEMINI_API_KEY` 等 | 各 AI 平台 | 選用 |
| ML Service | 後端↔ML 服務驗證 | `ML_API_KEY`（backend 與 ml_service 兩邊一致） | 自訂字串 | 選用（DBH 視覺估算） |
| Admin Token | 部署診斷端點 | `ADMIN_API_TOKEN` | 自訂字串 | 選用 |
| GitHub Webhook | 自動部署簽章 | `DEPLOY_WEBHOOK_SECRET` | 與 GitHub repo webhook 設定一致 | 選用（自動部署用） |
| Kaggle / Roboflow | ML 訓練資料 | `KAGGLE_KEY` / `ROBOFLOW_API_KEY`（`ml_service/.env`） | kaggle.com / roboflow.com | 選用（僅訓練時） |

---

## B. 前端建置需要的設定

於建置／執行時提供（詳見 `BUILD_GUIDE.md`）：

| 設定 | 放在哪 | 說明 | 必要性 |
|------|--------|------|--------|
| `API_BASE_URL` | `--dart-define` | 後端 API base，如 `https://host/api` | **必要** |
| `SELF_SIGNED_TRUSTED_HOSTS` | `--dart-define` | 信任自簽憑證主機（逗號分隔，可用 `.ts.net` 後綴）；正式憑證則免 | 視情況 |
| `GOOGLE_MAPS_API_KEY` | `android/key.properties` | 地圖頁必需；Google Cloud Console 申請，須綁套件名 + SHA-1（見 `BUILD_GUIDE.md` §3） | **必要（地圖）** |
| iOS 地圖金鑰 | Xcode build setting `GOOGLE_MAPS_API_KEY_IOS` | iOS 版地圖 | 視平台 |

> 程式碼已零硬編碼：`app_config.defaultBaseUrl` 預設空字串、`main.dart` 自簽信任清單預設空，皆由上述設定注入。

---

## C. 主機 / 帳號設定

| 項目 | 說明 |
|------|------|
| GitHub repo | 部署來源（`tree-project-backend` / `tree-project-frontend`）＋ webhook；設為你自己的 repo（fresh push 步驟見 `LAB_DEPLOYMENT_GUIDE.md` §0.1） |
| 部署主機 | Ubuntu 主機 + SSH 帳號與公鑰；Nginx 反向代理 + PM2（見 `LAB_DEPLOYMENT_GUIDE.md`） |
| 私有網路 / 憑證 | 原部署採 Tailscale 提供 `*.ts.net` 有效憑證（`scripts/setup_tailscale_tls.sh`）；可改用任何網域 + 正式 TLS 憑證 |
| ML 服務位址 | `backend/.env` → `ML_SERVICE_PUBLIC_URL` 設為你的 ML 主機（若啟用 ML） |

---

## D. 建議：使用單位 / 專案專用帳號

為避免服務綁定到特定個人，建議在各平台（GitHub、Cloudinary、PlantNet、各 AI 平台、Google Cloud、Tailscale）申請一組**單位／專案專用帳號**持有金鑰與資源。如此長期維運與人員異動時只需移交該帳號，不必逐項重設。

---

## E. 安全注意事項

- 金鑰**切勿** commit 進 git；以安全管道（1Password、CI secrets、加密檔）保管與傳遞。
- API 金鑰務必在平台端加上**用途／網域／套件 + SHA-1 限制**，避免被盜用計費。
- 建議定期輪替 `JWT_SECRET`、`ADMIN_API_TOKEN`、`DEPLOY_WEBHOOK_SECRET`。
- 若任一金鑰曾透過不安全管道傳遞或疑似外流，請到對應平台**作廢並重新申請**。

---

## F. 使用者帳號（非 DB 種子）

- **`users.pg.sql` 僅建表**，不寫入任何帳號。
- **正式環境**：migrate 完成後執行 `node scripts/create_lab_admin.js --username ... --password ...`（強密碼，部署者自行決定）。
- **開發／CI**：`node scripts/seed_dev_users.js`（建立 `admin/12345` 等；`NODE_ENV=production` 會拒絕執行）。
- 舊環境若仍有歷史 seed 帳號，上線前請停用或刪除，只保留正式管理員。

---

## G. 本機 / 離線備份（不進 Git）

| 項目 | 路徑 |
|------|------|
| Android 簽章 | `android/key.properties` + `*.jks` |
| 後端機密 | `backend/.env`、`backend/ml_service/.env` |
| 管理員帳號 / 邀請碼清單 | 後台維運文件 |

自動備份：`cd frontend; powershell -ExecutionPolicy Bypass -File scripts\handoff_backup.ps1`
（輸出至 `G:\TreeAI-Handoff\yyyyMMdd_HHmm\`，排除 build 與機密檔）。
