# 開發歷程紀錄

> 本文件彙整各模組開發過程中的關鍵轉折、除錯經驗與技術細節。
> 供論文撰寫、口頭報告與未來研究參考。
> 生成日期：2026-04-02

---

## 一、BLE 設備整合：從 0% 到 100% 的封包解碼之路

### 1.1 問題背景

Haglöf Vertex Laser Geo 2 (VLGEO2_3190) 透過 BLE Nordic UART Service 傳輸 33 欄位 CSV 量測資料。
儀器使用 ATT MTU 20 bytes 分包傳輸，每筆 CSV 記錄約 200+ bytes，需要 10+ 個封包重組。

裝置資訊（BLE Scanner 截圖確認）：
- Device Name: VLGEO2_ 3190
- MAC: C4:D3:6A:BA:63:7E
- Manufacturer: Haglöf Sweden
- Model: GEO2
- Nordic UART Service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
- TX Characteristic UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e (NOTIFY, READ)
- RX Characteristic UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e (WRITE, WRITE NO RESPONSE)

### 1.2 版本演進

| 版本 | 做法 | 準確率 | 核心問題 |
|------|------|--------|----------|
| v13.1（初始） | `utf8.decode(data, allowMalformed: true)` 無過濾 | ~38% | 封包標頭 bytes 全混入 CSV 文字 |
| v13.2-v13.4 | 嘗試過濾非 ASCII 字元 | 83.9%→98.5% | **0x44 = ASCII 'D'**，合法字元，過濾不掉 |
| v13.5-v13.6 | Hardcode 3 組 header pattern + 回溯刪除 | 99.7% | 不具通用性，程式碼全塞在 UI 頁面 |
| v13.5+ (V135_PLUS) | 以封包長度 + 通用 `44 xx 00` 模式判斷 | **100%** | 最終重構為獨立 BlePacketDecoder class |

### 1.3 關鍵發現：0x44 即 ASCII 'D'

這是整個 BLE 開發最核心的轉折點。

封包標頭格式為 `44 xx 00`（其中 xx ≤ 0x0F），byte 0x44 的十進位為 68，正好是 ASCII 字元 'D'。
這代表用「過濾非可印字元」的策略根本行不通——'D' 是完全合法的可印字元。

實際案例（from IPHONE_ANALYSIS_REPORT.md）：
- iPhone 官方 APP (Haglöf Link) 也有此問題：336 筆中 199 筆（59.2%）出現 'D' 污染
- 例如：`8.2` → `8.2D`、`14.8` → `14.8D`、`1P` → `1RDP`、`301025` → `D301025`

### 1.4 最終解法：以封包長度為核心

關鍵認知：不需要 hardcode 每個 header 值，而是用封包長度 + 通用模式來判斷：

```dart
// BlePacketDecoder.decodePacket (現行版本)
if (pktLen == 20) {
  if (packetData[0] == 0x44 && packetData[1] <= 0x0F && packetData[2] == 0x00) {
    return packetData.sublist(3);   // 標記封包：跳過前 3 bytes
  } else {
    return packetData;              // 正常封包：全部保留
  }
} else if (pktLen == 5) {
  return packetData.sublist(0, 3);  // 殘留封包：只留前 3 bytes
}
```

### 1.5 完整四階段 Pipeline

1. **封包解碼** (`BlePacketDecoder`)：依封包長度分類並移除標頭
2. **CSV 白名單過濾** (`_csvCleanRegex`)：只保留 `[0-9A-Z\.\;\-\r\n\$\#]`
3. **結構修復 + 語意校驗** (`BleDataProcessor` + `BleFieldValidator`)：
   - 自動補回遺失的 `$` 起始符號
   - 數值欄位中混入的字母過濾（Context-Aware Layer 4）
   - 座標小數位數、UTC 時間戳格式、SEQ 範圍等逐欄位驗證（Layer 5）
4. **資料過濾** (`DataFilterService`)：移除不完整記錄 + 去重

### 1.6 驗證結果

- 測試資料：336 筆完整記錄
- Ground Truth：DATA_2.CSV（設備製造商軟體匯出）
- 驗證方式：PC_RECEIVED_V135_PLUS.CSV vs DATA_2.CSV 逐欄位比對
- 結果：**336/336 = 100.0%**

### 1.7 開發代價

在 `Tree_app_equipment_info/` 目錄下留下了 30+ 個除錯腳本，記錄了整個追蹤過程：
- `analyze_noise_pattern.py`：分析雜訊模式
- `trace_final_3_hex.py`：追蹤最後 3 筆差異的原始 Hex
- `trace_id_10031_hex.py`：追蹤特定 ID 的封包拼接過程
- `compare_iphone_android.py`：比較 iPhone vs Android 的接收差異
- `v135_final_push.py` / `v136_enhanced_pair_filter.py`：最後階段的修正

---

## 二、純視覺 DBH 量測：從 AR 到 Tesla 風格純視覺

### 2.1 時代一：ARCore/ARKit（2025-12 ~ 2026-02）

最初嘗試用 Flutter ARCore/ARKit 來量測 DBH：
- 需要校準相機高度（加速度計輔助）
- 手動在 AR 場景中對齊 1.3m 虛擬標記
- 依賴 LiDAR/ToF 深度感測器

**放棄原因**：大多數 Android 手機沒有 LiDAR，調查人員通常使用中階手機。

### 2.2 時代二：純視覺轉向（2026-02-15，單日完成）

受 Tesla 純視覺自駕路線啟發，改用單目深度估計神經網路取代硬體深度感測器。
核心靈感來自三篇論文：
- Holcomb et al. (2023)：提供 DBH = pixel_width × depth / focal_length 數學框架
- Xiang et al. (2025)：圓柱幾何校正（弦長→直徑）
- Depth Anything V2：初始深度估計模型

**同一天**完成三件事：
1. 後端 FastAPI 建立 Depth Anything V2 推論服務
2. 前端建立 `PureVisionDbhPage`（用戶畫框→上傳→回傳 DBH）
3. **徹底移除** AR 量測路徑（icon 從 `view_in_ar` 改為 `camera_alt`，顏色從紫色改為青色）

### 2.3 時代三：精度飛躍（2026-02-19）

最關鍵的一天，一次 commit (+516 行) 完成：
- **Depth Pro**（Apple ICLR 2025 SOTA，350M 參數）整合為主要深度模型
- **OpenVINO** 對 Intel iGPU 的加速支援
- **EXIF 焦距 Pipeline**：從前端接收 focal_length_mm、focal_length_35mm、phone_make、phone_model，後端內建 **50+ 裝置感測器寬度資料庫**（`PHONE_SENSORS` dict）
- **多策略樹幹寬度提取**：深度梯度 + 閾值聚類 + 垂直一致性，取中位數
- **圓柱幾何校正公式**：d = l·p / √(p² − l²/4)

**只有開發者才知道的細節**：`PHONE_SENSORS` 字典包含 `"mi a1": 5.64` 和 `"mi 5x": 5.64`——因為 Xiaomi Mi A1 = Mi 5X（同機型不同名稱），開發者的測試機就是這台 2017 年的入門手機。

### 2.4 信心分數設計（經驗調校）

距離信心衰減不是來自文獻，而是實測調校：
- 1-3m：滿分
- 3-5m：0.7
- 5-8m：0.4
- >8m：0.2
- 樹幹像素寬度 <20px：降至 0.2

圓柱校正有「物理不可能」防護：若 chord_length ≥ 2 × camera_distance（你在樹裡面），退回原始弦長。

### 2.5 TFLite GPU Delegate 掙扎（2026-03-02）

一天內的痛苦除錯：
- **GPU Delegate 失敗**：部分裝置上 GPU delegate 會把多個 output tensor 合併成一個 flat tensor，破壞 `[1, 37, 8400]` 的預期形狀。設了 4 級回退：GPU→多線程CPU→單線程CPU→fromAsset
- **推論耗時自動退出**：若 GPU delegate 首次推論 >3 秒，自動排程 CPU 重載
- **FP16 型別轉換 bug**：GPU delegate 的 FP16 輸出要 `.toDouble()` 不能用 `as double`
- **TFLite → LiteRT 改名**：開發中途 Google 把 TFLite 改名為 LiteRT，tflite_flutter 從 0.11.0 升到 0.12.1

---

## 三、OpenVINO：125-600× 加速與一個 typo crash

### 3.1 加速成果

Depth Pro 在 Intel Arc iGPU 上：
- CPU 推論：25-120 秒
- XPU (Intel Arc) 推論：0.2 秒
- **加速比：125-600×**

### 3.2 INT8 權重壓縮

使用 NNCF `compress_weights(mode=INT8_SYM)` 進行權重壓縮：
- 非完整 INT8 量化（不需校準資料集）
- 權重 INT8、推論精度 FP16
- 模型大小減半，推論加速 20-40%
- 精度損失 < 0.1-0.3%

### 3.3 Typo Crash

`start.ps1` 的 GPU 偵測因屬性名寫錯而 crash：`total_mem` vs `total_memory`。一個字元的差別。

### 3.4 SAM 2.1 混合模式

Image encoder（95% 運算量）匯出到 OpenVINO，輕量 mask decoder 保留在 PyTorch——刻意的「混合模式」最佳化。

### 3.5 MX130 incompatibility

Ubuntu 伺服器的 NVIDIA MX130 不支援 OpenVINO（僅限 Intel）。因此 Ubuntu 跑 DA V2 Base (97M)  作為輕量替代，Windows PC (Core Ultra 5) 負責重量級的 Depth Pro 推論。形成**雙機架構**。

---

## 四、ReAct AI Agent：上線 6 小時內的 5 次緊急修復

### 4.1 首次上線（2026-03-11，3:48 AM）

690 行的 `agentService.js` 在凌晨一次 commit 完成。幾小時內就爆了：

1. **`tool_choice: 'required'`**：在 OpenAI 有效，SiliconFlow 回 HTTP 500。改為 `'auto'`
2. **模型選擇掙扎**：DeepSeek-V3 的 function calling 不穩定，實驗多個模型後只有 Qwen2.5-72B 穩定
3. **Token 追蹤跨 PM2 instance**：in-memory Map 在 PM2 cluster 各 instance 間不共享。改為 PostgreSQL `agent_token_usage` 表 + `ON CONFLICT` upsert + 1 小時滑動視窗

### 4.2 Text-to-SQL 安全設計

迭代建立的防護層：
- 48+ 禁止 SQL 關鍵字
- 15+ 正規表達式注入偵測（含 PostgreSQL 特有的 `E'\x` 十六進位、`U&'` Unicode、`||` 串接攻擊）
- 5 表白名單
- UNION 禁止
- 平衡引號檢查
- 複雜度限制（最多 10 JOINs、20 ANDs）
- SQL 字串先去除字串常量再做關鍵字檢查（避免 `LIKE '%drop%'` 誤報）

---

## 五、部署：從 Render 雲端到書桌下的筆電

### 5.1 遷移故事

系統原在 Render (PaaS) 運行，但遇到限制：
- 免費 DB 到期
- 無 GPU 可做 ML 推論

解法：遷移到一台 Intel i3-8130U / 11GB RAM 的 Ubuntu 24.04 筆電。

### 5.2 11GB RAM 分配

| 用途 | 記憶體 |
|------|--------|
| OS | 1.5 GB |
| PostgreSQL (`shared_buffers`) | 2 GB |
| Node.js (PM2 × 2 instances) | 1 GB |
| ML Service | 4 GB |
| Nginx | 0.1 GB |
| Buffer | 2.4 GB |
| Swap | 4 GB（防 OOM） |

### 5.3 零停機自動部署

GitHub push → Webhook (`HMAC-SHA256` 簽章驗證) → `deploy.sh` → `pm2 reload` (cluster mode) → health check (3 retries) → 失敗自動 rollback。

### 5.4 雙機架構

- Ubuntu 筆電：Node.js + PostgreSQL（API 與資料庫）
- Windows PC (Core Ultra 5 125H)：FastAPI + OpenVINO（CV 推論）
- 透過 Tailscale VPN 連接

---

## 六、碳儲量估算：35× 差異與 Ficus 密度修正

### 6.1 前後端公式不一致

最初前端和後端的碳計算公式差了 35 倍。原因是後端有假的 `CARBON_CREDIT_RATE = 0.05` 和模擬交易數據。統一為 Chave et al. (2014) 公式後修正。

### 6.2 木材密度表

82 種台灣常見樹種的密度值，手動交叉比對自：
- Zanne et al. (2009) Global Wood Density Database
- ICRAF 農林資料庫
- 台灣林務局資料
- wood-database.com

發現 Ficus spp. 的原始資料庫中密度值系統性偏高約 0.10 g/cm³，已修正。

### 6.3 誠實承認限制

原本資料庫中的 `tree_carbon_data` 表被**清空**，標註為「未經學術驗證」，改為程式碼中硬編碼（可追溯來源）。論文中明確寫出「尚未逐一與 GWDD 等一手學術來源交叉驗證」作為研究限制。

---

## 七、物種辨識：OOM 與自動新增未知物種

PlantNet → GBIF → iNaturalist 串接中，`generate_species_knowledge.js` 一口氣處理 74+ 物種時在 11GB 伺服器上 OOM crash。修正：每個物種間加 5 秒冷卻、顯式 null 釋放大型變數、手動 gc.collect()。batch size 從 5 降到 3。

如果 PlantNet 辨識出資料庫中不存在的物種（信心 > 15%），系統會**自動新增**該物種到 DB，包含交易式鎖定(`BEGIN`/`COMMIT`)與並發安全重新檢查。
