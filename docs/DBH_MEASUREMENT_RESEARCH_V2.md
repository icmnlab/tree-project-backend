# 純視覺 DBH 測量技術研究報告 V2

> 📁 **歷史研究存檔**：本文是 2026-02 的研究規劃，文中待辦與檔案規劃不代表現況。
> 最終落地方案 = DA3 深度估計 + 伺服器端 YOLOv8-seg，見 `backend/ml_service/README.md`。

## Pure Vision DBH Measurement Technical Research Report — 2026 Edition

**版本**: 2.0  
**日期**: 2026-02  
**專案**: Sustainable TreeAI — TIPC 樹木管理系統  
**目標**: 基於自架 MacBook 伺服器的高精度純視覺 DBH 自動測量方案  
**前版**: [V1 — 2025-07](./DBH_PURE_VISION_RESEARCH.md)

---

## 與 V1 的關鍵差異

| 項目 | V1 (2025-07) | V2 (2026-02) |
|------|-------------|-------------|
| **運算環境** | 手機端 / Render Free Tier | 自架 MacBook Pro (i7, 8GB RAM) via ngrok |
| **模型限制** | 必須 <30M 參數 | 可用 **~350M 參數**（Server-side） |
| **推論時間** | <200ms | 可容忍 **2-5 秒** |
| **深度模型** | DA V2 Small (24.8M) only | DA V2 Base/Large、**DA3Metric-Large**、**MetricAnything** |
| **分割模型** | 基於深度圖的啟發式方法 | **SAM 2.1** / **YOLO26-seg** / **Grounded SAM** |
| **新技術** | — | Depth Anything 3、MetricAnything、SAM 2.1、YOLO26 |

---

## 目錄

1. [硬體條件重新評估](#1-硬體條件重新評估)
2. [深度估計模型更新](#2-深度估計模型更新)
3. [樹幹分割技術研究](#3-樹幹分割技術研究)
4. [跨領域量測技術借鑒](#4-跨領域量測技術借鑒)
5. [改進方案設計](#5-改進方案設計)
6. [實作優先順序](#6-實作優先順序)
7. [參考文獻](#7-參考文獻)

---

## 1. 硬體條件重新評估

### 1.1 當前架構

```
手機 App (Flutter)
    │ 拍照 + EXIF
    │
    ▼ HTTPS (ngrok 固定域名)
MacBook Pro 2012 (i7-3615QM, 8GB DDR3, CPU-only)
    │ ML Service (FastAPI + PyTorch)
    │ Depth Estimation + Segmentation + DBH Calculation
    │
    ▼ 結果 JSON + 視覺化圖片
手機 App 顯示結果
```

### 1.2 新硬體的計算能力上限

| 指標 | 值 | 對模型的意義 |
|------|---|-------------|
| CPU | Intel i7-3615QM (4C/8T, 2.3-3.3GHz) | 可執行 ~350M 參數模型 |
| RAM | 8GB 1600MHz DDR3 | 最大載入 ~2GB 模型 (FP16) |
| GPU (內建) | Intel HD Graphics 4000 (1536MB) | 不支援 MPS/CUDA |
| GPU (獨顯) | NVIDIA GeForce GT 650M | macOS Sonoma 已停用 NVIDIA |
| 最終推論 | **CPU-only (AVX)** | Single image: 1-5 秒 |
| 並行能力 | 8 threads | 可管線化 depth + seg |

### 1.3 關鍵洞察：Server-side 解鎖了什麼

1. **模型大小不再是瓶頸** — 從 24.8M 可以升級到 97.5M (Base) 甚至 335M (Large)
2. **可以跑兩個模型** — 深度估計 + 獨立分割模型同時載入
3. **可以做後處理** — 3D 點雲重建、RANSAC 地面擬合、圓柱修正都可以在 Server 端做
4. **不需要 INT8/FP16 量化** — 用 FP32 以獲得最佳精度
5. **可以緩存模型** — 常駐記憶體，避免重複載入

---

## 2. 深度估計模型更新

### 2.1 2025-2026 新模型一覽

#### Depth Anything V2 — 升級到 Base/Large

原報告只用了 Small (24.8M)。現在 Server-side 可以用更大的模型：

| 模型 | 參數量 | CPU 推論估計 | KITTI δ₁ | 授權 |
|------|--------|------------|---------|------|
| DA V2 Metric Outdoor Small | 24.8M | ~1.5s | 0.982 | Apache-2.0 ✅ |
| **DA V2 Metric Outdoor Base** | **97.5M** | **~3s** | ~0.985 | CC-BY-NC-4.0 ⚠️ |
| DA V2 Metric Outdoor Large | 335.3M | ~8s | ~0.989 | CC-BY-NC-4.0 ⚠️ |

**推薦升級**: DA V2 Base (97.5M) — 在可接受的推論時間內提供明顯精度提升。

> ⚠️ Base/Large 是 CC-BY-NC-4.0 授權（非商用），但我們的專案是學術/研究用途，符合要求。

#### Depth Anything 3 (DA3) — 2025-11 發佈 ⭐ 重大突破

DA3 由 ByteDance Seed Team 開發，是 DA V2 的下一代：

| 模型 | 參數量 | 能力 | 授權 | 適用場景 |
|------|--------|------|------|---------|
| DA3-Small | 80M | 相對深度、多視角、Pose | **Apache-2.0 ✅** | 基本深度 |
| DA3-Base | 120M | 同上 | **Apache-2.0 ✅** | 平衡效能 |
| **DA3Metric-Large** | **350M** | **公制深度** + 內參估計 | **Apache-2.0 ✅** | **⭐ DBH 量測首選** |
| DA3-Large | 350M | 相對深度、多視角、Pose | CC-BY-NC-4.0 | 多視角 3D |
| DA3-Giant | 1.15B | 全能力 + 3D Gaussians | CC-BY-NC-4.0 | 太大不適合 |

**DA3Metric-Large 的關鍵優勢**：
1. **顯著優於 DA V2** — 官方聲明在單目深度估計上大幅超越 DA V2
2. **自帶內參估計** — 不再需要依賴 EXIF 或手機感測器資料庫來估算焦距
3. **公制深度公式**: `metric_depth = focal * net_output / 300.`
4. **Apache-2.0 授權** — 完全商用友善
5. **350M 參數** — 在 i7 CPU 上約 5-8 秒推論，可接受

#### MetricAnything (2026-01) — 最新 SOTA

| 特性 | 說明 |
|------|------|
| **訓練資料** | ~20M image-depth pairs，覆蓋 10,000+ 相機型號 |
| **架構** | 基於 MoGe-2 ViT-L 微調 |
| **輸出** | Student-PointMap: 直接輸出 3D 點雲座標 (XYZ) |
| **強項** | 跨相機泛化能力、無需相機內參、Scaling Law 驗證 |
| **授權** | Apache-2.0 ✅ |
| **地位** | 7 個下游任務 SOTA |

**對 DBH 的潛在價值**：
- Student-PointMap 直接輸出 3D 點雲，**省去深度圖 → 3D 反投影的步驟**
- 天然具備跨相機泛化，手機型號識別問題消失
- 但是太新（2026-01），生態尚未成熟

### 2.2 深度模型推薦排序

| 優先級 | 模型 | 理由 |
|--------|------|------|
| 🥇 Phase 1 | **DA V2 Metric Outdoor Base** (97.5M) | 最成熟、HuggingFace 直接可用、精度提升明顯 |
| 🥈 Phase 2 | **DA3Metric-Large** (350M) | 自帶內參、精度更高、Apache-2.0 |
| 🥉 Phase 3 | **MetricAnything Student-PointMap** | 直接 3D 點雲、跨相機泛化、最新 SOTA |

### 2.3 多幀融合策略（新）

Server-side 架構允許接收**多張照片**進行融合：

```
方案 A: 單張 → 深度圖 → DBH（目前）
方案 B: 3 張 → 3 個深度圖 → 中位數融合 → DBH（推薦）
方案 C: 短影片 (10 frames) → DA3 multi-view → 一致性深度 → DBH（最佳但最慢）
```

**方案 B 的好處**：
- 使用者快速連拍 3 張（自動或手動）
- 3 個獨立深度估計取中位數 → 降低隨機誤差 ~42% (√3 改善)
- 無需額外模型，只增加 3x 推論時間
- 預期可將 RMSE 從 3-5cm 降到 2-3.5cm

---

## 3. 樹幹分割技術研究

### 3.1 現有方案的問題

目前使用 **基於深度圖的啟發式分割** (`tree_trunk_detector.py`)：

| 問題 | 描述 |
|------|------|
| 背景干擾 | 多棵樹重疊時無法區分前景目標樹 |
| 非樹物體 | 電線桿、柵欄等垂直物也被偵測為「樹幹」 |
| 複雜場景 | 灌木、草叢、建築物造成前景錯判 |
| 無語義理解 | 純靠深度值，不理解「什麼是樹」 |

### 3.2 新候選技術

#### SAM 2.1 (Segment Anything Model 2.1) — 2024-09 ⭐

| 特性 | 說明 |
|------|------|
| **開發者** | Meta AI (FAIR) |
| **Stars** | 18.5K |
| **授權** | **Apache-2.0** ✅ |
| **能力** | 圖片 + 影片分割，Promptable（點/框/遮罩引導） |
| **模型變體** | `sam2.1_hiera_tiny` (38.9M) → `sam2.1_hiera_large` (224.4M) |
| **對 DBH 的價值** | 使用者/自動提供一個點 prompt → 精確分割出目標樹幹 |

**SAM 2.1 用於樹幹分割的策略**：

```python
# 策略 1: 使用者觸碰目標樹 → 送出 (x, y) 點 prompt
masks = predictor.predict(point_coords=[[user_tap_x, user_tap_y]], 
                          point_labels=[1])  # 1 = 前景

# 策略 2: 自動偵測 → 先用深度找前景中心 → 送出自動 prompt
fg_center = find_foreground_center(depth_map)
masks = predictor.predict(point_coords=[fg_center], point_labels=[1])

# 策略 3: 全自動分割 (Automatic Mask Generator)
from sam2.automatic_mask_generation import SAM2AutomaticMaskGenerator
mask_generator = SAM2AutomaticMaskGenerator(model)
masks = mask_generator.generate(image)
# 然後結合深度資訊篩選出樹幹 mask
```

**SAM 2.1 vs 當前深度啟發式方案**：
- ✅ 語義理解：SAM 理解物體邊界，不會把地面/天空混入
- ✅ 精確邊緣：亞像素級邊界，DBH 計算的像素寬度更準確
- ✅ 使用者引導：一觸碰就能指定目標樹
- ✅ 處理遮擋：部分遮擋也能推斷完整輪廓
- ⚠️ 運算量：Large 模型在 CPU 上 ~3-5 秒

#### YOLO26-seg — 2026-02 最新

Ultralytics 已發佈 **YOLO26** 系列，包含分割模型：

| 模型 | 參數量 | CPU 速度 | mAP^seg | 授權 |
|------|--------|---------|---------|------|
| YOLO26n-seg | ~3M | ~40ms | ~36 | AGPL-3.0 ⚠️ |
| YOLO26s-seg | ~10M | ~90ms | ~44 | AGPL-3.0 ⚠️ |
| YOLO26m-seg | ~20M | ~220ms | ~48 | AGPL-3.0 ⚠️ |

**用於 DBH 的限制**：
- COCO 預訓練模型不包含 `tree_trunk` 類別
- 需要自訓練，且 AGPL-3.0 授權有傳染性（需開源使用它的程式碼）
- 但速度極快，適合 Phase 1 快速候選

#### Grounded SAM = 開放詞彙偵測 + SAM

結合 Grounding DINO（開放詞彙物件偵測）+ SAM：

```python
# 用自然語言 "tree trunk" 定位 → SAM 精確分割
detections = grounding_dino.predict(image, text="tree trunk")
for box in detections.boxes:
    mask = sam.predict(box=box)  # 用偵測框引導 SAM
```

**優勢**：Zero-shot，不需要訓練任何自定義資料集。但較慢。

#### 相關論文

1. **Sapkota & Karkee (2024)** — "Integrating YOLO11 and CBAM for Multi-Season Segmentation of Tree Trunks and Branches"
   - YOLO11 + CBAM 注意力機制
   - 針對果園場景的樹幹實例分割
   - 跨季節（休眠期 + 冠層期）泛化

2. **Khan et al. (2024)** — "Accurate and Efficient Urban Street Tree Inventory with Deep Learning on Mobile Phone Imagery"
   - 手機影像的城市行道樹偵測
   - 深度學習 + 手機相機
   - 與我們的場景高度相關

3. **Wu et al. (2026)** — "YOLO11s Instance Segmentation + Monocular RGB Camera for Rubber Tree Diameter Measurement"
   - **最接近我們方案**：YOLO11s 分割 + 單目 RGB
   - 非固定距離，橡膠樹
   - 驗證了 YOLO 分割 + 單目深度可以量 DBH

### 3.3 分割方案推薦

| 優先級 | 方案 | 理由 |
|--------|------|------|
| 🥇 **Phase 1** | **深度啟發式 + SAM 2.1 Tiny 精修** | 先用深度找粗略區域，再用 SAM 精修邊緣 |
| 🥈 **Phase 2** | **Grounded SAM** (Grounding DINO + SAM 2.1) | Zero-shot "tree trunk" 偵測 + 高品質分割 |
| 🥉 **Phase 3** | **Fine-tuned YOLO26 + SAM** | 用少量樹幹標註訓練 YOLO → 框 prompt → SAM |

### 3.4 混合分割管線（推薦設計）

```
輸入 RGB 影像
    │
    ├─→ [Depth Model] → 深度圖 → 前景候選區域
    │                              │
    │                              ▼
    │                     找出最近且垂直的前景物體中心點
    │                              │
    │                              ▼
    └─→ [SAM 2.1 Tiny] ←── 自動點 prompt (x, y)
                │
                ▼
         精確樹幹遮罩 (pixel-perfect)
                │
                ▼
         結合深度圖 → 計算胸高處像素寬度 + 深度
                │
                ▼
            DBH 計算
```

**此設計的優勢**：
1. 深度圖提供「哪裡有東西」的粗略線索
2. SAM 2.1 提供「那個東西的精確邊界」
3. 不需要任何自訓練資料集
4. 對複雜背景（多棵樹、雜物）有良好耐受性
5. SAM 2.1 Tiny 只有 38.9M 參數，CPU 可接受

---

## 4. 跨領域量測技術借鑒

### 4.1 工業管道直徑量測

工業界長期研究非接觸式管道直徑量測，核心技術包括：

| 技術 | 原理 | 對 DBH 的借鑒 |
|------|------|-------------|
| **結構光** | 投射已知圖案 → 變形分析 | 不適用（需額外硬體） |
| **雙目視覺** | 兩台相機三角測量 | 未來可考慮前後鏡頭 |
| **輪廓擬合** | 邊緣偵測 → 橢圓/圓擬合 → 直徑 | ⭐ 直接適用 |
| **亞像素邊緣** | Sobel + 拋物線插值 → 0.1px 精度 | ⭐ 可提升分割精度 |

**可借鑒的關鍵技術**：

#### 亞像素邊緣偵測 (Sub-pixel Edge Detection)

```python
# 在樹幹遮罩邊緣做亞像素精修
# 原始: mask 邊緣是整數像素 → ±1 px 誤差
# 改進: Sobel 梯度 + 拋物線插值 → ±0.1 px

def subpixel_trunk_width(image_gray, mask, measurement_row):
    """在 measurement_row 上用亞像素精度量測樹幹寬度"""
    row = image_gray[measurement_row]
    grad = np.abs(np.gradient(row.astype(float)))
    
    # 找左右邊緣的梯度峰值
    mask_row = mask[measurement_row]
    left_edge_idx = np.argmax(mask_row)
    right_edge_idx = len(mask_row) - 1 - np.argmax(mask_row[::-1])
    
    # 對每個邊緣做拋物線亞像素插值
    left_subpx = parabolic_interpolation(grad, left_edge_idx)
    right_subpx = parabolic_interpolation(grad, right_edge_idx)
    
    return right_subpx - left_subpx  # 亞像素精度寬度
```

**預期改善**: 像素寬度誤差從 ±1px 降到 ±0.2px → DBH 誤差減少 ~0.5-1cm

#### 橢圓擬合 (Ellipse Fitting)

樹幹橫截面不一定是正圓，尤其是斜視角度下。橢圓擬合可以修正：

```python
from skimage.measure import EllipseModel

def ellipse_correction(trunk_contour, depth_map, focal_length):
    """用橢圓擬合修正非正圓的樹幹截面"""
    model = EllipseModel()
    model.estimate(trunk_contour)
    
    # 橢圓的長軸和短軸
    a, b = model.params[2], model.params[3]  # 半軸長
    
    # 如果觀察角度造成透視壓縮，用長軸作為直徑
    # 如果是真正的非圓截面，用等效直徑 D = 2√(ab)
    equivalent_diameter_px = 2 * np.sqrt(a * b)
    return equivalent_diameter_px
```

### 4.2 醫學影像量測

醫學影像（如超音波量測胎兒頭圍、血管直徑）的技術：

| 技術 | 量測對象 | 對 DBH 的借鑒 |
|------|---------|-------------|
| **U-Net 分割 + 輪廓擬合** | 血管直徑 | 分割後擬合圓/橢圓 |
| **Uncertainty Estimation** | 量測不確定度 | 提供可信區間而非單一值 |
| **Multi-scale 分析** | 不同解析度的測量 | 多解析度深度估計取平均 |

**可借鑒的 Uncertainty Estimation**：

```python
# 報告 DBH 時提供不確定度範圍
# 而非 "DBH = 25.3 cm"
# 改為 "DBH = 25.3 ± 1.8 cm (95% CI)"

def estimate_uncertainty(depth_values, pixel_width, focal_length):
    """估算量測不確定度"""
    depth_std = np.std(depth_values)
    depth_mean = np.mean(depth_values)
    
    # 誤差傳播: ΔD/D ≈ ΔZ/Z + Δw/w
    relative_depth_error = depth_std / depth_mean
    pixel_error = 1.0 / pixel_width  # ±1 pixel
    
    relative_total_error = np.sqrt(relative_depth_error**2 + pixel_error**2)
    dbh = pixel_width * depth_mean / focal_length * 100  # cm
    uncertainty = dbh * relative_total_error
    
    return dbh, uncertainty  # e.g., (25.3, 1.8)
```

### 4.3 自動駕駛的障礙物尺寸估計

自動駕駛系統估算前方車輛/行人尺寸的技術：

| 技術 | 對 DBH 的借鑒 |
|------|-------------|
| **多幀深度融合** | 連續幾張照片取中位數深度 |
| **Ground Plane 估計** | 使用深度圖自動找地面平面 → 確定胸高 |
| **3D Bounding Box** | 估算物體的 3D 尺寸 |
| **Consistency Check** | 多幀結果一致性驗證 |

---

## 5. 改進方案設計

### 5.1 升級後的四階段管線

```
┌─────────────────────────────────────────────────────────┐
│           手機拍攝 RGB 影像 (1-3 張)                      │
│      + EXIF (焦距 mm、手機型號)                           │
│      + 使用者觸碰點 (可選，自動模式不需要)                   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS via ngrok
                       ▼
┌══════════════════════════════════════════════════════════┐
║              MacBook ML Service (Server)                ║
║                                                         ║
║  ┌─────────────────┐   ┌──────────────────────┐        ║
║  │  Stage 1:       │   │  Stage 2:            │        ║
║  │  深度估計       │   │  樹幹分割            │        ║
║  │                 │   │                      │        ║
║  │  DA V2 Base     │   │  深度啟發式粗定位    │        ║
║  │  (97.5M)        │   │    ＋                 │        ║
║  │  or DA3Metric-L │   │  SAM 2.1 Tiny        │        ║
║  │  (350M)         │   │  (38.9M)             │        ║
║  │                 │   │  精確分割             │        ║
║  │  輸出:          │   │                      │        ║
║  │  公制深度圖 (m) │   │  輸出: 精確樹幹遮罩  │        ║
║  └────────┬────────┘   └──────────┬───────────┘        ║
║           │ (可並行)               │                    ║
║           └────────────┬───────────┘                    ║
║                        ▼                                ║
║  ┌─────────────────────────────────────────────┐       ║
║  │  Stage 3: 3D 分析 + 胸高定位                 │       ║
║  │                                              │       ║
║  │  • 深度圖 × 遮罩 → 樹幹區域 3D 點雲         │       ║
║  │  • RANSAC 地面平面擬合                       │       ║
║  │  • 1.3m 胸高位置自動定位                     │       ║
║  │  • 生長方向估計 (4 帶法)                     │       ║
║  │  • 多幀融合 (如有多張)                       │       ║
║  └─────────────────────┬───────────────────────┘       ║
║                        ▼                                ║
║  ┌─────────────────────────────────────────────┐       ║
║  │  Stage 4: 精密 DBH 計算                      │       ║
║  │                                              │       ║
║  │  • 亞像素邊緣偵測 → 像素寬度 (±0.2px)       │       ║
║  │  • 橢圓擬合修正 (非圓截面)                   │       ║
║  │  • 弦長 → 直徑 (圓柱幾何修正)               │       ║
║  │  • LUT 系統偏差修正                          │       ║
║  │  • 不確定度估算 → DBH ± CI                   │       ║
║  │  • 合理性檢查 (5-200 cm)                     │       ║
║  └─────────────────────┬───────────────────────┘       ║
║                        ▼                                ║
║  ┌─────────────────────────────────────────────┐       ║
║  │  輸出                                        │       ║
║  │  • DBH = XX.X ± Y.Y cm                      │       ║
║  │  • 信心度 0.XX                                │       ║
║  │  • 視覺化: 深度圖 + 遮罩 + 量測線            │       ║
║  │  • 元資料: 距離、焦距、模型版本               │       ║
║  └─────────────────────────────────────────────┘       ║
╚══════════════════════════════════════════════════════════╝
```

### 5.2 處理時間估算與速度優化 ⚡

#### 硬體實測規格

```
CPU:  Intel i7-3615QM (Ivy Bridge, 4C/8T, 2.3-3.3 GHz)
ISA:  SSE4.2, AVX (注意: 無 AVX2, AVX2 是 Haswell 第 4 代才有)
GPU:  Intel HD Graphics 4000 (1536MB 共享) — 不支援 MPS/CUDA
      NVIDIA GT 650M — macOS Sonoma 已停止支援 NVIDIA
RAM:  8 GB 1600 MHz DDR3
OS:   macOS Sonoma 14.8.2
```

#### 各模型 CPU 推論時間估算（PyTorch FP32, 8 threads）

| 模型 | 參數量 | 輸入解析度 | PyTorch 估計 | ONNX Runtime 估計 |
|------|--------|----------|-------------|------------------|
| DA V2 Small | 24.8M | 518×518 | ~1.5-2.5s | ~0.8-1.5s |
| **DA V2 Base** | **97.5M** | 518×518 | **~5-7s** | **~2.5-4s** |
| DA V2 Large | 335.3M | 518×518 | ~15-25s | ~8-15s |
| DA3Metric-Large | 350M | 518×518 | ~15-20s ⚠️ | 待測 |
| SAM 2.1 Tiny | 38.9M | 1024×1024 | ~3-5s | ~1.5-3s |
| SAM 2.1 Small | 46M | 1024×1024 | ~4-7s | ~2-4s |

> ⚠️ DA3 官方要求 CUDA + xformers，CPU 推論可能需要額外適配。

#### 完整管線時間（端到端：收到圖片 → 返回結果）

| 組合方案 | 深度 | 分割 | 後處理 | PyTorch 總計 | ONNX 總計 | 精度 |
|---------|------|------|--------|-------------|----------|------|
| **A: 現狀 (V1)** | DA V2 Small ~2s | 啟發式 ~0.3s | ~0.2s | **~2.5s** | ~1.5s | 基準 |
| **B: 快速升級** | DA V2 Base ~6s | 啟發式 ~0.3s | ~0.3s | **~6.5s** | ~3.5s | 深度 +15% |
| **C: 分割升級** | DA V2 Small ~2s | SAM Tiny ~4s | ~0.3s | **~6.3s** | ~3.5s | 分割 +40% |
| **D: 平衡方案 ⭐** | DA V2 Base ~6s | SAM Tiny ~4s | ~0.3s | **~10.3s** | **~5.5s** | 整體 +50% |
| **E: 極致精度** | DA3Metric-L ~18s | SAM Tiny ~4s | ~0.3s | ~22s | ~13s | 整體 +70% |
| **F: 方案 D + 降低解析度** | Base@384 ~3.5s | SAM@768 ~2.5s | ~0.3s | ~6.3s | **~3.5s** | 整體 +40% |

#### ⭐ 推薦方案: D + ONNX 優化 → 約 5-6 秒

這是 **精度與速度的最佳平衡點**：
- 深度模型從 Small→Base：深度誤差降低 ~15%
- SAM 分割取代啟發式：邊界精度提升 ~40%
- ONNX Runtime 加速：總時間從 ~10s 降至 ~5.5s
- 使用者體驗：拍照後等 5-6 秒看結果，完全可接受

#### 速度優化策略

##### 策略 1: ONNX Runtime 轉換（預期加速 1.5-2.5x）⭐ 最重要

ONNX Runtime 對 Intel CPU 有專門的 SSE/AVX 優化核心：

```python
# 從 PyTorch 轉 ONNX
from optimum.onnxruntime import ORTModel
model = ORTModel.from_pretrained("depth-anything/...", export=True)

# 或手動 ONNX 導出
import onnxruntime as ort
sess_options = ort.SessionOptions()
sess_options.intra_op_num_threads = 4  # 4 物理核心
sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
session = ort.InferenceSession("model.onnx", sess_options)
```

**對 i7-3615QM 的所有優化中，ONNX Runtime 是投入產出比最高的。**

##### 策略 2: 降低輸入解析度（加速 1.4-1.8x，微小精度損失）

```python
# DA V2 預設 518×518，改為 384×384
# 計算量: (384/518)^2 ≈ 0.55 → 減少 45% 計算
# 精度影響: 對大尺度物體(樹幹)影響很小 (<2%)
processor = AutoImageProcessor.from_pretrained(model_id, 
                                                size={"height": 384, "width": 384})
```

##### 策略 3: SAM 圖片編碼器預計算（節省重複請求時間）

SAM 2.1 架構: `image_encoder(慢) → prompt_encoder(快) → mask_decoder(快)`

```python
# 如果使用者需要多次標記同一張照片的不同樹
# 只需要跑一次 image_encoder
image_embedding = sam_encoder(image)  # ~3s，只做一次

# 之後每次新 prompt 只需 ~0.3s
mask1 = sam_decoder(image_embedding, point1)  # ~0.3s
mask2 = sam_decoder(image_embedding, point2)  # ~0.3s
```

##### 策略 4: 模型常駐 + 預熱（已實作）

當前已經做了 Singleton 模式，模型載入一次常駐記憶體。
補充：啟動時做一次 warmup 推論，避免首次請求特別慢。

```python
# 在 app.py 啟動時
with torch.no_grad():
    dummy = torch.randn(1, 3, 518, 518)
    model(dummy)  # warmup: 讓 PyTorch 完成 JIT 編譯
```

##### 策略 5: 靈活精度模式（讓使用者選擇）

提供 `/api/v1/measure-dbh?mode=fast` 和 `?mode=accurate`:

| 模式 | 深度模型 | 分割 | 總時間 | 用途 |
|------|---------|------|--------|------|
| `fast` | DA V2 Small + ONNX | 啟發式 | ~1.5s | 快速篩選、野外大量調查 |
| `balanced` | DA V2 Base + ONNX | SAM Tiny | ~5.5s | 常規使用 ⭐ |
| `accurate` | DA V2 Base + ONNX | SAM Tiny + 多帶 + 亞像素 | ~7s | 精確研究量測 |

#### 加速時間軸

```
V1 現狀:                    ~2.5s ████████
Phase 1 (Base 模型):        ~6.5s ████████████████████
Phase 1 + ONNX:             ~3.5s ██████████
Phase 2 (Base + SAM):      ~10.3s ██████████████████████████████
Phase 2 + ONNX:             ~5.5s ████████████████ ⭐ 推薦
Phase 2 + ONNX + 降解:     ~3.5s ██████████
```

### 5.3 各階段精度改善預期

| 改善項目 | V1 精度 | V2 預期精度 | 改善來源 |
|---------|---------|-----------|---------|
| 深度估計 | ±10-15% | ±5-8% | Base/Large 模型 |
| 樹幹邊界 | ±2-5 px | ±0.5-1 px | SAM 2.1 + 亞像素 |
| 胸高定位 | 手動瞄準 | 自動 RANSAC | 3D 重建 |
| 圓柱修正 | 無 | 弦→直徑公式 | Xiang et al. |
| 不確定度 | 無 | ±CI 報告 | 誤差傳播 |
| **整體 RMSE** | **3-5 cm** | **1.5-3 cm** | — |

### 5.4 記憶體規劃

8GB RAM 需要仔細規劃：

| 組件 | FP32 大小 | FP16 大小 | 推薦 |
|------|----------|----------|------|
| OS + Python + FastAPI | — | — | ~1.5 GB |
| DA V2 Base model | ~390 MB | ~195 MB | FP32 |
| SAM 2.1 Tiny | ~156 MB | ~78 MB | FP32 |
| 推論用暫存記憶體 | ~800 MB | ~500 MB | — |
| **總計** | | | **~2.8 GB** ✅ |
| 如用 DA3Metric-Large | ~1.4 GB | ~700 MB | FP32 |
| **總計 (DA3)** | | | **~3.9 GB** ✅ |

結論：兩個模型都能在 8GB RAM 中共存。

---

## 6. 實作優先順序

### Phase 1: 深度模型升級 (1-2 天)

- [ ] 將 `depth_estimation.py` 的模型從 Small 升級到 **Base**
- [ ] 調整 `build.sh` 和 requirements.txt
- [ ] 基準測試：Base vs Small 在同一組測試照片上的精度
- [ ] 確認推論時間在可接受範圍 (~3s)

### Phase 2: SAM 2.1 分割整合 (2-3 天)

- [ ] 安裝 SAM 2.1 (pip install sam2)
- [ ] 新增 `tree_segmentation_sam.py` — SAM 2.1 分割服務
- [ ] 設計混合策略：深度粗定位 + SAM 精修
- [ ] 新增 API endpoint 支援使用者觸碰點 prompt
- [ ] 與現有深度啟發式方案做 A/B 比較

### Phase 3: 精密計算升級 (1-2 天)

- [ ] 實作亞像素邊緣偵測
- [ ] 實作橢圓擬合修正
- [ ] 加入不確定度估算 (DBH ± CI)
- [ ] 圓柱幾何修正 (Xiang et al. 公式)
- [ ] 3D 地面平面 RANSAC 自動胸高偵測

### Phase 4: DA3 / MetricAnything 試驗 (2-3 天)

- [ ] 安裝 DA3，測試 DA3Metric-Large
- [ ] 比較 DA3 vs DA V2 Base 在樹木場景的精度
- [ ] 評估 MetricAnything Student-PointMap 的可行性
- [ ] 決定是否切換主模型

### Phase 5: 多幀融合 + 前端引導 (2-3 天)

- [ ] 設計要求使用者連拍 3 張的 UX 流程
- [ ] 後端多幀中位數融合
- [ ] 前端拍攝引導 UI（距離、角度提示）
- [ ] 端到端精度驗證 (50+ 棵樹)

---

## 7. 參考文獻

### 深度估計（新增）

1. **Lin, H. et al.** (2025). "Depth Anything 3: Recovering the Visual Space from Any Views." arXiv:2511.10647. [GitHub (Apache-2.0)](https://github.com/ByteDance-Seed/depth-anything-3)

2. **Ma, B. et al.** (2026). "MetricAnything: Scaling Metric Depth Pretraining with Noisy Heterogeneous Sources." arXiv:2601.22054. [GitHub (Apache-2.0)](https://github.com/metric-anything/metric-anything)

### 分割模型（新增）

3. **Ravi, N. et al.** (2024). "SAM 2: Segment Anything in Images and Videos." arXiv:2408.00714. [GitHub (Apache-2.0)](https://github.com/facebookresearch/sam2)

4. **Ultralytics** (2026). "YOLO26: State-of-the-Art Object Detection, Segmentation, and Pose Estimation." [GitHub (AGPL-3.0)](https://github.com/ultralytics/ultralytics)

5. **Sapkota, R. & Karkee, M.** (2024). "Integrating YOLO11 and Convolution Block Attention Module for Multi-Season Segmentation of Tree Trunks and Branches in Commercial Apple Orchards." arXiv:2412.05728.

6. **Khan, A. et al.** (2024). "Accurate and Efficient Urban Street Tree Inventory with Deep Learning on Mobile Phone Imagery." arXiv:2401.01180.

### 沿用 V1 的核心論文

7. **Yang, L. et al.** (2024). "Depth Anything V2." NeurIPS 2024. [GitHub (Apache-2.0)](https://github.com/DepthAnything/Depth-Anything-V2)

8. **Holcomb, A. et al.** (2023). "Robust Single-Image Tree Diameter Estimation with Mobile Phones." arXiv:2305.09544.

9. **Xiang, Y. et al.** (2025). "Single Shot High-Accuracy DBH Measurement with Smartphone Embedded Sensors." Sensors, 25(16), 5060.

10. **Wu, X. et al.** (2026). "YOLO11s Instance Segmentation + Monocular RGB Camera for Non-Fixed Distance Rubber Tree Diameter Measurement." Computers and Electronics in Agriculture.

11. **Jia, J. et al.** (2025). "A Comprehensive Evaluation of Monocular Depth Estimation Methods in Low-Altitude Forest Environment." Remote Sensing, 17(4), 717.

12. **Yin, W. et al.** (2024). "Metric3D v2: Towards Zero-Shot Metric 3D Prediction from A Single Image." TPAMI 2024.

---

## 附錄 A: 模型安裝指令

### DA V2 Metric Outdoor Base

```bash
# 使用 HuggingFace transformers (已安裝)
# 只需改 MODEL_ID
pip install transformers torch
# model_id = "depth-anything/Depth-Anything-V2-Metric-Outdoor-Base-hf"
```

### SAM 2.1

```bash
# SAM 2 需要 Python >= 3.10, PyTorch >= 2.5.1
pip install sam2
# 或從 source:
git clone https://github.com/facebookresearch/sam2.git
cd sam2 && pip install -e .
# 下載 checkpoint:
cd checkpoints && ./download_ckpts.sh
```

### DA3Metric-Large

```bash
pip install xformers torch torchvision
pip install depth-anything-3
# 使用:
from depth_anything_3.api import DepthAnything3
model = DepthAnything3.from_pretrained("depth-anything/DA3METRIC-LARGE")
```

---

*最後更新: 2026-02-17*  
*作者: TreeAI 開發團隊*
