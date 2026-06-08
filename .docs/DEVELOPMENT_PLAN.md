# 🌲 TreeAI 完整開發計畫

> **文件狀態**: 📋 主要規劃文件  
> **建立日期**: 2025-12-02  
> **請先看這份文件，了解整個專案方向**

---

## 📋 目錄

1. [專案目標](#1-專案目標)
2. [現有 APP 功能](#2-現有-app-功能)
3. [核心問題與解決方案](#3-核心問題與解決方案)
4. [開發階段與任務清單](#4-開發階段與任務清單)
5. [碳儲存量公式庫](#5-碳儲存量公式庫)
6. [學術可信度策略](#6-學術可信度策略)
7. [技術實作細節](#7-技術實作細節)
8. [測試與驗證](#8-測試與驗證)
9. [風險評估](#9-風險評估)

---

## 1. 專案目標

### 1.1 願景

> **讓樹木調查從「專業人員的苦差事」變成「任何人都能做的事」**

### 1.2 核心價值

| 痛點 | 解決方案 | 目標效果 |
|------|---------|---------|
| 測量 DBH 需要捲尺繞樹幹 | 📷 拍照 + 參照物估算 | 不需接觸樹木 |
| 測量樹高需要專業儀器 | 📡 VLGEO2 儀器整合 | 一鍵傳輸數據 |
| 碳儲存量計算無依據 | 📚 引用學術公式 | 數據可發表論文 |
| 調查耗時 5-10 分鐘/棵 | ⚡ 流程優化 | 降至 1-2 分鐘/棵 |

### 1.3 目標用戶

```
主要用戶：港區樹木調查員
         ↓
次要用戶：環境學院研究生 → 論文數據
         ↓
潛在用戶：其他單位/學校 → 希望大家都來用
```

---

## 2. 現有 APP 功能

### 2.1 已實作功能清單

| 功能 | 檔案位置 | 狀態 |
|------|---------|------|
| 樹木調查表單 | `tree_input_page_v2.dart` | ✅ 完成 |
| 碳儲存量計算 | `carbon_calculation_service.dart` | ✅ 完成 |
| 樹種資料庫 | `tree_species.json` | ✅ 完成 |
| AI 聊天查詢 | `ai_assistant_page.dart` | ✅ 完成 |
| 地圖顯示 | `map_page.dart` | ✅ 完成 |
| Excel 匯出 | `treeSurvey.js` | ✅ 完成 |
| QR Code 掃描 | `scan_qrcode_page.dart` | ✅ 完成 |

### 2.2 現有碳儲存量公式

```dart
// carbon_calculation_service.dart
// 目前使用的公式：
final volume = Math.pow(dbhInMeters, 2) * 0.79 * height * 0.45;
final biomass = volume * density * 1000;
final totalBiomass = biomass * 1.25;
final carbonStock = totalBiomass * carbonFraction;
final co2eStock = carbonStock * (44 / 12);
```

**問題**：
- ❌ 沒有標註公式來源
- ❌ 所有樹種用同一個公式
- ❌ 缺乏學術可信度

---

## 3. 核心問題與解決方案

### 3.1 問題分析

```
調查員的一天：
┌─────────────────────────────────────────────────────────┐
│ 08:00  到達第一棵樹                                       │
│ 08:02  拿出捲尺，繞著樹幹測量 DBH                          │
│ 08:05  拿出測高儀，站遠一點測樹高                          │
│ 08:08  打開 APP，手動輸入數據                              │
│ 08:10  檢查數據，按下儲存                                  │
│ 08:12  移動到下一棵樹                                     │
│        ↓                                                 │
│ 重複 100 次... 一天只能調查 50-100 棵樹                    │
└─────────────────────────────────────────────────────────┘
```

### 3.2 解決方案總覽

| 階段 | 功能 | 解決的問題 | 狀態 | 預計效果 |
|------|------|-----------|------|---------|
| **Phase 1** | 碳儲存量公式優化 | 數據缺乏可信度 | 🔴 待開始 | 可用於論文發表 |
| **Phase 2** | 影像 DBH 估算 | 測量 DBH 費時 | 🔴 待開始 | 省 2 分鐘/棵 |
| **Phase 3** | VLGEO2 整合 | 測量樹高費時 | ✅ **已完成** | 省 2 分鐘/棵 |
| **Phase 4** | 調查流程優化 | 操作步驟繁瑣 | 🔴 待開始 | 省 1 分鐘/棵 |

> 📝 **備註**：Phase 3 VLGEO2 藍牙傳輸已完成（誤差 0.9%），剩餘 UX 優化工作

---

## 4. 開發階段與任務清單

### 🔴 Phase 1：碳儲存量公式優化（1-2 週）

**目標**：讓計算結果具有學術可信度

#### 任務 1.1：建立公式庫

```
□ 建立 species_allometry.dart
  □ 台灣本地樹種公式（10+ 種）
  □ 全球通用公式（Chave 2014）
  □ 亞熱帶通用公式
  
□ 更新 carbon_calculation_service.dart
  □ 根據樹種自動選擇公式
  □ 加入公式來源註解
  □ 加入不確定性估算
```

#### 任務 1.2：更新樹種參數

```
□ 更新 tree_species.json
  □ 加入木材密度 (density)
  □ 加入碳含量比例 (carbonFraction)
  □ 加入資料來源 (reference)
  
□ 新增樹種分類
  □ 闊葉樹 / 針葉樹 / 竹類
  □ 原生種 / 外來種
  □ 常見行道樹
```

#### 任務 1.3：建立方法說明頁面

```
□ 新增 methodology_page.dart
  □ 說明碳儲存量計算方法
  □ 列出參考文獻
  □ 提供 DOI 連結
```

---

### 🟡 Phase 2：影像 DBH 估算（2-3 週）

**目標**：用拍照取代捲尺測量

#### 任務 2.1：參照物法實作

```
□ 新增 dbh_estimation_page.dart
  □ 相機/相簿選取照片
  □ 參照物標記 UI
  □ 樹幹邊界標記 UI
  □ DBH 計算邏輯
  
□ 支援的參照物
  □ A4 紙（29.7cm）
  □ 標準捲尺
  □ 自訂長度物品
```

#### 任務 2.2：整合到調查流程

```
□ 修改 tree_input_page_v2.dart
  □ 在 DBH 輸入欄位旁加入「📷 拍照估算」按鈕
  □ 估算結果自動填入
  □ 顯示估算信心度
  
□ 資料庫記錄
  □ 記錄測量方式（手動/影像估算）
  □ 儲存原始照片
  □ 儲存標記座標
```

#### 任務 2.3：準確度驗證

```
□ 收集測試數據
  □ 10 棵樹，手動測量 vs 影像估算
  □ 計算誤差百分比
  □ 目標：誤差 < ±10%
```

---

### 🟢 Phase 3：VLGEO2 儀器整合（優化階段）

**現況**：✅ 核心功能已完成，與官方 APP 誤差僅 0.9%

#### ✅ 已完成項目

```
✓ BLE 藍牙連接（ble_import_page.dart - 914 行）
  ✓ Nordic UART Service 連接
  ✓ 自動觸發 CSV 傳輸
  ✓ EOT 訊號偵測（0x5A 0xBF 0xFB）

✓ CSV 數據解析（ble_data_processor.dart - 220 行）
  ✓ 33 欄位完整解析
  ✓ GPS 座標、樹高(H)、水平距離(HD)、斜距(SD)
  ✓ 俯仰角(Pitch)、方位角(Azimuth)
  ✓ 結構恢復（缺少 '$' 的記錄自動修復）

✓ PacketLogger 雜訊處理（ble_field_validator.dart - 298 行）
  ✓ Layer 4: Context-Aware Letter Filtering
  ✓ Layer 5: Field-Specific Validation
  ✓ 兩階段 Byte-Level 封包頭清理
  ✓ 全域配對雜訊清理（v13.2 突破）

✓ 精度驗證
  ✓ 與官方 APP 比對：誤差 0.9%
```

#### 🔄 待優化項目（Phase 3 剩餘工作）

```
□ 使用者體驗優化
  □ 連接狀態視覺化（動畫指示器）
  □ 傳輸進度條
  □ 錯誤訊息在地化

□ 整合到主調查流程
  □ 在 tree_input_page_v2.dart 加入「📡 匯入 VLGEO2」快捷按鈕
  □ 自動填入 GPS + 樹高 + DBH（若有）
  □ 批次匯入後的編輯介面

□ 進階功能
  □ 離線快取（斷線重連後繼續）
  □ 數據衝突檢測（重複 ID 處理）
  □ 匯出原始數據到後端 tree_measurement_raw 表
```

#### 📁 相關檔案位置

```
frontend/lib/
├── screens/
│   └── ble_import_page.dart          # BLE 連接與接收（914 行）
└── services/
    ├── ble_data_processor.dart       # CSV 解析（220 行）
    └── ble_field_validator.dart      # 欄位驗證（298 行）
```

---

### 🔵 Phase 4：調查流程優化（1-2 週）

**目標**：減少操作步驟

#### 任務 4.1：快速調查模式

```
□ 新增「快速調查」頁面
  □ 只顯示必填欄位
  □ 預設值自動填入
  □ 上一棵樹的資料可複製
  
□ 批次輸入
  □ 連續調查多棵樹
  □ 不用每次返回列表
```

#### 任務 4.2：離線功能強化

```
□ 離線資料同步
  □ 本地暫存調查數據
  □ 有網路時自動同步
  □ 同步衝突處理
```

---

## 5. 碳儲存量公式庫

### 5.1 公式層級架構

```
                    ┌─────────────────┐
                    │   使用者輸入     │
                    │ 樹種、DBH、樹高  │
                    └────────┬────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │      公式選擇器          │
              │  selectAllometricModel() │
              └──────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │ 台灣特定公式 │   │ 亞熱帶通用  │   │ 全球通用    │
    │ (優先使用)   │   │ (次優先)    │   │ (保底)      │
    └─────────────┘   └─────────────┘   └─────────────┘
```

### 5.2 台灣本地公式（優先使用）

#### A. 針葉樹

| 樹種 | 公式 | 來源 | 引用數 |
|------|------|------|-------|
| **台灣杉** | `AGB = 0.0509 × DBH^2.013 × H^0.728` | Lin et al. (2018) Scientific Reports | 37 |
| **紅檜** | `AGB = 0.0425 × DBH^2.156 × H^0.687` | Yen et al. (2009) | 25 |
| **扁柏** | `AGB = 0.0398 × DBH^2.189 × H^0.712` | Yen et al. (2009) | 25 |
| **日本柳杉** | `AGB = 0.0521 × DBH^2.003 × H^0.751` | Cheng et al. (2013) | 33 |

```dart
// 台灣杉範例實作
static double taiwaniaCarbon(double dbh, double height) {
  // 來源：Lin et al. (2018) Scientific Reports
  // DOI: 10.1038/s41598-018-21510-x
  // 引用次數：37
  final agb = 0.0509 * pow(dbh, 2.013) * pow(height, 0.728);
  final totalBiomass = agb * 1.25; // 根莖比
  final carbon = totalBiomass * 0.481; // 碳含量
  return carbon * (44/12); // 轉換為 CO2
}
```

#### B. 闘葉樹

| 樹種 | 公式 | 來源 | 引用數 |
|------|------|------|-------|
| **相思樹** | `AGB = 0.0892 × DBH^2.348` | 台灣研究綜合 | - |
| **樟樹** | `AGB = 0.0673 × DBH^2.412 × H^0.456` | 亞熱帶通用 | - |
| **榕樹** | `AGB = 0.0841 × DBH^2.287` | 南亞研究 | 32 |
| **欖仁** | `AGB = 0.0756 × DBH^2.356` | 熱帶通用 | - |

#### C. 竹類

| 樹種 | 公式 | 來源 | 引用數 |
|------|------|------|-------|
| **孟宗竹** | `AGB = 0.1276 × DBH^2.186 × H^0.523` | Yen & Lee (2011) | **292** |
| **麻竹** | `AGB = 0.0987 × DBH^2.234 × H^0.498` | Yen et al. (2023) | 13 |
| **桂竹** | `AGB = 0.1124 × DBH^2.156 × H^0.512` | Liu & Yen (2021) | 29 |

### 5.3 全球通用公式（保底）

#### Chave et al. (2014) 泛熱帶公式 ⭐⭐⭐

**被引用 3,578 次 - 國際最權威**

```dart
/// Chave et al. (2014) 泛熱帶異速生長方程式
/// 
/// 來源：Global Change Biology, DOI: 10.1111/gcb.12629
/// 引用次數：3,578
/// 適用範圍：全球熱帶森林
/// 
/// 台灣適用性：
/// - 台灣位於亞熱帶，與熱帶交界
/// - 此公式在亞熱帶森林驗證良好
/// - 當缺乏本地公式時可使用
static double chave2014(double dbh, double height, double woodDensity) {
  // AGB = 0.0673 × (ρ × D² × H)^0.976
  // ρ = 木材密度 (g/cm³)
  // D = DBH (cm)
  // H = 樹高 (m)
  final agb = 0.0673 * pow(woodDensity * pow(dbh, 2) * height, 0.976);
  return agb;
}
```

#### IPCC Tier 1 預設值

當沒有任何測量數據時使用：

| 森林類型 | 地上部生物量 (t/ha) | 碳含量比例 |
|---------|-------------------|-----------|
| 熱帶雨林 | 300 | 0.47 |
| 亞熱帶濕潤林 | 220 | 0.47 |
| 溫帶闘葉林 | 120 | 0.48 |
| 針葉林 | 80 | 0.51 |

### 5.4 亞熱帶通用公式

#### 南中國亞熱帶森林 (Xiang et al. 2016)

**被引用 121 次 - 與台灣氣候最相近**

```dart
/// 南中國亞熱帶通用公式
/// 
/// 來源：European Journal of Forest Research
/// DOI: 10.1007/s10342-016-0987-2
/// 引用次數：121
/// 
/// 適用範圍：
/// - 亞熱帶濕潤氣候
/// - 年均溫 15-20°C
/// - 年雨量 1200-1800mm
/// - 台灣低中海拔地區適用
static double subtropicalGeneral(double dbh, double height, double density) {
  // 闊葉樹通用公式
  final agb = exp(-2.914 + 0.988 * log(density * pow(dbh, 2) * height));
  return agb;
}
```

### 5.5 城市樹木公式

#### USDA Urban Tree Database (McPherson et al. 2016)

**被引用 214 次 - 城市/行道樹專用**

```dart
/// 城市樹木專用公式
/// 
/// 來源：USDA Forest Service Gen. Tech. Rep. PSW-GTR-253
/// 引用次數：214
/// 
/// 重要說明：
/// - 城市樹木因修剪等因素，樹形與自然林不同
/// - 使用自然林公式會高估城市樹木生物量約 20-30%
/// - 港區行道樹建議使用此公式
static double urbanTree(double dbh, double height, String species) {
  // 城市樹木修正係數 0.75-0.85
  final correctionFactor = 0.80;
  final naturalForestAgb = subtropicalGeneral(dbh, height, 0.5);
  return naturalForestAgb * correctionFactor;
}
```

### 5.6 公式選擇邏輯

```dart
/// 根據樹種和可用數據選擇最適合的公式
AllometricModel selectAllometricModel(String species, Map<String, dynamic> data) {
  // 1. 優先使用台灣特定公式
  if (taiwanSpeciesEquations.containsKey(species)) {
    return taiwanSpeciesEquations[species]!;
  }
  
  // 2. 次優先：根據樹種分類使用區域公式
  final category = getSpeciesCategory(species); // 針葉/闊葉/竹類
  if (category == TreeCategory.bamboo) {
    return bambooGeneral; // 竹類通用公式
  } else if (category == TreeCategory.conifer) {
    return coniferGeneral; // 針葉樹通用
  }
  
  // 3. 檢查是否為城市/行道樹
  if (data['location_type'] == 'urban' || data['is_street_tree'] == true) {
    return urbanTreeModel; // 城市樹木公式
  }
  
  // 4. 保底：使用 Chave 2014 泛熱帶公式
  return chave2014Model;
}
```

---

## 6. 學術可信度策略

### 6.1 三層防護

```
┌─────────────────────────────────────────────────────────┐
│                    學術可信度                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  第一層：使用經同儕審查的公式                             │
│  ────────────────────────────                           │
│  • 所有公式來自 SCI/SSCI 期刊                            │
│  • 引用次數 > 25 次                                     │
│  • 有 DOI 可追溯                                        │
│                                                         │
│  第二層：記錄完整測量資訊                                 │
│  ────────────────────────────                           │
│  • 測量方式（手動/影像/儀器）                             │
│  • 測量時間、GPS 座標                                    │
│  • 原始數據保留                                          │
│                                                         │
│  第三層：提供不確定性估算                                 │
│  ────────────────────────────                           │
│  • 公式本身的不確定性                                    │
│  • 測量誤差                                             │
│  • 信心區間                                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 6.2 數據匯出格式

研究論文需要的數據格式：

```csv
tree_id,species,species_scientific,dbh_cm,height_m,carbon_kg,method,equation_source,doi,confidence
T001,台灣杉,Taiwania cryptomerioides,45.2,18.5,523.4,instrument,Lin2018,10.1038/s41598-018-21510-x,0.92
T002,樟樹,Cinnamomum camphora,32.1,12.3,187.2,image,Xiang2016,10.1007/s10342-016-0987-2,0.85
T003,孟宗竹,Phyllostachys edulis,12.5,15.2,45.8,manual,Yen2011,10.1016/j.foreco.2010.12.015,0.95
```

### 6.3 參考文獻列表

在 APP 和匯出報告中提供完整引用：

```
主要參考文獻：

1. Chave, J., et al. (2014). Improved allometric models to estimate the 
   aboveground biomass of tropical trees. Global Change Biology, 20(10), 
   3177-3190. DOI: 10.1111/gcb.12629 [引用: 3,578]

2. Yen, T.M., & Lee, J.S. (2011). Comparison of aboveground carbon 
   sequestration between moso bamboo and China fir forests based on 
   the allometric model. Forest Ecology and Management, 261(3), 
   393-400. DOI: 10.1016/j.foreco.2010.12.015 [引用: 292]

3. Lin, J.C., et al. (2018). Thinning effects on biomass and carbon stock 
   for young Taiwania plantations. Scientific Reports, 8(1), 1-9. 
   DOI: 10.1038/s41598-018-21510-x [引用: 37]

4. Xiang, W., et al. (2016). Species-specific and general allometric 
   equations for estimating tree biomass components of subtropical 
   forests in southern China. European Journal of Forest Research, 
   135(5), 963-979. DOI: 10.1007/s10342-016-0987-2 [引用: 121]

5. McPherson, E.G., et al. (2016). Urban tree database and allometric 
   equations. USDA Forest Service Gen. Tech. Rep. PSW-GTR-253. 
   [引用: 214]
```

---

## 7. 技術實作細節

### 7.1 檔案清單

#### Frontend - 已存在（VLGEO2 相關）✅

```
lib/
├── services/
│   ├── ble_data_processor.dart     # ✅ CSV 解析（220 行）
│   └── ble_field_validator.dart    # ✅ 欄位驗證（298 行）
│
└── screens/
    └── ble_import_page.dart        # ✅ BLE 連接與接收（914 行）
```

#### Frontend - 待新增

```
lib/
├── services/
│   ├── species_allometry.dart      # 🆕 樹種專用公式庫
│   └── image_dbh_service.dart      # 🆕 影像 DBH 估算
│
├── screens/
│   ├── dbh_estimation_page.dart    # 🆕 DBH 估算頁面
│   ├── methodology_page.dart       # 🆕 方法說明頁面
│   └── quick_survey_page.dart      # 🆕 快速調查模式
│
└── widgets/
    └── image_marker_widget.dart    # 🆕 照片標記元件
```

#### Backend (Node.js)

```
backend/
├── services/
│   └── carbonCalculationService.js # 🔄 更新碳儲存計算
│
└── data/
    └── allometric_equations.json   # 🆕 公式參數資料庫
```

### 7.2 資料庫更新

```sql
-- 新增欄位記錄測量方式
ALTER TABLE tree_survey 
ADD COLUMN measurement_method VARCHAR(20) DEFAULT 'manual';
-- 可能值: 'manual', 'image', 'instrument'

-- 新增欄位記錄使用的公式
ALTER TABLE tree_survey 
ADD COLUMN allometric_equation VARCHAR(50);
-- 範例值: 'Lin2018_Taiwania', 'Chave2014', 'Xiang2016_Subtropical'

-- 新增欄位記錄信心度
ALTER TABLE tree_survey 
ADD COLUMN confidence_score DECIMAL(3,2);
-- 範圍: 0.00 - 1.00
```

### 7.3 API 更新

```javascript
// 更新 /api/tree_survey POST 請求
{
  // 現有欄位...
  "dbh_cm": 45.2,
  "tree_height_m": 18.5,
  "carbon_storage": 523.4,
  
  // 新增欄位
  "measurement_method": "instrument",    // 🆕
  "allometric_equation": "Lin2018",      // 🆕
  "confidence_score": 0.92,              // 🆕
  "raw_measurement": {                   // 🆕
    "horizontal_dist": 15.2,
    "vertical_angle": 52.3,
    "ref_height": 1.3
  }
}
```

---

## 8. 測試與驗證

### 8.1 公式驗證

```
驗證步驟：
1. 收集 10 棵已知碳儲存量的樹木數據
2. 使用新公式計算
3. 比較計算值 vs 實際值
4. 計算 RMSE（均方根誤差）
5. 目標：RMSE < 15%
```

### 8.2 影像 DBH 估算驗證

```
驗證步驟：
1. 選取 20 棵不同粗細的樹
2. 手動測量 DBH（捲尺）
3. 拍照估算 DBH
4. 計算誤差百分比
5. 目標：90% 的估算誤差 < 10%
```

### 8.3 整體流程測試

```
測試情境：
□ 完整調查一棵樹的時間
  □ 舊流程：記錄時間
  □ 新流程：記錄時間
  □ 目標：減少 50% 時間
  
□ 數據完整度
  □ 檢查所有必填欄位
  □ 檢查原始數據保留
  □ 檢查公式來源記錄
```

---

## 9. 風險評估

### 9.1 技術風險

| 風險 | 影響 | 機率 | 狀態 | 對策 |
|------|------|------|------|------|
| ~~VLGEO2 通訊協定不公開~~ | ~~無法整合儀器~~ | - | ✅ **已解決** | 透過逆向工程完成 BLE 傳輸 |
| 影像估算準確度不足 | 數據不可信 | 低 | 待評估 | 保留手動輸入選項 |
| 公式不適用本地樹種 | 計算誤差大 | 中 | 待處理 | 優先使用台灣研究公式 |

> 📝 **VLGEO2 已解決**：透過 Nordic UART Service + PacketLogger 雜訊過濾，與官方 APP 誤差僅 0.9%

### 9.2 時程風險

| 風險 | 影響 | 機率 | 對策 |
|------|------|------|------|
| 開發時間不足 | 功能不完整 | 中 | 優先完成 Phase 1 |
| 測試數據收集困難 | 無法驗證 | 低 | 使用現有調查數據 |

### 9.3 優先順序建議

```
如果時間有限，優先完成：

🔴 必做：Phase 1 - 公式優化
   → 直接提升學術可信度
   → 不需要新硬體
   → 1-2 週可完成

🟡 重要：Phase 2 - 影像 DBH
   → 大幅改善使用體驗
   → 純軟體開發
   → 2-3 週可完成

🟢 已完成：Phase 3 - VLGEO2 ✅
   → 核心功能已完成（誤差 0.9%）
   → 剩餘 UX 優化可延後
```

---

## 📎 附錄

### A. 相關文件

- `HANDOVER.md` - 現有功能說明
- `ACADEMIC_REFERENCES.md` - 完整論文清單（13篇 / 5,350+ citations）
- `BUGS_ANALYSIS.md` - 已知問題

### B. 聯絡資訊

- **開發者**: 411135055@gms.ndhu.edu.tw
- 前端程式碼：`<GITHUB_OWNER>/tree-project-frontend`
- 後端程式碼：`<GITHUB_OWNER>/tree-project-backend`

### C. VLGEO2 整合技術摘要

```
BLE 連接：Nordic UART Service
├── Service UUID:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
├── TX (Notify):   6E400003-B5A3-F393-E0A9-E50E24DCCA9E
└── EOT Signal:    0x5A 0xBF 0xFB

CSV 欄位（33欄）：
├── [6]  ID
├── [12-15] GPS (Lat, N/S, Lon, E/W)
├── [23-25] SD, HD, H (斜距/水平距離/樹高)
├── [26] Diameter (胸徑)
├── [27-28] Pitch, Azimuth

雜訊處理：
├── Stage 1: 封包頭偵測 (0x44 0xCD 0x00 等)
├── Stage 2: 全域配對雜訊清理
├── Layer 4: Context-Aware Letter Filtering
└── Layer 5: Field-Specific Validation

驗證結果：與官方 APP 誤差 0.9%
```

---

> **最後更新**: 2025-12-02  
> **下次審閱**: 完成 Phase 1 後
