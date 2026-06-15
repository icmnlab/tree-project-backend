# 交接驗收清單 HANDOVER_CHECKLIST

> 一頁式、可勾選的交接與上線驗收清單。深入說明見 `HANDOFF.md`（單一入口）、
> 機密交接見 `HANDOFF_SECRETS_CHECKLIST.md`、部署見 `LAB_DEPLOYMENT_GUIDE.md`、
> 部署後逐項驗證見 `VERIFICATION_CHECKLIST.md`。
>
> 最後更新：2026-06-15　｜　適用版本：前端 `18.10.0+22`、DB migration ≥ 34

---

## 0. 交接現況快照（交付方填寫）

- 後端 repo / commit：`__________________________`
- 前端 repo / commit：`__________________________`
- 後端測試：`node tests/runner.js` → ______ pass / ______ fail（目標 79 pass / 0 fail）
- 前端測試：`flutter test` → ______ pass（目標 429 pass）
- 正式機位址 / 部署方式：`__________________________`

---

## 1. 程式碼與文件（交付方）

- [ ] `main` 分支為最新、CI 綠燈（後端＋前端 `.github/workflows/ci.yml`）
- [ ] 無未 commit 變更；版本號（`pubspec.yaml` / `CHANGELOG.md`）與實況一致
- [ ] 文件已對齊現況：`HANDOFF.md`、`BUILD_GUIDE.md`、`VERIFICATION_CHECKLIST.md`、`DATABASE_NORMALIZATION.md`
- [ ] 已確認 repo 內無真實金鑰／個人資訊（`.env`、`key.properties`、`*.jks` 均被 `.gitignore`）

## 2. 機密與帳號交接（依 `HANDOFF_SECRETS_CHECKLIST.md`）

- [ ] A. 輪替/重新申請所有金鑰（DB、JWT、Cloudinary、PlantNet、AI、ML_API_KEY、ADMIN_API_TOKEN、Webhook、**Google Maps**）
- [ ] B. 個人化網址/IP 改為自己的主機（`--dart-define=API_BASE_URL` / `SELF_SIGNED_TRUSTED_HOSTS`）
- [ ] C. GitHub repo、私有網路、伺服器 Linux 帳號設為自己的；確認無個人帳號殘留存取
- [ ] D.（建議）建立專案專用帳號持有各平台
- [ ] 變更預設 `admin` 密碼；移除/停用測試帳號（`test`/`tt2`）

## 3. 資料庫（交接 / 上線）

- [ ] 正式機**不要**跑 `migrate.js`（會匯入 7000 筆 dev-fixtures 測試樹）
- [ ] 增量更新走 `node scripts/run_pending_migrations.js`（或開機自動）；確認套到 migration **≥ 34**
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
- [ ] 說明已知限制 / 待辦（見 `WORK_STATUS.md`；如 API 密鑰為休眠功能、ML 服務為選用）
- [ ] 說明 BLE 測樹儀（VLGEO2）連線與 NMEA/外接 GNSS（`HANDOFF_EXTERNAL_GNSS_AND_BLE.md`）

---

## 7. 移交簽核

| 角色 | 姓名 | 日期 | 簽核 |
|------|------|------|------|
| 交付方 |  |  |  |
| 接收方 |  |  |  |

> 全部勾選且雙方簽核後，視為交接完成。
