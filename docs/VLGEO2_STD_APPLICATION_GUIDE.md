# VLGEO2 STD 應用程式手冊（外部參考）

> 硬體技術手冊（本 repo 已有）：`project_code/Manual_Hagloef-Vertex-Laser-Geo2_80-194-02_80-195-02_en_30042024.pdf`  
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

| 模式 | 協議 | APP 模組 |
|------|------|----------|
| 批次 `DATA.CSV` | BLE 整檔 + EOT | `BleImportPage` + `BlePacketDecoder` |
| 即時單筆（MEMORY 關） | GATT 20-byte §9.3 | `BleLiveSessionPage` + `BleLivePacketDecoder` |
| MAP TARGET / TRAIL | 應用手冊 + `MAP*.CSV` | 待實測與專用 parser |

## 建議

向經銷商索取與機器上 **VLGEO2_3190 STD V3.7** 完全對應的 PDF；雲端 3.9 手冊多數章節仍適用，但選單文字可能略有差異。
