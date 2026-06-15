# 驗證清單（一次跑完）

> 更新：2026-06-15  
> 適用版本：前端 `18.10.0+22`；資料庫 migration 應 **≥ 33**（28 儀器溯源、30 邊界來源、31 樹木生命週期、32 照片綁定量測、33 樹況選單目錄；見 `DATABASE_NORMALIZATION.md`）

部署後請依序勾選。建議使用 **實驗室專用帳號**（非個人帳號）。

---

## 0.0 已自動化覆蓋（CI 每次 push 自動跑，實機可降為「抽查」）

> 以下不變量已寫成自動化測試並在 CI 綠燈（後端 `tests/runner.js`、前端 `flutter test`）。
> 實機驗證時這些項目可**快速抽查**即可，不必逐步窮舉；真正需要硬體/射頻/相機/雙機的項目見下方各表。

| 原清單項 | 不變量 | 自動化測試 | 層級 |
|----------|--------|------------|------|
| M2 / M3 | 維護重測 GPS：不更新→沿用舊座標；更新→用手機定位 | `frontend/test/maintenance_gps_flow_test.dart` | 前端單元 |
| M4 | 本場新增樹**不**進待辦／地圖 | `frontend/test/maintenance_session_test.dart` | 前端單元 |
| M5 / M6 | 雙帳號維護鎖：他人 409 LOCKED、釋放後換手 | `backend/tests/contracts/maintenance_locks.test.js` | 後端契約 |
| M7 / IRD-1 / TR-2 | 手冊合規模式：儀器 Remote Diameter **不**直接當正式 DBH（標 manual），但儀器值仍保留供溯源 | `frontend/test/handbook_dbh_source_test.dart`（pending 端）+ `instrument_traceability`（後端歷次） | 前端單元 + 後端契約 |
| TR-1 / TR-2 / LIVE-1 / LIVE-2（資料面） | transfer 後歷次量測 API 帶 `instrument_type` / `instrument_dbh_cm` | `backend/tests/contracts/instrument_traceability.test.js` | 後端契約 |
| —（GPS 守門） | GPS 未確認（mixed_pending / requires_gps_fix）的 pending **不可** transfer，整批 ROLLBACK | `backend/tests/contracts/transfer_gps_guard.test.js` | 後端契約 |
| R1 | 同 `X-Request-Id` 重送（冪等快取） | `backend/tests/invariants/requestIdDedup.test.js` | 後端不變式 |
| LC（生命週期推導） | 樹況文字 → `active/dead/fallen/removed` 對應、淘汰判定、**枯立木→dead**、枯萎→active | `backend/tests/invariants/treeLifecycle.test.js`（7 案） | 後端不變式 |
| LC（淘汰/復原端點） | retire(dead)→by_id 回讀 dead+retired_at；restore→active 清空；非法 lifecycle→400 | `backend/tests/contracts/tree_lifecycle_retire.test.js` | 後端契約 |
| ST（樹況選單目錄） | GET 內建含枯立木=dead；POST 自訂含「枯立」自動 dead、重複收斂、未登入 401 | `backend/tests/contracts/tree_statuses.test.js` | 後端契約 |
| 邊界匯入/匯出 | 自相交 400、source 寫入、export.kml、KML 多幾何容錯、純文字座標解析 | `backend/tests/contracts/project_boundary_import.test.js` + `frontend/test/boundary_input_test.dart` | 後端契約 + 前端單元 |
| BLE 三選一座標換算 | tree / surveyor / mixed_pending → 樹/站座標與 position_source 正確 | `frontend/test/ble_pending_workflow_test.dart` | 前端單元 |

**仍須真人實機（硬體/射頻/相機/雙機 UI，無法純程式自動化）：**
M1/M8（SEND 後對話框、兩段式選取 UI）、M5/M6 的**雙機 UI 體感**、
I3P-*/IDME-*（儀器測高模式 + T4 轉發器射頻）、EOT-1/EOT-2（藍牙傳輸/中斷）、
F1–F3（相機/即時樹幹框）、L3/L4（409 衝突對話框 UI）。

---

## 0. 環境準備

- [ ] 後端 HEAD ≥ `b711cd2`；migration **26、27、28** 已套用
- [ ] Flutter App 已安裝含 `4e943ed` 的前端 build
- [ ] 手機可連實驗室後端 URL（Wi‑Fi / Tailscale）
- [ ] 準備：VLGEO2（STD V3.7+）、T4 轉發器（測 **HEIGHT DME** 時）、測試專案（≥3 棵有 GPS）
- [ ] 帳號：**管理員 + 調查員 A + 調查員 B**（雙人鎖）

### 0.1 終端自動偵錯（啟動時）

| 指令 | 說明 |
|------|------|
| `flutter run` | **Debug**：啟動後終端印出 `[VERIFY][PASS/FAIL/SKIP][代碼]` |
| `flutter run --release --dart-define=RUN_VERIFICATION_HARNESS=true` | **Release 實機驗證**時開啟同一套報告 |
| `flutter run --dart-define=ENABLE_FIELD_LOGS=true` | 現場 BLE／維護流程 log |
| `flutter run --dart-define=SKIP_VERIFICATION_HARNESS=true` | 關閉偵錯輸出 |

代碼對照：`ENV-*` 環境、`CARB-*` 碳匯手冊試算、`BND-*` 邊界快取、`API-*` 登入後 API。  
手動步驟（L/B/F/N/**M/I**）會印 `[VERIFY][INFO][*-MANUAL]` 提示，仍需依下方表格勾選。

碳匯欄位說明見 `docs/CARBON_CALCULATION.md`。

### 0.2 實機操作 Runbook（一起驗證用）

> 目標：`flutter run` 啟動後**直接看終端 log** 判讀 bug；自動項看 `[VERIFY]`，現場流程看 `[BleLive]/[FieldGPS]/[Maintain]/[Pending]`。
> ⚠️ 後端位址為**目前開發機**，交接去個人化時會改成占位符（見 `WORK_STATUS.md`「交接去個人化 worklist」）。

> 🧭 **座標 SOP（資料正確性關鍵，見 WORK_STATUS F-C）**：取 GPS 時務必**人站在樹旁**取點（拿儀器或手機皆可），系統一律把座標視為**樹位**、不再以 HD/AZ 偏移。
> 切勿在**站位**（退後瞄樹冠處）取 GPS——站位與樹相距一個 HD（實機可達數十公尺），會讓地圖上的樹整批偏移。HD/AZ 僅作量測幾何紀錄、不參與定位。

**1. 確認後端在線**（Windows）
```powershell
tailscale status                              # 應看到 <HOST> (linux) 在線
curl.exe -s -m 12 http://<SERVER_IP>:3000/health   # 回 OK 才繼續
```
- App 內建 HTTPS 預設 `https://<TAILSCALE_HOST>/api` **目前不通**（Tailscale serve/Nginx 443 未起）→ 驗證一律用下方直連 IP 覆寫。
- 需登 Ubuntu 查狀態：`ssh -i $env:USERPROFILE\.ssh\id_ed25519 <SERVER_USER>@<SERVER_IP>` → `pm2 logs tree-backend`。

**2. 啟動 App（Debug，最省事；harness + field log 預設開）**
```powershell
cd frontend
flutter run --dart-define=API_BASE_URL=http://<SERVER_IP>:3000/api
```
Release 實機（要加旗標才吐 log）：
```powershell
flutter run --release ^
  --dart-define=API_BASE_URL=http://<SERVER_IP>:3000/api ^
  --dart-define=RUN_VERIFICATION_HARNESS=true ^
  --dart-define=ENABLE_FIELD_LOGS=true ^
  --dart-define=FIXTURE_PROJECT_CODE=<要驗的區代碼>
```

**3. 開機看自動報告**：終端出現 `[VERIFY] 驗證摘要 PASS=.. FAIL=.. SKIP=..`。
- `FAIL` → 依代碼排查（`ENV-003`=後端連不到、`CARB-001`=手冊試算、`BND-001`=快取、`FIX-*`=測試樹）。
- `API-001/BND-003/FIX-*` 一開始多為 `SKIP`（**開機在登入前跑**）→ **登入後在終端按 `R`（hot restart）讓 harness 帶 JWT 重跑**。

**4. 現場硬體步驟（我代操終端、你操作硬體，逐步對照下方 §8–§10）**

| 驗證項 | 你操作硬體 | 終端要看到的 log |
|--------|-----------|------------------|
| M1–M4 維護 GPS／新增樹 | 維護量測→重測→BLE SEND→選 GPS 三選一 | `[Maintain]`、`[FieldGPS]`、`[Pending]` |
| M5/M6 雙機鎖 | A 進樹 X、B 同樹 | A：`[Maintain] lock acquired`；B：被擋/顯示鎖定者（看 UI + log 409） |
| EOT-1/2 藍牙整檔 | MEMORY 開→SEND FILES／中途斷線 | `[BleLive] ... EOT`（成功）／`斷線`（不算成功） |
| I3P/IDME + T4 | 測高模式→SEND | `[BleLive]` PHGF 解析、樹高入表單 |
| F1–F3 相機 | 整合拍照／樹種 | UI 即時樹幹框（log 輔助） |

> 純自動化已覆蓋的項目（見 §0.0）實機只需抽查；上表是**硬體/雙機/射頻/相機**真人項。

---

## 8. 維護場次（2026-06 P0，建議一次測完）

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| M1 | 維護量測 → 重測既有樹 → BLE SEND | SEND 後 **取消／不更新／更新 GPS** 三選一 | [ ] |
| M2 | 選「不更新」且樹有舊座標 | pending 沿用原 lat/lon | [ ] |
| M3 | 選「更新 GPS」 | 手機定位；transfer 可更新樹位 | [ ] |
| M4 | 本場 **新增樹** 提交 | 回清單；**不**進待辦／地圖 | [ ] |
| M5 | A 重測樹 X 進 BLE | B 同樹被擋或清單顯示鎖定者 | [ ] |
| M6 | A 完成或離開 | 鎖釋放；B 可進入 | [ ] |
| M7 | 手冊模式 + Remote Diameter | instrument DBH 僅參考；正式 DBH 手輸 | [ ] |
| M8 | 管理員 → 使用者 → 關聯專案 | 先選專案（區位）再勾區 | [ ] |

---

## 9. 儀器 HEIGHT 3P / HEIGHT DME

> 硬體手冊 §2.1.3 DME 鍵、§4.7 超音波、§5.2 超音波測距；  
> **HEIGHT 3P / HEIGHT DME** 為 **STD 應用選單**（`STD V37.VL7`），與 DME **按鍵**（選單導航／雷射模式切換）不同。

| 儀器模式 | 量測 | CSV 整檔匯入 | 現場 BLE（PHGF） |
|----------|------|--------------|------------------|
| **HEIGHT 3P** | 雷射三點測高 | ✅ TYPE=3P，SEQ 合併 | ✅ H/HD/AZ；場次可標 3P |
| **HEIGHT DME** | 超音波 + T4（§5.2） | ✅ TYPE=DME 樹木列保留 | ✅ H/HD/AZ；場次可標 DME |
| **Remote Diameter** | 設定 §4.4.9 | ✅ DIA 欄 | ✅ PHGF 第 13–14 欄 |

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| I3P-1 | **HEIGHT 3P** → MEMORY 關 → SEND | 表單樹高與 HUD 一致 | [ ] |
| I3P-2 | 連續 2 棵 SEND | 第二棵 PHGF 正常（§9.3 前綴） | [ ] |
| IDME-1 | **HEIGHT DME** + T4 → SEND | 現場 BLE 樹高進表單 | [ ] |
| IDME-2 | MEMORY 開 → SEND FILES 含 HEIGHT DME 列 | 待測量／V2 匯入可見該筆（非整批丟棄） | [ ] |
| IRD-1 | Remote Diameter 開 → SEND | instrument DBH 顯示；手冊不寫正式 DBH | [ ] |

---

## 10. BLE 整檔 + transfer 追溯（2026-06-08 新整合）

> 儀器：**MEMORY 開** → 選 SEND FILES 傳 `DATA.CSV`；**MEMORY 關** → 現場逐棵 SEND（勿混用）。

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| EOT-1 | 藍牙匯入 → 連線 → SEND FILES 收完 | 綠色「傳輸完成 (EOT)」；有解析列 | [ ] |
| EOT-2 | 傳輸中強制關藍牙／斷線 | 「傳輸未完成或中斷」；**不**當成功 | [ ] |
| CSV-1 | 整檔含 **3P** 同 ID 多 SEQ | 待測量/V2 淨樹高 = max(H)−min(H) | [ ] |
| CSV-2 | 整檔含 **HEIGHT DME** 樹木列 | 進 pending（校準 `#;SET` 仍排除） | [ ] |
| LIVE-1 | 現場設定選 **HEIGHT 3P** → SEND 一棵 → 完成 transfer | DB 歷次 `instrument_type`=3P（或 snapshot height_method） | [ ] |
| LIVE-2 | 現場設定選 **HEIGHT DME** → T4 → SEND → transfer | 同上，type=DME | [ ] |
| TR-1 | 任一 pending 完成 → 批次 transfer | `tree_measurement_raw.instrument_type` ≠ VLGEO2+Vision | [ ] |
| TR-2 | Remote Diameter 有值 → transfer | raw / 歷次有 `instrument_dbh_cm`；正式 dbh 仍手輸（手冊） | [ ] |
| MAP-1 | （可選）SEND FILES 送 MAP*.CSV | SnackBar 提示 MAP 製圖點；**不**進樹木 pending | [ ] |

---

## 1. 409 樂觀鎖（待測量整合表單）

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| L1 | 待測量任務 → 選一棵 → 開始測量（會設 in_progress）→ 填寫整合表單 → **提交** | **成功**，不出現「資料已被他人修改」 | [ ] |
| L2 | VLGEO2 現場連線 → SEND 一棵 → 完成整合表單提交 | 同上 | [ ] |
| L3 | 兩支手機同帳號專案：A 開任務不提交；B 同任務提交；A 再提交 | A 出現 **409 衝突對話框**（三選一） | [ ] |
| L4 | L3 選「手動合併」→ 調整後再提交 | **第二次提交成功** | [ ] |
| L5 | 樹木調查 → 編輯既有樹 → 修改 DBH → 儲存 | 儲存成功；若兩人同時編輯應出現 409（需 GET 含 `updated_at`） | [ ] |

---

## 2. 專案邊界

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| B1 | 專案管理員 → 繪製專案邊界 → 下拉**切換專案** → 儲存 | `project_code` 與所選專案一致（非固定 widget 傳入值） | [ ] |
| B2 | API：`GET /api/project-boundaries/by_code/{真實代碼}` | 回 200 與 polygon（**不是** 404「找不到 by_code」） | [ ] |
| B3 | 手動輸入 V3 → 選專案 → 看邊界狀態 chip | 與後端 status 一致 | [ ] |
| B4 | 建議邊界（≥3 棵 GPS）→ 預覽 → 儲存 | 成功；地圖顯示新邊界 | [ ] |
| B5 | 帳號 A 登出 → 帳號 B 登入 → BLE 匯入自動匹配 | B **不會**用到 A 快取的邊界（登出已清快取） | [ ] |
| B6 | 調查員帳號呼叫 find_project（或 BLE 匹配） | 僅能匹配**有權限專案**的邊界 | [ ] |
| B7 | 專案名稱含特殊字元（空格、括號）→ 查詢邊界 | 不 404 / 不路由錯誤 | [ ] |
| _ | **測試樣本檔在 `docs/boundary_samples/`**（coords / wgs84 / twd97 / kml），三個檔匯入後應重疊 | — | — |
| B8 | 邊界頁 → 右下選單「貼上座標」→ 貼 `coords_sample.txt` 內容（≥3 點） → 解析 | 預覽顯示頂點數；地圖載入後可微調再儲存 | [ ] |
| B9 | 貼上自相交座標（蝴蝶結順序） | 預覽提示自相交，可選「自動重排後載入」（角度→最近鄰）；強行儲存被後端 400 拒絕 | [ ] |
| B10 | 邊界頁 → 「匯入 KML/GeoJSON」→ 選 `sample_boundary.kml`（Google Earth 格式） | 預覽顯示「WGS84」、頂點數、面積；載入後可儲存 | [ ] |
| B11 | 匯入 `sample_boundary_twd97.geojson`（EPSG:3826） | 預覽顯示偵測座標系統並已轉 WGS84，與 wgs84 樣本重疊、落在台灣 | [ ] |
| B12 | 匯入後/貼座標後未儲存即返回 | 跳出「未儲存的邊界」警告（PopScope 草稿保護） | [ ] |
| B13 | 載入頂點後切換「區」下拉 | 草稿清空，不污染另一區 | [ ] |
| B14 | 貼上 `coords_sample_badrow.txt`（第 3 筆掉小數點） | 提示「疑似缺少小數點，應為 …？」並略過該行，其餘正常載入 | [ ] |
| B15 | 貼上 `coords_complex_pond.txt`（魚塭 9 點，凹形） | 預覽畫出非四方形/凹多邊形、不警告自相交、可儲存 | [ ] |
| B16 | 貼上 `coords_scrambled_convex.txt`（亂序凸四邊形） | 預覽提示自相交；按「自動重排」後恢復正常凸四邊形 | [ ] |
| B17 | 手動點選頂點故意畫出交叉邊界 → 按「儲存」 | 跳出「邊界自相交」對話框；按「自動重排」後形狀修正、需再按一次儲存；複雜凹形則提示手動調整 | [ ] |
| B18 | 已有邊界的區 → 右上「匯出 KML」圖示 | 下載 `<區名>.kml` 並可用 Google Earth 開啟；再用「匯入 KML」讀回座標一致 | [ ] |
| B19 | 匯入 `sample_boundary_complex.kml`（凹形 KML） | 預覽畫出凹形魚塭、不警告自相交、可儲存 | [ ] |
| B20 | 匯入 `sample_boundary_points_only.kml`（只有圖釘、無多邊形） | 仍解析成功，依點順序連成邊界並提示「使用標記點」；順序不對可自動重排 | [ ] |
| B21 | 匯入學院實檔（圖釘+多邊形並存的 Google Earth KML） | 正確採用多邊形「區塊1」（約 9 頂點），忽略零散圖釘 | [ ] |
| B22 | 邊界頁 → 「匯入檔案」→ 選 `coords_sample.txt`（或 `.csv` 逐行座標） | 前端直接解析（同貼上座標）；預覽顯示頂點數與座標順序，可載入微調再儲存 | [ ] |
| B23 | 匯入缺小數點/自相交的 `.txt`（如 `coords_sample_badrow.txt`） | 同貼上座標的提醒（缺小數點略過該行；自相交可自動重排） | [ ] |

---

## 3. 現場測量 / 拍照模式

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| F1 | 首頁 → 現場測量 → 掃描選 VLGEO2 | 列表手選，非自動連第一台 | [ ] |
| F2 | 整合表單 → 整合拍照 | 進入 Scanner（**有即時樹幹框**）→ 量測回表單 | [ ] |
| F3 | 單純拍照 / 拍照+樹種 | 各模式行為符合說明 | [ ] |

---

## 4. 邀請註冊與帳號隔離

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| A1 | 管理員 API：`POST /api/invites`（Bearer JWT） | 回傳邀請碼 | [ ] |
| A2 | 登入頁 → 有邀請碼？註冊 → 新帳號登入 | 成功 | [ ] |
| A3 | 新帳號僅能看到被授權專案 | 符合角色/專案設定 | [ ] |
| A4 | 邀請碼管理頁：建立邀請碼 → 展開「綁定區」選單勾選多個區 | 選單（ExpansionTile）可展開、複選正常、標題顯示已選數量 | [ ] |
| A5 | 邀請碼清單依建立日期分組顯示、卡片顯示建立時間 | 同日的碼歸在同一日期標題下 | [ ] |
| A6 | 右側選單 → 「刪除紀錄」→ 確認 | 該筆消失；`DELETE /api/invites/:id` 回 200 並寫稽核 `DELETE_INVITE` | [ ] |

---

## 5. 冪等上傳（弱網）

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| R1 | 同一 `X-Request-Id` 重送 `POST .../pending-measurements/batch` | 第二次回**相同** `inserted_ids`，不重複插列 | [ ] |

---

## 7. 新建專案 → 邊界 → 各頁（重點回歸）

| # | 步驟 | 預期 | 勾選 |
|---|------|------|------|
| N1 | V3 新增專案 → **稍後再說**（不畫邊界）→ 智慧模式 | GPS **不會**自動選到該專案；chip「尚未畫邊界」 | [ ] |
| N2 | 同上 → 手動選專案 + 提交 | 可成功提交 | [ ] |
| N3 | 新增專案 → **立刻繪製** → 儲存邊界 → 返回 | 地圖 overlay **立即**出現 polygon；智慧模式 GPS 可匹配 | [ ] |
| N4 | 地圖頁 → 進入專案 | 邊界與樹木篩選正常（有 code 的專案） | [ ] |
| N5 | BLE 匯入（邊界內多棵） | 自動指派專案；區位與 projects 一致 | [ ] |
| N6 | 待測量整合表單（樹在邊界外） | 彈出警告，可選仍要提交 | [ ] |

設計說明：`docs/BOUNDARY_SYSTEM_DESIGN.md`

---

## 5b. 維護量測：樹種繼承、照片、樹木生命週期（淘汰/復原）

> 註：本節編號採 **LC**（lifecycle），與 §8 維護量測的 M 系列、§0.0 的 M2–M7 區分。

| # | 步驟 | 預期 | 勾選 |
|---|------|------|------|
| LC1 | 維護量測 → 選一棵「有樹種」的樹重測 → 進整合表單 | 樹種欄位**已預填**既有樹種（可手動修改） | [ ] |
| LC2 | 維護重測 → 樹種留預填值不改 → 提交 | 歷史與主檔樹種維持原樹種（非「待辨識」） | [ ] |
| LC3 | 維護 + 拍照模式（拍照+樹種），辨識結果**不同** | 跳出「樹種辨識結果不同」對話框，可選變更/維持 | [ ] |
| LC4 | 維護 + 拍照模式，辨識結果**相同** | 不打擾、不跳框 | [ ] |
| LC5 | 重測 → 樹況選「枯死/倒塌/已移除」 → 看到淘汰說明 → 提交 | 該樹標為已淘汰；自維護待辦消失 | [ ] |
| LC6 | 地圖頁 | 已淘汰樹為半透明紫標記；「隱藏已淘汰」可切換顯示/隱藏 | [ ] |
| LC7 | 樹木清單 | 已淘汰樹為灰字 + 「已淘汰」標籤 | [ ] |
| LC8 | 統計/碳匯報告 | 已淘汰樹**不計入**活立木碳儲量總計與在庫；另有「已淘汰」概況 | [ ] |
| LC9 | 詳情頁（調查管理員）→ 生命週期卡「淘汰」 | 可選枯死/倒塌/移除；狀態即時更新（呼叫 `POST /tree_survey/:id/retire`） | [ ] |
| LC10 | 詳情頁（調查管理員）→ 對已淘汰樹「復原」 | 回復存活；重新計入碳匯與維護待辦（`POST /tree_survey/:id/restore`） | [ ] |
| LC11 | 詳情頁 | 頂部顯示雲端「最新照片」（清本地快取後仍可見） | [ ] |
| LC12 | 詳情頁 → 歷次量測展開某次 | 顯示該次拍攝的縮圖（依 measurement_id） | [ ] |
| ST1 | 新增/維護量測 → 樹木狀況區 | 下拉顯示內建狀況（正常/傾斜/病蟲害/枯萎/枯立木/枯死/倒塌/已移除）；淘汰類標「（淘汰）」 | [ ] |
| ST2 | 選「枯立木」提交 | 該樹歸為非活立木（不計活立木碳匯）；地圖/清單以淘汰呈現 | [ ] |
| ST3 | 選「其他（自訂）」→ 輸入新狀況（如「雷擊」）→ 提交 | 提交成功；該狀況寫入共用選單 | [ ] |
| ST4 | 另一帳號/裝置開新增表單 | 上一步的自訂狀況「雷擊」出現在下拉（共享） | [ ] |
| ST5 | 兩人同時新增同名自訂狀況 | 僅建立一筆（後端 ON CONFLICT 收斂），不報錯、不重複 | [ ] |

設計說明：`SURVEY_HISTORY.md`、後端 `utils/treeLifecycle.js`

---

## 6. 語言

| # | 步驟 | 預期結果 | 勾選 |
|---|------|----------|------|
| I1 | 首頁選單切 English | 現場測量 / 功能卡片為英文 | [ ] |

---

## 已知尚未在本輪修復（驗證時若失敗可記錄）

- 邊界驗證 fail-open：快取空時本地驗證可能放行（應以後端 `/check` 為準）
- 重疊專案邊界：仍取第一個匹配
- `project_name` 與 `projects.name` 更名不同步（長期應改以 `project_code` 為主鍵）

---

## 問題回報模板

```
日期：
裝置：
帳號角色：
步驟編號（如 B2）：
實際結果：
截圖 / log：
```
