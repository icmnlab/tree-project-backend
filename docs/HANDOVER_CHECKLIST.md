# 交接驗收清單 HANDOVER_CHECKLIST

> 一頁式、可勾選的交接與上線驗收清單。深入說明見 `HANDOFF.md`（單一入口）、
> 機密交接見 `HANDOFF_SECRETS_CHECKLIST.md`、部署見 `LAB_DEPLOYMENT_GUIDE.md`、
> 部署後逐項驗證見 `VERIFICATION_CHECKLIST.md`。
>
> 最後更新：2026-06-15　｜　適用版本：前端 `18.10.4+26`、DB migration ≥ 35

---

## 原始開發歸屬（交付方）

核心開發與本交接包整理由 **KyleliuNDHU** 完成。著作權見 `LICENSE`；完整說明見 `HANDOFF.md` §0、`AUTHORS.md`、`CONTRIBUTION_RECORD.md`。

**推送至接手方 GitHub**：用 **fresh snapshot**（orphan 單一 commit，**不帶舊歷史**），執行 `scripts/prepare_fresh_handover.ps1` 或見 `LAB_DEPLOYMENT_GUIDE.md` §0.1。  
**交付方**：交接前在本機私人匯出 `git log` 留存作個人貢獻證明（不交付給接手方）。

---

## 0. 交接現況快照（交付方填寫）

- 後端 repo / commit：`__________________________`
- 前端 repo / commit：`__________________________`
- 後端測試：`node tests/runner.js` → ______ pass / ______ fail（共 **89** cases；目標 0 fail，部分環境相依案會 skip）
- 前端測試：`flutter test` → ______ pass（目標 435 pass）
- 正式機位址 / 部署方式：`__________________________`

---

## 1. 程式碼與文件（交付方）

- [ ] `main` 分支為最新、CI 綠燈（後端＋前端 `.github/workflows/ci.yml`）
- [ ] 無未 commit 變更；版本號（`pubspec.yaml` / `CHANGELOG.md`）與實況一致
- [ ] 文件已對齊現況：`HANDOFF.md`、`BUILD_GUIDE.md`、`VERIFICATION_CHECKLIST.md`、`DATABASE_NORMALIZATION.md`
- [ ] 已確認 repo 內無真實金鑰／個人資訊（`.env`、`key.properties`、`*.jks` 均被 `.gitignore`）
- [ ] 根目錄含 `LICENSE`、`AUTHORS.md`、`CONTRIBUTION_RECORD.md`（歸屬文件，**不得刪除**）
- [ ] 交付方已本機私人封存完整 `git log`（不推送給接手方）；接手方 repo 以 fresh snapshot 推送（§0.1）

## 2. 機密與帳號（依 `HANDOFF_SECRETS_CHECKLIST.md`）

### 2.0 誰負責什麼（重點）

| 項目 | 做法 |
|------|------|
| 原始碼 + 文件（兩 GitHub repo） | **交付方移交 repo**；接手者取得 collaborator 或轉移擁有權 |
| 正式機上的樹木資料 | **移交**（`pg_dump` 備份）；DB 密碼由接手者重設 |
| Ubuntu 主機存取 | **接手者自建 Linux 帳號 + SSH 公鑰**；交付方**移除**自己的公鑰與 sudo |
| 第三方 API 金鑰（Cloudinary、PlantNet、AI…） | **接手者到各平台新建**；交付方作廢舊金鑰（不傳遞舊 key） |
| `JWT_SECRET` / `ML_API_KEY` / Webhook / Admin token | **接手者新建** → 填入主機 `backend/.env`（與 `ml_service/.env` 的 `ML_API_KEY` 一致） |
| Google Maps（Android/iOS） | **接手者新建** → Android 填 `key.properties`；iOS 填 Xcode `GOOGLE_MAPS_API_KEY_IOS`（須綁接手者 SHA-1 / bundle id） |
| Android 簽章 `*.jks` | **二選一**：(a) 離線安全管道移交同一 keystore，或 (b) 接手者新建（舊版 APK 無法覆蓋安裝） |
| Tailscale / 私有網路 | **可選、接手者自建**；repo 僅保留通用腳本 `setup_tailscale_tls.sh`，無個人 hostname。也可用公網域名 + 正式 TLS |
| App 管理員 | **接手者執行** `create_lab_admin.js`（非 DB 種子） |
| ML 服務位址 | **接手者設定** `ML_SERVICE_URL`（後端 proxy 內網）+ `ML_SERVICE_PUBLIC_URL`（App 可達）；見 §2.1 |

> **交付方只需確保**：Git 內無真實金鑰／個人 hostname／SSH 私鑰；本機 `.env` / `key.properties` 不入庫；各平台舊金鑰已作廢。

### 2.1 ML 服務轉發（選用）

後端 `routes/ml_service.js` 代理所有 ML 請求（App **不**直連 Python 服務）：

| 變數 | 誰填 | 用途 |
|------|------|------|
| `ML_SERVICE_URL` | 接手者 | 後端 → FastAPI 內網位址（例 `http://127.0.0.1:8100`） |
| `ML_SERVICE_PUBLIC_URL` | 接手者 | 登入後下發給 App 的公開 URL（Tailscale / 公網 / 同機 reverse proxy） |
| `ML_API_KEY` | 接手者 | `backend/.env` 與 `ml_service/.env` **相同**；後端 proxy 注入 `X-ML-API-Key` |
| `ML_CORS_ORIGINS` | 接手者 | `ml_service/.env`；允許的瀏覽器來源（預設僅 localhost） |

流程：`Flutter → Node /api/ml-service/* → FastAPI ml_service`。未設 `ML_SERVICE_URL` 時 ML 功能優雅停用。

### 2.2 勾選項

- [ ] A. 輪替/重新申請所有金鑰（DB、JWT、Cloudinary、PlantNet、AI、ML_API_KEY、ADMIN_API_TOKEN、Webhook、**Google Maps**）
- [ ] B. 個人化網址/IP 改為自己的主機（`--dart-define=API_BASE_URL` / `SELF_SIGNED_TRUSTED_HOSTS`）
- [ ] C. GitHub repo、私有網路、伺服器 Linux 帳號設為自己的；確認無個人帳號殘留存取
- [ ] D.（建議）建立專案專用帳號持有各平台
- [ ] 正式管理員以 `create_lab_admin.js` 建立（非 DB 種子）；舊 seed 帳號（若有）已停用或刪除

## 3. 資料庫（交接 / 上線）

- [ ] 正式機**不要**跑 `migrate.js`（會匯入 dev-fixtures 測試樹／示範區）
- [ ] 首次空庫：只跑 `run_pending_migrations.js` 後執行 `create_lab_admin.js`
- [ ] 增量更新走 `node scripts/run_pending_migrations.js`（或開機自動）；確認套到 migration **≥ 35**
- [ ] 確認測試資料 `dev-fixtures/tree_survey_data.csv` **未**進入正式庫
- [ ] 已備份正式資料庫（上線/交接前）

## 4. 建置與部署

- [ ] APK 依 `BUILD_GUIDE.md` 建置：帶 `--dart-define=API_BASE_URL`、`key.properties` 含 `GOOGLE_MAPS_API_KEY`
- [ ] 地圖可正常顯示（金鑰已綁 package + SHA-1、已啟用 Maps SDK）
- [ ] 後端部署：`bash scripts/deploy.sh`（pull → pending migration → PM2 reload，含 rollback）
- [ ] GitHub webhook 自動部署可運作（`x-hub-signature-256` 驗證）

## 5. 部署後功能驗收（依 `VERIFICATION_CHECKLIST.md`，建議用實驗室帳號）

- [ ] 登入 / 權限矩陣（系統管理員 / 專案管理員 / 調查管理員 / 一般使用者）
- [ ] 區位→專案→建樹→改→刪 主流程
- [ ] 邊界：繪製 / 貼座標 / 匯入 KML·KMZ·GeoJSON·TXT·CSV / 匯出 KML（B 系列）
- [ ] 維護量測：樹種繼承、照片歷史、樹況選單（內建+自訂）
- [ ] 樹木生命週期：維護回報枯死/倒塌/移除 → 淘汰；詳情頁可復原（LC 系列）
- [ ] 碳匯統計只計活立木（淘汰木排除）
- [ ] 邀請碼：產生 / 綁定專案區 / 停用 / 刪除
- [ ] 亂碼防護：含 U+FFFD 的匯入被拒（400）

## 6. 知識轉移

- [ ] 交接者導覽 `HANDOFF.md` §10 文件地圖
- [ ] 說明已知限制 / 待辦（見 `HANDOFF.md` §12 保留/實驗性功能；如 API 密鑰為休眠功能、ML 服務為選用）
- [ ] 說明 BLE 測樹儀（VLGEO2）連線與 NMEA/外接 GNSS（`HANDOFF_EXTERNAL_GNSS_AND_BLE.md`）

---

## 7. 移交簽核

| 角色 | 姓名 | 日期 | 簽核 |
|------|------|------|------|
| 交付方 |  |  |  |
| 接收方 |  |  |  |

> 全部勾選且雙方簽核後，視為交接完成。
