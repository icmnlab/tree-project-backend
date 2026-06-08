# Sustainable TreeAI — 專案總覽 (教授會議用)

> **最後更新: 2026-03-11**
> 建議搭配 GitHub Repo README + 實機 Demo 一起使用

---

## 1. 專案定位

**名稱:** Sustainable TreeAI — TIPC 智慧樹木管理系統
**客戶:** 臺灣國際港務公司 (TIPC)
**目標:** 以 AI + 純視覺方法（不需 LiDAR）建立港區樹木調查與碳匯分析平台

**核心創新:**
- 手機單張照片 → 自動量測 DBH（胸高直徑），精度目標 RMSE < 5cm
- 端到端 AI Agent 支援自然語言查詢資料庫
- 完整的碳匯計算與碳權估算系統

---

## 2. 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│  Flutter App (Android / iOS)                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ YOLOv8n  │  │ AI Chat  │  │ 碳匯計算  │  │ Google Map │  │
│  │ (TFLite) │  │          │  │          │  │ (GeoJSON)  │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────────────┐
│  Ubuntu Server (i3-8130U, 11GB RAM)                         │
│  Node.js + Express + PostgreSQL 16                          │
│  PM2 Cluster (2 instances) + Tailscale Funnel               │
│  公網 URL: https://<TAILSCALE_HOST>   │
│  23 路由模組, 130+ API 端點                                  │
│  AI Agent: SiliconFlow API (DeepSeek-V3 / Qwen3-235B)      │
└─────────────────────┬───────────────────────────────────────┘
                      │ Tailscale VPN
┌─────────────────────▼───────────────────────────────────────┐
│  Windows ML Server (Core Ultra 5 125H, 16GB)                │
│  FastAPI + Depth Pro (350M) + SAM 2.1 Small (46M)           │
│  OpenVINO + Intel Arc iGPU 加速                              │
│  DBH 量測管線: 深度估計 → 分割 → 3D 回推 → 直徑計算          │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 主要功能一覽

### 3.1 樹木調查 (核心業務)
| 功能 | 說明 |
|------|------|
| 調查表單 (V1/V2/V3) | 智慧表單，含自動欄位補全、樹種搜尋 |
| BLE 裝置匯入 | 藍牙低功耗批次匯入現場量測數據 |
| CSV 批次匯入 | 支援 Excel 匯出的 CSV 格式 |
| 地圖檢視 | Google Maps + 樹木標記 + 專案邊界 (GeoJSON) |
| 影像管理 | 每棵樹可上傳多張照片，含 Cloudinary 雲端儲存 |
| 報表匯出 | Excel / PDF / AI 永續報告 |

### 3.2 AI 純視覺 DBH 量測 (學術創新)
| 步驟 | 技術 |
|------|------|
| 即時樹幹偵測 | YOLOv8n-seg (3.4M 參數, TFLite, 手機端運行) |
| 度量深度估計 | Apple Depth Pro (350M, ICLR 2025 SOTA) |
| 精確樹幹分割 | SAM 2.1 Small (Meta, 46M 參數) |
| DBH 計算 | 3D 回推 + RANSAC 地面平面擬合 + 圓柱幾何校正 |

**數學框架:**
$$D_{tree} = \frac{d_p \cdot \delta_m}{\gamma_p} - \frac{d_p}{4}$$
其中 $d_p$ 為像素寬度，$\delta_m$ 為度量深度，$\gamma_p$ 為相機焦距

### 3.3 AI Agent (ReAct 架構)
- **對話引擎:** SiliconFlow API，支援多模型切換
  - DeepSeek-V3 (預設), Qwen3-235B (強力), QwQ-32B (推理)
- **5 個工具:** 資料庫查詢 (Text-to-SQL)、碳匯計算、樹種碳資訊、專案統計、碳權估算
- **安全控制:** 最多 8 步 tool call、50K token/hr 預算、速率限制
- **特色:** 支援自然語言查詢，例如「花蓮港有多少棵樟樹？」→ 自動轉 SQL

### 3.4 碳匯分析系統
| 功能 | 說明 |
|------|------|
| 碳匯計算 | 基於 Chave et al. (2014) 泛熱帶異速生長方程式 |
| 碳權估算 | 支援 VCS AR / Gold Standard / 台灣碳權抵換 三種方法論 |
| 樹種碳效率 | 73 種已建檔樹種，含碳吸收率、生長率、碳效率評分 |
| 混合林規劃 | 依區域推薦最佳碳匯混合林組合 |
| 碳足跡建議 | AI 生成個人化碳足跡抵減建議 |

### 3.5 權限管理 (5 級 RBAC)
系統管理員 → 業務管理員 → 專案管理員 → 調查管理員 → 一般使用者

---

## 4. 技術亮點

### 4.1 研究基礎
本專案的 DBH 量測方法建立在以下文獻之上：

| 文獻 | 年份 | 貢獻 |
|------|------|------|
| Holcomb et al. — Robust Single-Image Tree Diameter | 2023 | DBH 基礎公式, RMSE=3.7cm, R²=0.97 |
| Xiang et al. — Single Shot High-Accuracy DBH | 2025 | MAE=0.53cm, RMSE=0.63cm, 圓柱校正 |
| Wu et al. — YOLO11s + Monocular RGB for Non-Fixed Distance | 2026 | 純 RGB, 非固定距離 — 最接近本專案方法 |
| Yang et al. — Depth Anything V2 | 2024 | NeurIPS, DPT+DINOv2 |
| Jia et al. — Monocular Depth in Forest Environments | 2025 | 7 模型森林環境基準測試 |

### 4.2 端到端自動化

```
使用者拍照 → 手機端 YOLOv8n 即時偵測 → 照片送到ML伺服器
→ Depth Pro 估計深度 → SAM2.1 精確分割樹幹
→ 3D 回推 + RANSAC + 圓柱校正 → 回傳 DBH (cm)
→ 碳匯自動計算 (AGB, CO₂ 當量)
```

### 4.3 部署架構
- **雙機架構:** Ubuntu (後端) + Windows (ML 推論)
- **公網存取:** Tailscale Funnel (免費 HTTPS，無需購買域名)
- **零停機部署:** PM2 cluster mode + GitHub webhook 自動部署
- **資料庫:** PostgreSQL 16, 23 張表, 含自動遷移

---

## 5. 專案規模統計

| 指標 | 數量 |
|------|------|
| 後端路由模組 | 23 |
| API 端點 | 130+ |
| 前端頁面/畫面 | 25+ |
| AI/LLM 模型支援 | 10 (多供應商) |
| ML 視覺模型 | 4 (Depth Pro, DA V2, YOLOv8n-seg, SAM 2.1) |
| Agent 工具 | 5 |
| 引用學術論文 | 8+ |
| RBAC 角色 | 5 |
| 資料庫表格 | 23 |
| 已建檔樹種 | 73 |

---

## 6. Demo 建議流程

1. **開啟 App** → 登入 → 展示主頁面和功能一覽
2. **瀏覽調查紀錄** → 展示真實的港區樹木數據 (758KB+ 資料)
3. **地圖功能** → 展示專案邊界 + 樹木標記分布
4. **AI Agent** → 輸入自然語言問題，展示 tool calling 過程
   - 例：「幫我計算一棵 DBH 30cm 的樹的碳匯」
   - Agent 呼叫 calculate_carbon → 回傳 AGB=241.98kg, CO₂=888.05kg
5. **碳匯分析** → 展示碳權估算和混合林規劃
6. **ML 量測** (如果 ML Service 已啟動) → 拍照 → 自動 DBH
7. **系統架構** → 展示本文件的架構圖 + 部署方案

---

## 7. GitHub 倉庫

| 倉庫 | 連結 |
|------|------|
| Backend | https://github.com/Aaronliu0208/tree-app-backend |
| Frontend | https://github.com/<GITHUB_OWNER>/tree-project-frontend |

---

## 8. 待完成工作 / 未來方向

- [ ] DBH 量測精度驗證 (Ground Truth 比對)
- [ ] ML Service 重開機自動啟動
- [ ] 更多樹種碳匯數據擴充
- [ ] iOS 版本測試與發佈
- [ ] 使用者介面 UX 最佳化
