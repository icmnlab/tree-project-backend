# 純視覺 DBH 測量技術研究報告

## Pure Vision DBH Measurement Technical Research Report

**版本**: 1.0  
**日期**: 2025-07  
**專案**: Sustainable TreeAI — TIPC 樹木管理系統  
**目標**: 基於單目 RGB 影像的純視覺胸徑 (DBH) 自動測量方案

---

## 目錄

1. [研究背景與目標](#1-研究背景與目標)
2. [文獻回顧與關鍵論文](#2-文獻回顧與關鍵論文)
3. [核心技術選型](#3-核心技術選型)
4. [數學公式推導](#4-數學公式推導)
5. [系統架構設計](#5-系統架構設計)
6. [模型比較與基準測試](#6-模型比較與基準測試)
7. [行動端部署方案](#7-行動端部署方案)
8. [預期精度分析](#8-預期精度分析)
9. [實作路線圖](#9-實作路線圖)
10. [參考文獻](#10-參考文獻)

---

## 1. 研究背景與目標

### 1.1 問題定義

胸徑 (Diameter at Breast Height, DBH) 是林木測量最重要的基本指標之一，定義為距地面 **1.3 公尺** (或 1.4 公尺，依標準而異) 處的樹幹直徑。傳統測量需要使用皮尺或卡鉗等工具直接接觸樹幹，效率低下且在大規模調查中成本高昂。

### 1.2 設計約束

| 約束條件 | 描述 |
|---------|------|
| **僅使用 RGB 相機** | 不依賴 LiDAR、ToF 深度感測器或任何額外硬體 |
| **不使用參照物** | 使用者無需放置已知尺寸的物體作為比例尺 |
| **不依賴感測器** | 不使用加速度計、陀螺儀等感測器計算幾何關係 |
| **行動端即時推論** | 模型需能在手機端 (Android/iOS) 即時執行 |
| **單張照片** | 從一張 RGB 照片即可估算 DBH |
| **精度目標** | 目標 RMSE < 3 cm，可接受 < 5 cm |

### 1.3 核心理念：Tesla 式純視覺

受 Tesla 自動駕駛捨棄 LiDAR、完全依賴視覺神經網路的啟發，我們採用 **單目深度估計 (Monocular Metric Depth Estimation)** 技術，讓神經網路直接從 RGB 影像預測每個像素的公制深度 (單位：公尺)，替代傳統深度感測器。

---

## 2. 文獻回顧與關鍵論文

### 2.1 直接相關論文

#### Paper 1: Holcomb et al. (2023) — 開創性單影像 DBH 測量

- **標題**: "Robust Single-Image Tree Diameter Estimation with Mobile Phones"
- **作者**: Amelia Holcomb et al.
- **發表**: arXiv:2305.09544
- **開源**: [github.com/ameliaholcomb/trees](https://github.com/ameliaholcomb/trees) (MIT License)
- **方法**: 利用手機深度感測器 (ToF/LiDAR) + RGB 相機，結合景深值與像素寬度計算直徑
- **核心公式**: $D_m = \frac{d_p \cdot \delta_m}{\gamma_p} - \frac{d_p}{4}$
- **精度**: RMSE = 3.7 cm, R² = 0.97
- **限制**: 需要深度感測器硬體
- **對我們的價值**: 提供了完整的數學框架，我們將深度感測器替換為神經網路深度估計

#### Paper 2: Xiang et al. (2025) — 最高精度單拍 DBH

- **標題**: "Single Shot High-Accuracy DBH Measurement with Smartphone Embedded Sensors"
- **發表**: MDPI Sensors, 25(16), 5060. doi:10.3390/s25165060
- **開源**: [Zenodo doi:10.5281/zenodo.10650629](https://doi.org/10.5281/zenodo.10650629) (CC BY License)
- **方法**: iPhone 13 Pro LiDAR + RGB, SAM 分割, 圓柱幾何修正, LUT 修正
- **精度**: **MAE = 0.53 cm, RMSE = 0.63 cm**, R² = 0.9988 (294 棵樹, 15-95 cm DBH)
- **關鍵創新**:
  - 生長方向估計 (4 條水平帶 h⊥ ∈ [1.0m, 1.8m])
  - 地面平面擬合確定胸高位置
  - 圓柱幾何修正 (弦深 → 直徑)
  - 預計算查找表 (LUT) 修正系統偏差
- **限制**: 需要 iPhone LiDAR
- **對我們的價值**: 提供了最完整的幾何修正演算法，可直接沿用其圓柱修正和地面平面擬合方法

#### Paper 3: Wu et al. (2026) — 純 RGB 單目視覺 DBH

- **標題**: "YOLO11s Instance Segmentation + Monocular RGB Camera for Non-Fixed Distance Rubber Tree Diameter Measurement"
- **發表**: Computers and Electronics in Agriculture (ScienceDirect: S0168169925014784)
- **方法**: YOLO11s 實例分割 + 單目 RGB 相機，非固定距離
- **對我們的價值**: **最接近我們目標的方案** — 純 RGB、非固定距離、使用實例分割

#### Paper 4: Xuan et al. (2025) — 深度學習 + 智慧型手機 DBH

- **標題**: "Deep Learning Combined with Smartphone for Intelligent Estimation of DBH and AGB in Urban Forests"
- **對我們的價值**: 驗證了智慧型手機 + 深度學習在城市林木場景的可行性

### 2.2 單目深度估計核心論文

#### Paper 5: Depth Anything V2 (2024) — 推薦首選模型

- **標題**: "Depth Anything V2"
- **作者**: Yang et al.
- **發表**: NeurIPS 2024
- **開源**: [github.com/DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2) (Apache-2.0)
- **模型**: DPT + DINOv2 backbone
- **公制版本**: Depth-Anything-V2-Metric-Outdoor-Small
  - 參數量: **24.8M** (F32)
  - 訓練數據: Virtual KITTI (戶外場景)
  - HuggingFace: `depth-anything/Depth-Anything-V2-Metric-Outdoor-Small`
  - 下載量: 1,683/月
- **行動端部署**: NCNN (Android), Core ML (iOS) 已有社群 demo
- **森林評估結果** (Jia et al. 2025):
  - Mid-Air 資料集：RMSE 最佳，Abs Rel 最佳，色彩映射最接近真實深度
  - LOBDM-Forest：與 Metric3D 表現相當
  - 相比 CNN 模型 (Adabins)：**RMSE 改善 54.2%**

#### Paper 6: Metric3D v2 (2023/2024) — 備選強力方案

- **標題**: "Metric3D: Towards Zero-Shot Metric 3D Prediction from A Single Image" / "Metric3D v2"
- **作者**: Yin et al.
- **發表**: ICCV 2023 + TPAMI 2024
- **開源**: [github.com/YvanYin/Metric3D](https://github.com/YvanYin/Metric3D) (BSD-2-Clause, 2.1K stars)
- **模型變體**: ViT-Small, ViT-Large, ViT-giant2, ConvNeXt-Tiny/Large
- **關鍵特性**:
  - **同時輸出深度圖和表面法向量** → 法向量可用於地面平面檢測
  - Canonical Camera Space Transformation — 處理不同相機參數的差異
  - ONNX 支援 (動態形狀)
  - PyTorch Hub 支援 (3 行程式碼即可使用)
- **基準測試** (KITTI):
  - δ₁ = 0.985 (vs Depth Anything 0.982)
  - 在 LOBDM-Forest 近距離樹木細節上表現最佳
- **森林評估結果** (Jia et al. 2025):
  - **深度邊界精度最佳** — 邊界完整性誤差 5.494 (vs MiDas 93.361)
  - 能捕捉樹幹、枝幹之間的精細深度不連續
  - 但傾向**低估**前景深度值
- **限制**: 需要提供正確的焦距才能獲得準確的公制深度

#### Paper 7: ZoeDepth (2023)

- **標題**: "ZoeDepth: Zero-Shot Transfer by Combining Relative and Metric Depth"
- **作者**: Bhat et al.
- **發表**: arXiv:2302.12288
- **方法**: 兩階段框架 — 先學習相對深度，再通過 metric bins 模組轉換為公制深度
- **backbone**: BEiT384-L (最佳配置)
- **價值**: 零射學習能力強，但模型較大

### 2.3 森林環境深度估計評估

#### Paper 8: Jia et al. (2025) — 森林環境深度估計綜合評估 ⭐ 關鍵論文

- **標題**: "A Comprehensive Evaluation of Monocular Depth Estimation Methods in Low-Altitude Forest Environment"
- **發表**: Remote Sensing, 17(4), 717. doi:10.3390/rs17040717
- **評估模型**: MiDas, Adabins, GLP, **DepthAnything**, **Metric3D**, DPT, ZoeDepth
- **評估資料集**:
  - **Mid-Air**: 大範圍森林場景 (0-100m 深度)
  - **LOBDM-Forest (Synthetic)**: 近距離樹木細節 (0-10m)
  - **Low-Viewpoint Forest / LOBDM-Forest (Real)**: 真實森林場景
- **核心結論**:

| 指標類型 | 最佳模型 | 說明 |
|---------|---------|------|
| 整體 RMSE | **DepthAnything** | Mid-Air 資料集全面領先 |
| 整體 RMSE (近距離) | **Metric3D** | LOBDM-Forest 資料集最佳 |
| 深度邊界精度 | **Metric3D** | 邊界完整性誤差僅 5.494 |
| 深度邊界完整性 | **Metric3D** | 最能捕捉樹幹/枝幹邊界 |
| 方向深度誤差 | **DepthAnything** | 過估/低估比例最低 |
| 真實森林場景 | **DepthAnything & Metric3D** | 兩者均優於 CNN 模型 |

- **關鍵發現**:
  1. Transformer 架構 (DepthAnything, Metric3D) 全面優於 CNN 架構 (MiDas, Adabins)
  2. DepthAnything 在大範圍深度場景中最準確
  3. Metric3D 在近距離樹木細節和邊界精度上最佳
  4. Metric3D 有深度低估傾向 (前景區域)
  5. 所有模型在暗影區域 (dimly shaded areas) 表現較差

### 2.4 其他相關方案 (已調研但非首選)

| 論文/專案 | 年份 | 方法 | 為何非首選 |
|----------|------|------|-----------|
| UniDepthV2 | 2025 | 通用度量深度 (65 引用) | 模型較大，行動端部署待驗證 |
| Depth Any Camera (DAC) | CVPR 2025 | 任意相機零射度量深度 | 太新，23 引用，生態系統不成熟 |
| OrchardDepth | 2025 | 果園/農業場景深度 | 專門領域，可作為未來微調參考 |
| MODepth | SIGGRAPH Asia 2025 | 行動多幀單目深度 | 多幀方案，增加複雜度 |
| ForestScanner | — | iOS LiDAR 掃描 | 需要 LiDAR 硬體 |

---

## 3. 核心技術選型

### 3.1 推薦方案：Depth Anything V2 Metric Outdoor Small

**選擇理由**:

| 因素 | Depth Anything V2 | Metric3D v2 | 選擇原因 |
|------|-------------------|-------------|---------|
| 模型大小 | **24.8M** (Small) | ~25M (ViT-S) | 相當 |
| 授權 | Apache-2.0 | BSD-2-Clause | 兩者均商用友善 |
| 行動端部署 | **NCNN + Core ML demo** | ONNX 支援 | DA V2 部署更成熟 |
| 森林 RMSE (大範圍) | **最佳** | 有低估傾向 | DA V2 |
| 森林邊界精度 | 優秀 | **最佳** | Metric3D |
| 深度值穩定性 | **穩定** | 前景低估 | DA V2 |
| 焦距依賴 | 內建校準 | **必須提供** | DA V2 |
| HuggingFace 生態 | ✅ transformers 整合 | ✅ PyTorch Hub | 兩者均方便 |
| 整體推薦 | ⭐ **首選** | 備選方案 | — |

**決定**: 使用 **Depth Anything V2 Metric Outdoor Small** 作為主要深度估計模型

**備註**: 如果未來需要表面法向量 (surface normals) 進行地面平面擬合，可考慮切換至 Metric3D v2 或混合使用

### 3.2 樹幹分割模型選擇

| 模型 | 參數量 | 速度 (mobile) | 分割精度 | 推薦 |
|------|--------|-------------|---------|------|
| YOLO v8n-seg | 3.4M | ~30 FPS | 良好 | ✅ 首選 |
| YOLO v11s-seg | ~10M | ~15 FPS | 更佳 | 備選 |
| MobileSAM | ~10M | ~5 FPS | 最佳 | 精度優先 |
| SAM (ViT-H) | 636M | <1 FPS | 頂級 | 僅伺服器端 |

**決定**: 使用 **YOLOv8n-seg** (行動端首選) 或 **YOLO v11s-seg** (精度優先)

需要針對樹幹進行 **自定義訓練**:
- 資料集: 使用 COCO 預訓練 + 樹幹影像微調
- 類別: `tree_trunk` (樹幹)
- 建議訓練影像: 500-1000 張標註過的樹幹照片

---

## 4. 數學公式推導

### 4.1 相機內參模型 (Pinhole Camera Model)

$$
\begin{bmatrix} u \\ v \\ 1 \end{bmatrix} = \frac{1}{Z} \begin{bmatrix} f_x & 0 & c_x \\ 0 & f_y & c_y \\ 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} X \\ Y \\ Z \end{bmatrix}
$$

其中:
- $(u, v)$: 像素座標
- $(X, Y, Z)$: 世界座標 (公尺)
- $f_x, f_y$: 焦距 (像素)
- $(c_x, c_y)$: 主點 (影像中心)

### 4.2 像素到公制寬度轉換

給定深度估計值 $Z$ (公尺) 和像素寬度 $w_{px}$ (像素):

$$
w_{m} = \frac{w_{px} \cdot Z}{f_x}
$$

其中:
- $w_m$: 物體實際寬度 (公尺)
- $w_{px}$: 影像中物體的像素寬度
- $Z$: 神經網路估計的深度值 (公尺)
- $f_x$: 水平焦距 (像素)

### 4.3 焦距估計

手機相機焦距可透過以下方式取得:

**方法 A: 從 EXIF 取得 (推薦)**

$$
f_{px} = \frac{f_{mm} \cdot W_{px}}{W_{sensor}}
$$

其中:
- $f_{mm}$: EXIF 中的焦距 (毫米)
- $W_{px}$: 影像寬度 (像素)
- $W_{sensor}$: 感測器實際寬度 (毫米)

**方法 B: 從 FOV 計算**

$$
f_{px} = \frac{W_{px}}{2 \tan(\theta/2)}
$$

其中 $\theta$ 為水平視場角 (Field of View)

**方法 C: Flutter 相機 API**

```dart
// Flutter camera package 可直接取得焦距
final cameras = await availableCameras();
final camera = cameras.first;
// 透過 CameraDescription 取得 sensorOrientation 等資訊
// 再結合 EXIF 資料計算精確焦距
```

### 4.4 弦長公式 (Chord Length Formula)

樹幹是圓柱體，相機看到的是弦 (chord)，不是直徑。弦長計算:

$$
l = \frac{p \cdot N_{BH}}{f}
$$

其中:
- $l$: 胸高處的弦長 (公尺)
- $p$: 每像素對應的深度增量
- $N_{BH}$: 胸高處樹幹的像素寬度
- $f$: 焦距 (像素)

### 4.5 圓柱幾何修正 (Cylindrical Geometry Correction) ⭐

**核心認知**: 相機看到的樹幹寬度是一個弦 (chord)，而非真實直徑。弦長總是 ≤ 直徑。

#### 4.5.1 弦長到直徑的轉換

根據 Xiang et al. (2025) 的圓柱幾何模型:

$$
d = \frac{l \cdot p}{\sqrt{p^2 - l^2/4}}
$$

其中:
- $d$: 圓柱直徑 (公尺)
- $l$: 弦長 (公尺)
- $p$: 相機到弦面的距離 (公尺)

#### 4.5.2 簡化近似 (適用於遠距離)

當相機距離遠大於樹幹直徑時 ($p >> d$):

$$
d \approx l \cdot \left(1 + \frac{l^2}{8p^2}\right)
$$

此近似在 $p/d > 5$ 時誤差 < 1%

#### 4.5.3 平均弦深修正 (Average Chord Depth Correction)

Xiang et al. 使用預計算查找表 (LUT) 修正因弦深度不等於圓心深度造成的系統偏差:

**LUT 預計算參數**:
- $m_1 = 996$ 個弦位置取樣
- 每個弦位置 $n_1 = 4996$ 個距離取樣
- 在 $D/d \in [0.5, 100]$ 範圍內建立映射

**修正公式**:
$$
d_{corrected} = LUT(d_{raw}, p)
$$

### 4.6 地面平面擬合 (Ground Plane Fitting)

用於確定影像中 1.3m 高度 (胸高) 的位置。

#### 4.6.1 地面平面方程

$$
A_g \cdot x_w + B_g \cdot y_w + C_g \cdot z_w + D_g = 0
$$

其中 $(A_g, B_g, C_g)$ 為地面法向量，$D_g$ 為偏移量。

#### 4.6.2 從深度圖重建 3D 點雲

將深度圖像素 $(u, v)$ 反投影到 3D 空間:

$$
\begin{cases}
X = \frac{(u - c_x) \cdot Z}{f_x} \\
Y = \frac{(v - c_y) \cdot Z}{f_y} \\
Z = depth(u, v)
\end{cases}
$$

#### 4.6.3 胸高位置確定

1. 使用 RANSAC 或最小二乘法擬合地面平面
2. 計算垂直於地面法向量方向的 1.3m 高度
3. 找到該高度在影像中對應的像素行

$$
h_{BH} = h_{ground} + 1.3 \text{ m} \cdot \hat{n}_{up}
$$

其中 $\hat{n}_{up}$ 為向上的單位法向量。

### 4.7 生長方向估計 (Growth Orientation Estimation)

樹幹不一定垂直生長。Xiang et al. 的方法:

1. 在 $h_\perp \in [1.0m, 1.8m]$ 範圍內取 4 條等距水平帶
2. 對每條帶提取樹幹中心像素的 3D 座標
3. 用最小二乘法擬合一條 3D 直線作為生長方向
4. 將測量平面旋轉至垂直於生長方向

### 4.8 完整 DBH 計算流程

```
輸入: RGB 影像 I, 相機焦距 f
輸出: DBH 值 (cm)

1. depth_map = DepthAnythingV2(I)           // 深度估計
2. mask = YOLOv8_seg(I, class="tree_trunk")  // 樹幹分割
3. point_cloud = backproject(depth_map, f)    // 3D 重建
4. ground_plane = RANSAC(point_cloud[ground]) // 地面擬合
5. h_BH = ground_plane + 1.3m               // 胸高位置
6. trunk_pixels = mask ∩ row(h_BH)           // 胸高處樹幹像素
7. w_px = width(trunk_pixels)                // 像素寬度
8. Z_BH = mean(depth_map[trunk_pixels])      // 胸高處深度
9. chord = w_px * Z_BH / f                   // 弦長計算
10. DBH = cylindrical_correction(chord, Z_BH) // 圓柱修正
11. return DBH * 100                          // 轉換為 cm
```

---

## 5. 系統架構設計

### 5.1 四階段管線 (Four-Stage Pipeline)

```
┌─────────────────────────────────────────────────────┐
│                    拍攝 RGB 影像                      │
│                   (手機主鏡頭)                        │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────┐   ┌──────────────────────┐
│  Stage 1:        │   │  Stage 2:            │
│  深度估計        │   │  樹幹分割            │
│                  │   │                      │
│  Depth Anything  │   │  YOLOv8n-seg         │
│  V2 Metric       │   │  (tree_trunk class)  │
│  Outdoor Small   │   │                      │
│  (24.8M params)  │   │  輸出: 樹幹遮罩      │
│                  │   │  + 邊界框             │
│  輸出: 公制      │   │                      │
│  深度圖 (m)      │   │                      │
└────────┬─────────┘   └──────────┬───────────┘
         │                        │
         └────────────┬───────────┘
                      ▼
         ┌────────────────────────┐
         │  Stage 3:              │
         │  3D 重建 + 胸高定位    │
         │                        │
         │  • 深度圖 → 3D 點雲    │
         │  • 地面平面 RANSAC     │
         │  • 1.3m 胸高線確定     │
         │  • 生長方向估計        │
         └────────────┬───────────┘
                      ▼
         ┌────────────────────────┐
         │  Stage 4:              │
         │  DBH 計算              │
         │                        │
         │  • 胸高處像素寬度      │
         │  • 弦長計算            │
         │  • 圓柱幾何修正        │
         │  • LUT 偏差修正        │
         │  • 信心分數計算        │
         └────────────┬───────────┘
                      ▼
         ┌────────────────────────┐
         │  輸出結果              │
         │                        │
         │  DBH = XX.X cm         │
         │  信心度 = 0.XX         │
         │  視覺化: 深度圖疊加    │
         └────────────────────────┘
```

### 5.2 信心分數計算

信心分數 (confidence) 綜合多個因素:

$$
C = w_1 \cdot C_{seg} + w_2 \cdot C_{depth} + w_3 \cdot C_{geo} + w_4 \cdot C_{dist}
$$

| 因素 | 權重 | 計算方式 |
|------|------|---------|
| $C_{seg}$ 分割信心 | 0.3 | YOLO 分割的 IoU/confidence |
| $C_{depth}$ 深度一致性 | 0.3 | 樹幹區域深度值標準差的倒數 |
| $C_{geo}$ 幾何合理性 | 0.2 | 計算出的 DBH 是否在合理範圍 (5-150 cm) |
| $C_{dist}$ 拍攝距離 | 0.2 | 距離 1-3m 最佳，過遠/過近降低信心 |

### 5.3 簡化版 (Phase 1 實作)

初期可先不做完整的 3D 重建，使用簡化流程:

```
1. depth_map = DepthAnythingV2(image)
2. trunk_mask = YOLOv8_seg(image)
3. Z_trunk = median(depth_map[trunk_mask])     // 樹幹中位深度
4. w_px = horizontal_width(trunk_mask, center)  // 遮罩中心寬度
5. w_m = w_px * Z_trunk / focal_length         // 公制寬度
6. DBH = w_m * 100                              // cm
```

此簡化版忽略:
- 圓柱幾何修正 (在 $p/d > 10$ 時誤差 < 0.3%)
- 精確胸高定位 (假設使用者瞄準胸高)
- 生長方向修正 (假設樹幹近似垂直)

**預期精度**: RMSE ≈ 3-5 cm (比完整版略差，但實作複雜度大幅降低)

---

## 6. 模型比較與基準測試

### 6.1 森林環境深度估計基準 (Jia et al. 2025)

#### Mid-Air 資料集 (大範圍森林, 0-100m)

| 模型 | 類型 | RMSE ↓ | Abs Rel ↓ | δ₁ ↑ | 邊界精度 ↓ |
|------|------|--------|-----------|------|----------|
| **DepthAnything** | Transformer | **最佳** | **最佳** | 最佳 | 優秀 |
| **Metric3D** | Transformer | 良 | 良 | 34.6% | **最佳** |
| ZoeDepth | Transformer | 良 | 良 | 良 | 良 |
| DPT | Transformer | 中 | 中 | 中 | 中 |
| MiDas | CNN | 差 | 差 | 差 | 差 |
| GLP | Transformer | 中 | 中 | 中 | 中 |
| Adabins | CNN | **最差** | **最差** | 最差 | 最差 |

#### LOBDM-Forest 資料集 (近距離樹木, 0-10m) ⭐ 與 DBH 測量場景最接近

| 模型 | RMSE ↓ | d2 ↑ | d3 ↑ | 邊界完整性 ↓ |
|------|--------|------|------|------------|
| **Metric3D** | **最佳** | **最佳** | **最佳** | **5.494** |
| **DepthAnything** | 次佳 | 次佳 | 次佳 | 優秀 |
| ZoeDepth | 中 | 中 | 中 | 中 |
| MiDas | 差 | 差 | 差 | **93.361** |

**關鍵洞察**: 在與 DBH 測量最相似的近距離樹木場景 (LOBDM-Forest) 中，**Metric3D 表現最佳**，但 DepthAnything 非常接近且更穩定。

### 6.2 標準基準測試 (KITTI / NYU)

| 模型 | KITTI δ₁ ↑ | KITTI RMSE ↓ | NYU δ₁ ↑ | 參數量 |
|------|-----------|-------------|---------|--------|
| Metric3D v2 (ViT-S) | **0.985** | — | — | ~25M |
| Depth Anything V2 (S) | 0.982 | — | — | 24.8M |
| ZoeDepth | 0.971 | — | 0.955 | ~300M |
| MiDas v3.1 | 0.960 | — | 0.935 | ~100M |

### 6.3 行動端推論速度估計

| 模型 | 參數量 | 格式 | Android (Snapdragon 8 Gen2) | iOS (A16) |
|------|--------|------|---------------------------|-----------|
| DA V2 Small (NCNN) | 24.8M | FP16 | **~150ms** (~7 FPS) | — |
| DA V2 Small (CoreML) | 24.8M | FP16 | — | **~100ms** (~10 FPS) |
| YOLOv8n-seg (NCNN) | 3.4M | FP16 | ~30ms (~33 FPS) | ~20ms |
| 總計 (深度+分割) | 28.2M | — | **~180ms** (~5.5 FPS) | **~120ms** (~8 FPS) |

---

## 7. 行動端部署方案

### 7.1 Android 部署 (NCNN)

**NCNN** (Tencent) 是最成熟的行動端神經網路推論框架:

- **現有 demo**: [nihui/ncnn-android-depth_anything](https://github.com/nickyc975/ncnn-android-depth_anything)
- **FP16 加速**: Vulkan GPU 加速
- **Flutter 整合**: 透過 Platform Channel 或 FFI 呼叫 C++ NCNN

```
Flutter App
    │
    ├── Dart UI Layer
    │
    ├── Platform Channel (MethodChannel)
    │
    └── Native Android (Kotlin/C++)
        ├── NCNN Runtime
        ├── Depth Anything V2 Small (.param + .bin)
        └── YOLOv8n-seg (.param + .bin)
```

### 7.2 iOS 部署 (Core ML)

- **Core ML** 原生支援，Apple Neural Engine (ANE) 加速
- **轉換流程**: PyTorch → ONNX → Core ML (.mlmodel / .mlpackage)
- **Flutter 整合**: Platform Channel 呼叫 Swift Core ML API

```
Flutter App
    │
    ├── Dart UI Layer
    │
    ├── Platform Channel (MethodChannel)
    │
    └── Native iOS (Swift)
        ├── Core ML / Vision Framework
        ├── Depth Anything V2 Small (.mlpackage)
        └── YOLOv8n-seg (.mlpackage)
```

### 7.3 跨平台替代方案

| 方案 | 優點 | 缺點 |
|------|------|------|
| ONNX Runtime Mobile | 跨平台統一 | 速度略慢 |
| TensorFlow Lite | 生態豐富 | 模型轉換可能有問題 |
| MediaPipe | Google 支援 | 自定義模型限制 |
| **NCNN + Core ML** | **最佳效能** | 需分平台實作 |

**推薦**: 使用 NCNN (Android) + Core ML (iOS) 雙平台方案，透過 Flutter Platform Channel 統一 API

### 7.4 模型檔案大小

| 模型 | FP32 | FP16 | INT8 |
|------|------|------|------|
| DA V2 Metric Outdoor Small | ~100 MB | **~50 MB** | ~25 MB |
| YOLOv8n-seg | ~14 MB | **~7 MB** | ~4 MB |
| **總計** | ~114 MB | **~57 MB** | ~29 MB |

建議使用 FP16 量化，在精度損失極小的情況下節省一半空間。

---

## 8. 預期精度分析

### 8.1 誤差來源分析

| 誤差來源 | 預期影響 | 緩解措施 |
|---------|---------|---------|
| 深度估計誤差 | ±5-15% | 多點取中位數，距離校準 |
| 樹幹分割邊界 | ±2-5 px | 邊緣精修，亞像素精度 |
| 焦距不精確 | ±2-5% | EXIF 讀取 + 校準 |
| 非圓柱形樹幹 | 依樹種 | 多角度拍攝，橢圓擬合 |
| 胸高位置偏差 | ±10-20 cm | 地面平面擬合 + 引導 UI |
| 遮擋 (草/枝) | 可變 | 分割模型過濾 |
| 光線條件 | 陰天最佳 | UI 提示最佳拍攝條件 |

### 8.2 精度估算

**基於相關論文的精度分析**:

| 方法 | DBH RMSE | 深度來源 | 距離 |
|------|---------|---------|------|
| Holcomb et al. (ToF) | 3.7 cm | ToF 深度感測器 | 1-5m |
| Xiang et al. (LiDAR) | **0.63 cm** | iPhone LiDAR | 0.25-5m |
| Wu et al. (RGB only) | 待確認 | 單目 RGB | 可變 |
| **我們的方案 (預期)** | **2-5 cm** | Depth Anything V2 | 1-4m |

**精度預期**:
- **最佳場景** (清晰、無遮擋、1-3m 距離): RMSE ≈ 2-3 cm
- **一般場景** (輕微遮擋、2-4m 距離): RMSE ≈ 3-5 cm
- **困難場景** (遮擋多、光線差): RMSE ≈ 5-8 cm

### 8.3 深度估計精度對 DBH 的影響

假設:
- 樹幹直徑 30 cm
- 拍攝距離 2 m
- 焦距 3000 px
- 樹幹像素寬度 ≈ 225 px

$$
\frac{\Delta DBH}{DBH} \approx \frac{\Delta Z}{Z} + \frac{\Delta w_{px}}{w_{px}}
$$

| 深度誤差 | 分割誤差 | DBH 誤差 |
|---------|---------|---------|
| 5% (10 cm) | 2 px | ~1.8 cm |
| 10% (20 cm) | 3 px | ~3.4 cm |
| 15% (30 cm) | 5 px | ~5.2 cm |

**結論**: 需要將深度誤差控制在 10% 以內才能達到 RMSE < 5 cm 的目標。

### 8.4 最佳拍攝條件建議

為達到最佳精度，建議 UI 引導使用者:

1. **距離**: 1-3 公尺 (最佳精度範圍)
2. **角度**: 正面垂直於樹幹
3. **高度**: 手持手機水平對準胸高位置
4. **光線**: 均勻光線，避免強烈背光
5. **背景**: 簡單背景，避免多棵樹重疊
6. **清晰度**: 確保影像清晰，無動態模糊

---

## 9. 實作路線圖

### Phase 1: MVP (最小可行產品) — 預計 3-4 週

**目標**: 基本功能，簡化版管線

- [ ] 整合 Depth Anything V2 Metric Outdoor Small 到 Flutter
  - NCNN 版本 (Android)
  - Core ML 版本 (iOS)
- [ ] 實作基本 YOLOv8n-seg 樹幹分割
  - 使用預訓練模型 + 簡單微調
- [ ] 實作簡化版 DBH 計算
  - 像素寬度 × 深度 ÷ 焦距
  - 無圓柱修正 (Phase 1 簡化)
- [ ] 基本 UI
  - 拍照 → 自動分析 → 顯示 DBH
  - 深度圖視覺化
- [ ] 準確度初步驗證
  - 與捲尺測量比較 20+ 棵樹

### Phase 2: 精度優化 — 預計 2-3 週

- [ ] 加入圓柱幾何修正
- [ ] 實作 EXIF 焦距自動讀取
- [ ] 改進分割: 自定義樹幹資料集訓練
- [ ] 加入信心分數計算
- [ ] 拍攝引導 UI (距離、角度提示)
- [ ] 精度驗證: 100+ 棵樹，不同樹種、距離

### Phase 3: 進階功能 — 預計 3-4 週

- [ ] 地面平面擬合 → 自動胸高定位
- [ ] 生長方向估計
- [ ] LUT 預計算查找表偏差修正
- [ ] 多棵樹同時測量
- [ ] 歷史記錄與趨勢分析整合
- [ ] 離線模式優化

### Phase 4: 精度突破 (可選) — 預計 2-3 週

- [ ] 考慮切換到 Metric3D v2 (更好的邊界精度)
- [ ] 多幀融合 (拍攝短影片取平均)
- [ ] 針對台灣常見樹種微調深度模型
- [ ] A/B 測試: Depth Anything V2 vs Metric3D v2
- [ ] 考慮 OrchardDepth 等農業專用模型的微調

---

## 10. 參考文獻

### 直接使用的核心論文

1. **Holcomb, A. et al.** (2023). "Robust Single-Image Tree Diameter Estimation with Mobile Phones." arXiv:2305.09544. [GitHub (MIT)](https://github.com/ameliaholcomb/trees)

2. **Xiang, Y. et al.** (2025). "Single Shot High-Accuracy DBH Measurement with Smartphone Embedded Sensors." *Sensors*, 25(16), 5060. doi:10.3390/s25165060. [Zenodo (CC BY)](https://doi.org/10.5281/zenodo.10650629)

3. **Wu, X. et al.** (2026). "YOLO11s Instance Segmentation + Monocular RGB Camera for Non-Fixed Distance Rubber Tree Diameter Measurement." *Computers and Electronics in Agriculture*. doi:10.1016/j.compag.2025.S0168169925014784

4. **Yang, L. et al.** (2024). "Depth Anything V2." *NeurIPS 2024*. [GitHub (Apache-2.0)](https://github.com/DepthAnything/Depth-Anything-V2)

5. **Yin, W. et al.** (2023/2024). "Metric3D / Metric3D v2: Towards Zero-Shot Metric 3D Prediction from A Single Image." *ICCV 2023 / TPAMI 2024*. [GitHub (BSD-2-Clause)](https://github.com/YvanYin/Metric3D)

### 評估與驗證論文

6. **Jia, J. et al.** (2025). "A Comprehensive Evaluation of Monocular Depth Estimation Methods in Low-Altitude Forest Environment." *Remote Sensing*, 17(4), 717. doi:10.3390/rs17040717

7. **Bhat, S.F.** (2023). "ZoeDepth: Zero-Shot Transfer by Combining Relative and Metric Depth." arXiv:2302.12288

8. **Xuan, Y. et al.** (2025). "Deep Learning Combined with Smartphone for Intelligent Estimation of DBH and AGB in Urban Forests."

### 分割與檢測模型

9. **Ultralytics** (2024). "YOLOv8: State-of-the-Art Object Detection and Segmentation." [GitHub](https://github.com/ultralytics/ultralytics)

10. **Kirillov, A. et al.** (2023). "Segment Anything." *ICCV 2023*. [GitHub](https://github.com/facebookresearch/segment-anything)

### 行動端部署

11. **nihui** (2024). "ncnn: A High-Performance Neural Network Inference Framework." [GitHub](https://github.com/Tencent/ncnn)

12. **Apple** (2024). "Core ML Framework Documentation." [Developer](https://developer.apple.com/documentation/coreml)

### 其他參考

13. **Piccinelli, L. et al.** (2025). "UniDepthV2: Universal Monocular Metric Depth Estimation." arXiv:2502.20110

14. **Guo, S. et al.** (2025). "Depth Any Camera: Zero-Shot Metric Depth Estimation from Any Camera." *CVPR 2025*

15. **Zheng, Y. et al.** (2025). "OrchardDepth: Metric Depth Estimation for Orchard Scenes." arXiv:2502.14279

16. **Zhang, Y. et al.** (2025). "Survey on Monocular Metric Depth Estimation." *Computers*

---

## 附錄 A: 快速參考卡

### A.1 核心公式速查

| 公式名稱 | 公式 | 用途 |
|---------|------|------|
| 像素→公制寬度 | $w_m = w_{px} \cdot Z / f_x$ | 基本 DBH 計算 |
| 焦距(EXIF) | $f_{px} = f_{mm} \cdot W_{px} / W_{sensor}$ | 焦距取得 |
| 焦距(FOV) | $f_{px} = W_{px} / (2\tan(\theta/2))$ | 備用焦距計算 |
| 弦長 | $l = p \cdot N_{BH} / f$ | 弦長測量 |
| 圓柱修正 | $d = l^2 p / (l^2 + 4p^2)$ | 弦→直徑 |
| 地面平面 | $Ax + By + Cz + D = 0$ | 胸高定位 |
| 3D 反投影 | $X = (u-c_x)Z/f_x$ | 深度→3D |
| 誤差傳播 | $\Delta D/D \approx \Delta Z/Z + \Delta w/w$ | 精度估算 |

### A.2 推薦模型組合

| 組件 | 推薦模型 | 大小 | 授權 |
|------|---------|------|------|
| 深度估計 | Depth Anything V2 Metric Outdoor Small | 24.8M | Apache-2.0 |
| 樹幹分割 | YOLOv8n-seg (自定義訓練) | 3.4M | AGPL-3.0 |
| 推論框架 (Android) | NCNN | — | BSD-3-Clause |
| 推論框架 (iOS) | Core ML | — | Apple |

### A.3 關鍵 HuggingFace 模型

```
# Depth Anything V2 Metric Outdoor Small (推薦)
depth-anything/Depth-Anything-V2-Metric-Outdoor-Small

# Depth Anything V2 Metric Indoor Small (室內場景)
depth-anything/Depth-Anything-V2-Metric-Indoor-Small

# 使用方式 (Python)
from transformers import pipeline
pipe = pipeline(task="depth-estimation", 
                model="depth-anything/Depth-Anything-V2-Metric-Outdoor-Small")
result = pipe(image)
depth_map = result["depth"]  # PIL Image
predicted_depth = result["predicted_depth"]  # torch.Tensor (H, W), unit: meters
```

---

## 附錄 B: 與現有程式碼的整合點

### B.1 現有程式碼分析

目前 `ar_dbh_measurement_page.dart` (802 行) 中的距離模式使用：

```dart
// 現有的不精確公式 (經驗值)
focalLengthPx = screenWidth * 4.0  // ❌ 錯誤：經驗值
diameterM = (pixelWidth * distanceM) / focalLengthPx  // ❌ 缺少圓柱修正
```

### B.2 需要修改的檔案

| 檔案 | 修改內容 |
|------|---------|
| `lib/screens/ar_dbh_measurement_page.dart` | 新增純視覺測量模式 |
| `lib/services/ar_measurement_service.dart` | 新增 `MeasurementMethod.pureVision` |
| **新建** `lib/services/depth_estimation_service.dart` | NCNN/CoreML 深度估計封裝 |
| **新建** `lib/services/trunk_segmentation_service.dart` | 樹幹分割封裝 |
| **新建** `lib/services/dbh_calculator_service.dart` | DBH 計算邏輯 |
| **新建** `android/app/src/main/cpp/` | NCNN C++ 推論程式碼 |
| **新建** `ios/Runner/MLModel/` | Core ML 模型檔案 |

---

*最後更新: 2025-07*  
*作者: TreeAI 開發團隊*
