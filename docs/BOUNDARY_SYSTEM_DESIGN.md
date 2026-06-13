# 區邊界（DB: project_boundaries）— 全系統設計與情境對照

> ⚠️ 詞彙：本文寫於 2026-06 詞彙互換前。文中「專案」= DB `projects` = **現行 UI 的「區」**；完整對照見 `HANDOFF.md` §8 詞彙對照表。
> 回答：「先新增區 → 智慧表單／地圖／BLE 會不會出問題？」  
> 程式協調：`lib/services/v3/project_boundary_coordinator.dart`

---

## 1. 核心原則

1. **專案（`projects`）與邊界（`project_boundaries`）分離** — 新建專案**不會**自動有 polygon。  
2. **無邊界 = 手動模式** — 允許調查，但 GPS **不會**自動匹配到該專案（除非點落在別專案邊界內）。  
3. **有邊界後** — 自動匹配、座標驗證、BLE 指派、地圖顯示皆依 polygon；**必須刷新快取**才一致。  
4. **權威專案 metadata** — 以 `projects` 表為準；邊界列的 `project_area` / `project_code` 僅為快取，BLE 與匹配後會用 `ProjectBoundaryCoordinator.enrichProjectFields` 補齊。

---

## 2. 使用者旅程與系統行為

### 2.1 新建專案（無邊界）

```
新增專案 (projects)
    → 可選：立刻繪製邊界 (ProjectBoundaryDrawPage)
    → 若跳過：status = 無邊界 / canSuggest（≥3 棵 GPS 樹）
```

| 功能 | 無邊界時行為 | 已修復？ |
|------|-------------|---------|
| V3 智慧表單自動匹配 | 不匹配；需手選專案 | ✅ 設計如此 |
| V3 手動模式提交 | 允許；chip 顯示「尚未畫邊界」 | ✅ |
| 地圖 polygon | 不顯示該專案 | ✅ |
| V2 單筆樹木 | 允許提交 | ✅ + server 驗證 |
| BLE 匯入 | 全 outside → 手動指派 | ✅ |
| 整合表單／待測量 | 不驗邊界（儀器流程） | ⚠️ 現為 warnOnly 提示 |

### 2.2 剛畫完邊界（關鍵）

**過去 BUG**：快取 5 分鐘 + 繪製頁儲存未通知 → 地圖／智慧表單仍「看不到／匹配不到」新邊界。

**現在**：

- 繪製頁儲存成功 → `ProjectBoundaryCoordinator.afterBoundaryMutation()`
- V3 新增專案返回 → `afterBoundaryMutation` + 重載地圖 overlay + 刷新 status chip
- V2 新增專案返回 → `afterBoundaryMutation`
- 智慧匹配前 → `beforeAutoMatch()` = `forceRefresh`
- 地圖進入 → `forMapDisplay(forceRefresh: true)`（地圖頁原本即有）
- BLE 匯入 → `getAllBoundaries(forceRefresh: true)`（原本即有）

### 2.3 登出／換帳號

- `AuthService.clearSession()` → `ProjectBoundaryService.clearCache()` ✅

---

## 3. 各頁面職責（單一表）

| 頁面 | 邊界職責 | Coordinator API |
|------|---------|-----------------|
| `manual_input_page_v3` | 匹配、驗證、新專案引導、地圖 overlay | `beforeAutoMatch`, `evaluateSubmit`, `afterBoundaryMutation`, `forMapDisplay` |
| `tree_input_page_v2` | 提交驗證、新專案引導 | `evaluateSubmit`, `afterBoundaryMutation` |
| `project_boundary_draw_page` | CRUD polygon | `afterBoundaryMutation` |
| `map_page` | 顯示、篩選 | `forMapDisplay`（經 service forceRefresh） |
| `ble_import_page` | GPS→專案指派 | `forceRefresh` + `enrichProjectFields` |
| `integrated_tree_form_page` | 提交前 warnOnly | `evaluateSubmit(warnOnly)` |
| `pending_measurement_task_page` | 無直接邊界 | — |

---

## 3.5 邊界輸入方式（2026-06 擴充）

依環境學院需求，邊界頁 `project_boundary_draw_page` 支援多種輸入方式，全部走「**預覽 → 確認 → 儲存**」一致流程（與「建議邊界」相同），不直接寫庫：

| 方式 | 來源值 `source` | 說明 | 座標系統 |
|------|----------------|------|---------|
| 手繪 | `draw` | 點選地圖逐點繪製 | WGS84 |
| 貼上座標 | `coords` | 貼上座標清單（方式 1）；前端 `lib/utils/boundary_input.dart` 解析 | WGS84，自動判斷 lng,lat / lat,lng |
| 匯入 KML/KMZ | `kml` | Google Earth 匯出（方式 3） | WGS84（KML 規格固定） |
| 匯入 GeoJSON | `geojson` | GIS 匯出（方式 3） | WGS84 或 TWD97/TM2(EPSG:3826/3825)，後端 `proj4` 自動轉換 |
| 建議邊界 | `suggest` | 由樹木 GPS 凸包（既有） | WGS84 |
| 含座標圖檔 | （未實作） | 方式 2，已從 UI 移除「即將推出」項；待學院提供範例檔再評估 | — |

**匯出（與匯入雙向，2026-06）**：
- `GET /api/project-boundaries/export.kml?project=<名稱>`（或 `?code=<代碼>`，`projectAuthFilter` 權限）→ 回 `application/vnd.google-earth.kml+xml`，座標 `lng,lat,0`、環自動閉合。
- 前端在邊界頁右上角提供「匯出 KML」圖示（沿用 `DownloadService`：含 JWT、TLS、`OpenFilex`），Android 以 Google Earth 開啟。
- 匯出的 KML 可再用「匯入 KML」讀回，座標一致，形成 Google Earth ↔ 系統雙向流。

**後端**：
- `utils/boundaryImport.js` 解析 KML/KMZ/GeoJSON → 統一輸出 `[[lat,lng],...]` 開放環；多多邊形取面積最大並警告；`turf.kinks` 偵測自相交。
- `POST /api/project-boundaries/import`（`requireRole('專案管理員')`，multipart `file`，上限 `BOUNDARY_IMPORT_MAX_MB`，預設 5MB）→ 僅回傳預覽，不寫庫。
- `POST /api/project-boundaries` 新增 `source`、`allowTreesOutside` 欄位；寫入前一律以 `turf.kinks` 拒絕自相交（回 400 `SELF_INTERSECTING`）。
- `project_boundaries.source` 欄位（migration `30_project_boundaries_source.pg.sql`）記錄來源供溯源；既有列為 NULL。

**情境與跳出/返回**（沿用既有繪製流程，無新增風險）：
- 貼座標/匯入載入頂點後即進入「繪製中」狀態 → `PopScope` 草稿保護生效（離開前警告未儲存）。
- 切換「區」下拉 → 既有 `_onProjectChanged` 清空草稿。
- 儲存成功 → `afterBoundaryMutation` 通知各頁刷新；樂觀鎖 409 衝突沿用既有對話框。
- 自相交時前端預覽提供「自動重排後載入」；**手動繪製**（點選/拖曳）若畫出交叉，按「儲存」時亦會偵測並提供「自動重排」；後端為最後防線再次拒絕。

**防呆（座標品質）**：
- 經緯度顛倒：台灣經度約 120（絕對值 > 90）、緯度約 23（≤ 90），**逐組自動判斷** lng,lat 或 lat,lng；無法判斷時採使用者選的假設順序。
- 缺小數點（例如學院圖一的 `1201240910` 應為 `120.1240910`）：超出合理範圍的值會被略過並在預覽以 ⚠️ 明確提示「疑似缺少小數點，應為 …？」，**不自動竄改**（以正常邏輯為主，由使用者確認修正）。
- **自相交容錯（自動重排）**分兩段（`lib/utils/boundary_input.dart` 的 `tryAutoReorder`）：先「依角度重排」（凸形最佳）、仍自相交再試「最近鄰連線」（細長/部分凹形）；皆無法解決（複雜凹形）時明確提示「請手動調整頂點順序」並不硬存。
- **誠實極限**：把一組「無序點」唯一還原成使用者心中的凹多邊形，幾何上不唯一（多邊形化問題），無法 100% 自動化。**凹形請依走訪順序輸入，或直接匯入 KML/GeoJSON**（檔案保留繞行順序最穩）。預覽在地圖畫出多邊形供**視覺確認**，是最終防呆。

**格式確認（依學院訊息與圖一）**：圖一為「方式 1 直接鍵入」範例，格式為 **WGS84 十進位度數、(經度, 緯度)**。方式 3 的「Google Earth」匯出即 **KML/KMZ（規格固定 WGS84）**，「GIS 圖檔」常見為 **GeoJSON**（支援 WGS84 與 TWD97/TM2 自動轉換）；**Shapefile(.shp) 暫不支援**，建議改用 KML/GeoJSON 匯出。

**多人**：匯入僅產生預覽（read-only），實際寫入仍走既有樂觀鎖 + 角色權限，無新增併發風險。

---

## 4. 仍須知／長期改進

| 項目 | 說明 |
|------|------|
| 邊界主鍵為 `project_name` | 專案改名後邊界需手動同步或 DB 遷移 → `project_code` |
| 重疊邊界 | 多專案重疊時取第一個；應加使用者選擇 UI |
| BLE 未用 `/batch_match` | 與後端權限／重疊語意未完全對齊 |
| 刪除專案順序 | 應先刪邊界再刪專案（後端／cleanup 需一致） |
| 邊界僅單一多邊形 | MultiPolygon／含洞（holes）暫不支援，匯入多多邊形取面積最大 |
| 方式 2（含座標圖檔） | 尚未實作；需學院提供範例（GeoTIFF/世界檔）後再評估 |
| Shapefile（.shp） | 暫不支援，建議學院改用 KML/GeoJSON 匯出 |
| TWD97 自動偵測 | 無 `crs` 標示的 GeoJSON 以數值範圍推斷投影座標，建議拿到學院範例檔後再校驗 |

---

## 5. 驗證建議（新增專案路徑）

見 `VERIFICATION_CHECKLIST.md` 第 7 節「新建專案全流程」。
