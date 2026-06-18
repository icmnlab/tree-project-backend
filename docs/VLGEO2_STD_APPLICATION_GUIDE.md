# VLGEO2 STD 應用程式手冊（外部參考）

> 硬體技術手冊（原廠 PDF，不隨 repo 交付）：[Grube mirror](https://cdn.grube.de/2025/02/14/Manual_Hagloef-Vertex-Laser-Geo2_80-194-02_80-195-02_en_30042024.pdf) 或向 Haglöf 索取  
> 下列為 **STD 應用層**（含 MAP TARGET、MAP TRAIL、林相量測選單）的公開文件連結。

## 官方來源

| 資源 | URL | 說明 |
|------|-----|------|
| **VLGEO/LGEO User Guide（STD 功能）** | https://content.protocols.io/files/hun362te.pdf | 含 MAP TARGET 逐步操作、MAP TRAIL、量測選單 |
| Haglöf Applications Cloud – STD | https://haglof.app/product/std/ | 應用說明與版本（目前雲端標示 3.9；現場機器可能為 3.7） |
| Vertex Laser Geo 2 產品頁 | https://haglofsweden.com/project/vertex-laser-geo-2/ | Map Target / Map Trail 功能摘要 |

## MAP TARGET（摘自 User Guide）

- 用途：建築物、堆積物等 **大目標 3D 製圖**，或清伐區等 **2D 面積**。
- 流程：主選單 → MAP TARGET → 輸入 5 位數 Target ID → 選自動儲存或手動 SEND → 量測基準線 / 目標點（LASER BASELINE、LASER ON TARGET、DME BASELINE 等）。
- **與一般樹高 `3P`/`1P` 不同**：輸出檔名為 `MAPxxx.CSV` / `MAPxxx.KML`（硬體手冊 §7），APP 目前 **未解析** 此類型。

## 與本系統開發的對應

### 藍牙通道（交接必讀：勿與 Classic 混淆）

VLGEO2 同時支援兩種藍牙，**本 APP 只實作 BLE**：

| 通道 | 藍牙類型 | 協定／內容 | APP 模組 | 現場狀態 |
|------|----------|-----------|----------|----------|
| 逐棵 SEND（MEMORY 關） | **BLE Low Energy**（NUS GATT） | Haglöf **`$PHGF` 量測句**（樹高、距離、方位；**非** GGA 定位） | `BleLiveSessionPage` + `ble_live_packet_decoder.dart` | ✅ 主推 |
| 整檔 SEND FILES | **BLE** | Vertex `DATA.CSV` + EOT | `BleImportPage` + `BlePacketDecoder` | 程式保留；SOP 暫緩主推 |
| 儀器 GPS 串流 | **Classic Bluetooth SPP**（`VLGEO2_*_COM`） | 標準 **NMEA GGA/RMC** | ❌ **未實作**（僅 `test/vlgeo2_ble_analysis/` 腳本） | 不採用 |
| 現場樹木座標 | — | **手機 GPS**（Geolocator） | `field_gps_capture.dart` | ✅ 專案決議（2026-05-28） |

> 程式中的 `BleLiveNmeaAssembler` 處理的是 **BLE 上的 `$PHGF` 文字分片**，命名沿用「NMEA 風格」句型，**不是** Classic SPP 衛星定位 NMEA。外接 GNSS 規劃已取消，見 `HANDOFF_EXTERNAL_GNSS_AND_BLE.md`。

| 模式 | 協議 | APP 模組 |
|------|------|----------|
| 批次 `DATA.CSV` | BLE 整檔 + EOT | `BleImportPage` + `BlePacketDecoder` |
| 即時單筆（MEMORY 關） | BLE GATT：`$PHGF` §9.2 | `BleLiveSessionPage` + `BleLivePacketDecoder` |
| MAP TARGET / TRAIL | 應用手冊 + `MAP*.CSV` | 待實測與專用 parser |

## 建議

向經銷商索取與機器上 **VLGEO2_3190 STD V3.7** 完全對應的 PDF；雲端 3.9 手冊多數章節仍適用，但選單文字可能略有差異。
