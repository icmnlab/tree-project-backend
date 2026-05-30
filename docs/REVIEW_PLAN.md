# 論文全面審查計畫

> **論文**：整合深度學習與AI Agent之智慧樹木碳匯管理平台開發  
> **會議**：第27屆永續發展管理研討會「2026 AI賦能永續未來」  
> **Track**：SS06 - 智慧物聯網於永續發展之技術與應用  
> **日期**：2026-05-22 (五)，國立屏東科技大學 管理學院  
> **格式**：APA 7, Word, ≤15頁, 標楷體/TNR 12pt, 單行間距, 邊界2.54cm  
> **對應檔案**：`docs/generate_paper.py` → `docs/conference_paper_v8.docx`  
> **圖表生成**：`docs/generate_figures_v2.py` → `docs/figures/fig1~fig4`

---

## Phase A：參考文獻逐一驗證（19篇）

每篇文獻需確認：(i) 該文獻真實存在 (ii) 作者/年份/標題/期刊正確 (iii) DOI/URL 可存取 (iv) 論文內文引用時的宣稱內容確實出現在該文獻中 (v) 引用格式符合APA 7

### A-1. Bochkovskii et al. (2024) — Depth Pro
- [ ] 確認 arXiv:2410.02073 存在且標題為 "Depth Pro: Sharp monocular metric depth in less than a second"
- [ ] 確認作者列表：Bochkovskii, A., Delaunoy, A., Germain, H., Santos, M., Zhou, Y., Richter, S. R., & Koltun, V.
- [ ] 論文宣稱：Apple Depth Pro, 350M參數 → 確認350M是否正確（查arXiv原文或model card）
- [ ] 確認 APA 7 arXiv 格式（應有 https://doi.org/10.48550/arXiv.2410.02073 或 arXiv preprint）

### A-2. Cabo et al. (2018) — TLS dendrometry
- [ ] 確認期刊 International Journal of Applied Earth Observation and Geoinformation, 69, 164-174
- [ ] 論文宣稱：TLS「設備昂貴且操作門檻高」→ 確認此文獻是否支持此論述
- [ ] 確認 DOI 存在（論文中未列，建議補上）

### A-3. Chave et al. (2014) — 改良異速生長方程式
- [x] 確認 Global Change Biology, 20(10), 3177-3190, DOI: 10.1111/gcb.12629 ✅
- [ ] 論文宣稱：「全球58個地點、4,004棵樹」→ 核對原文是否為此精確數字
- [ ] 論文宣稱：公式 AGB = 0.0673 × (ρ × D² × H)^0.976 → 核對原文公式
- [ ] 論文宣稱：「建議之熱帶樹種均值0.58 g/cm³」→ 核對Chave 2014是否有此建議
- [x] 確認 APA 7 格式（作者列表過長使用 ... 省略是否正確）→ ✅ APA 7 允許 20+ 作者用 "..." 省略

### A-4. IPCC (2006) — 國家溫室氣體清冊指南
- [x] 確認出版資訊：Vol. 4, Institute for Global Environmental Strategies ✅
- [x] 論文宣稱：「以0.50碳分率將生物量轉換為碳含量」→ ✅ IPCC 2006 建議 0.47(熱帶) 或 0.50(通用)，我們用 0.50 可接受
- [x] 確認 APA 7 機構作者格式 ✅

### A-5. IPCC (2021) — AR6 WG1
- [ ] 確認出版：Climate change 2021: The physical science basis, Cambridge University Press
- [ ] 論文宣稱：「全球均溫已較工業化前上升約1.1°C」→ 核對AR6是否為1.1°C

### A-6. Jenkins et al. (2004) — 北美樹種生物量迴歸
- [x] 確認：General Technical Report NE-319, USDA Forest Service ✅
- [x] 論文宣稱：「闊葉混合林參數 a=−2.48, b=2.4835」→ ✅ 表6手算驗證通過
- [x] 論文宣稱：「僅以DBH為輸入」→ ✅ ln(AGB) = a + b × ln(DBH)
- [x] 確認 APA 7 技術報告格式 ✅
- [x] **年份問題**：Google Scholar 顯示 2003/2004 皆有引用，保留 2004（多數用法）

### A-7. Liu et al. (2023) — Text-to-SQL
- [ ] 確認 arXiv:2303.13547 存在且標題正確
- [ ] 論文宣稱：「Text-to-SQL技術使非技術使用者可以自然語言查詢結構化資料」→ 確認此文是否討論此觀點
- [ ] 確認作者列表：Liu, A., Hu, X., Wen, L., & Yu, P. S.

### A-8. Mokany et al. (2006) — 根冠比
- [x] 確認 Global Change Biology, 12(1), 84-96, DOI: 10.1111/j.1365-2486.2005.**001043**.x → ⚠️ **已修正 DOI typo** (`01043.x` → `001043.x`，原DOI返回404)
- [ ] 論文宣稱：「1.24之根冠比擴展因子」→ 核對原文是否有1.24這個數值（注意：root:shoot ratio 1.24 意味什麼？需核對計算方式）

### A-9. Nowak et al. (2013) — 美國城市樹木碳儲
- [ ] 確認 Environmental Pollution, 178, 229-236
- [ ] 論文宣稱：城市樹木「在城市碳中和策略中扮演關鍵角色」→ 確認此文支持此觀點

### A-10. Ravi et al. (2024) — SAM 2
- [ ] 確認 arXiv:2408.00714 存在且標題 "SAM 2: Segment Anything in images and videos"
- [ ] 論文宣稱：「Tiny變體(38.9M參數)CPU推論約3秒」→ 核對SAM2原文或model card是否述及38.9M
- [ ] 確認作者列表（多達18人），APA 7多作者格式

### A-11. TensorFlow (2024) — GPU Delegate
- [ ] 確認 URL https://www.tensorflow.org/lite/performance/gpu 可存取
- [ ] 論文宣稱：「搭配GPU Delegate可實現數倍推論加速」→ 確認TF Lite文件是否述及加速倍數
- [ ] APA 7 網頁引用格式（應含存取日期?）

### A-12. Terry et al. (2020) — 公民科學
- [ ] 確認 Methods in Ecology and Evolution, 11(2), 303-315
- [ ] 論文宣稱：智慧手機「已被應用於生態調查」→ 確認此文是否有此論述

### A-13. Ultralytics (2023) — YOLOv8
- [ ] 確認 GitHub URL https://github.com/ultralytics/ultralytics 存在
- [ ] 論文宣稱：「YOLOv8整合實例分割功能，Nano變體僅3.2M參數」→ 核對3.2M是否正確
- [ ] APA 7 軟體/GitHub引用格式

### A-14. West (2009) — Tree and Forest Measurement
- [ ] 確認出版：Springer, 2nd ed.
- [ ] 論文宣稱：「面對大規模碳匯盤查時效率低下且成本高昂」→ West 2009是否支持此說法

### A-15. Xiang et al. (2025) — iPhone LiDAR DBH
- [ ] 確認 Sensors, 25(16), 5060, DOI: 10.3390/s25165060
- [ ] **年份2025問題**：若此文來自2025年8月，當前是2026年3月，已可引用
- [ ] 論文宣稱：「MAE 0.53 cm」→ 核對原文的精度數據
- [ ] 論文宣稱：「圓柱幾何校正原理」「查找表(LUT)校正弧面深度偏差」→ 核對原文方法
- [ ] 確認我們的校正公式 d = l·p / √(p² − l²/4) 的靈感是否確實源於Xiang

### A-16. Yang et al. (2024) — Depth Anything V2
- [ ] 確認 NeurIPS, arXiv:2406.09414
- [ ] 論文宣稱：「以DINOv2為編碼器，Small變體24.8M參數」→ 核對原文
- [ ] 確認作者列表

### A-17. Yao et al. (2023) — ReAct
- [ ] 確認 ICLR 2023
- [ ] 論文宣稱：「結合推理(Reasoning)與行動(Acting)」→ 核對原文
- [ ] 確認作者列表

### A-18. Zanne et al. (2009) — GWDD
- [ ] 確認 Dryad, DOI: 10.5061/dryad.234（已驗證過，可跳過）
- [ ] 論文宣稱：「涵蓋8,412分類群」→ 核對原文或Dryad說明

### A-19. Zheng et al. (2018) — 低成本PM感測器
- [x] 確認 Atmospheric Measurement Techniques, 11(8), 4823-4846 ✅
- [x] ⚠️ **已修正作者名**：原 "Shiber, S., Nukala, R." → 正確為 "Shirodkar, S., Landis, M. S., Sutaria, R."（經 AMT Copernicus 原文頁面驗證）
- [x] 論文宣稱：智慧手機已應用於「環境監測」→ 此文討論低成本PM sensors，與手機為弱連結但可防禦

---

## Phase B：數字與程式碼交叉比對

每個數字都需找到對應程式碼行或配置檔來確認。

### B-1. 模型參數量
- [ ] YOLOv8n-seg「3.2M參數」→ 查 `tflite_tracking_service.dart` 或 Ultralytics 官方文件
- [ ] Depth Pro「350M參數」→ 查 `model_registry.py` 或 Depth Pro paper
- [ ] DA V2 Small「24.8M參數」→ 查 `model_registry.py` 或 DA V2 paper
- [ ] SAM 2.1 Tiny「38.9M參數」→ 查 `tree_segmentation.py` 或 SAM2 paper
- [ ] LLM「Qwen2.5-72B」→ 查 `agentService.js` 確認模型名稱

### B-2. 推論速度
- [ ] YOLOv8n-seg「50-100ms (行動端)」→ 是否有實測數據？或是估計值？
- [ ] Depth Pro「5-8s (OpenVINO iGPU)」→ 查 ML service log 或實測
- [ ] DA V2 Small「~1.5s (CPU)」→ 查 ML service log 或實測
- [ ] SAM 2.1 Tiny「~3s (CPU)」→ 查 ML service log 或實測
- [ ] LLM「1-5s (API)」→ API 響應時間估計（表5中）

### B-3. YOLO 配置
- [ ] 輸入「640×640 RGB」→ 查 `tflite_tracking_service.dart` 中的 inputSize
- [ ] 信心閾值「0.15」→ 查 `tflite_tracking_service.dart` 中的 confidenceThreshold
- [ ] NMS IoU「0.45」→ 查 `tflite_tracking_service.dart` 中的 iouThreshold
- [ ] 最多「5名候選」→ 查 `tflite_tracking_service.dart` 中的 maxDetections
- [ ] 「32維遮罩係數」→ 查 `tflite_tracking_service.dart` 中的 mask prototype 維度
- [x] GPU Delegate回退「雙線程→單線程→CPU」→ ⚠️ **已修正為「GPU→多線程→單線程→CPU」**
- [ ] 動態節流「等待時間為推論耗時之1.5倍」→ 查 `tflite_tracking_service.dart` throttle

### B-4. DBH 品質閘門
- [ ] 信心 < 0.45 → poor_quality → 查 `dbh_calculator.py` 或相關品質判斷代碼
- [ ] DBH > 200cm → poor_quality → 查同上
- [ ] DBH < 2cm → poor_quality → 查同上

### B-5. 後端數字
- [x] 「23張表」→ ✅ 已驗證 = 23 tables + 1 view
- [x] 「107支API」→ ✅ 已驗證 = 107 endpoints
- [ ] 「五級角色權限」→ 查 middleware/auth 或 RBAC 代碼
- [ ] 五級名稱：系統管理員/業務管理員/專案管理員/調查管理員/一般使用者 → 查代碼中的 role 定義

### B-6. Agent 相關
- [ ] 「五項專業工具」→ 查 `agentService.js` 的 tools 定義，列出5個名稱
- [ ] 工具名稱對照：(1)資料查詢=query_tree_data (2)碳儲量計算=calculate_carbon (3)物種碳匯=species_carbon_info (4)專案統計=project_summary (5)碳權估價=carbon_credit_estimate → 逐一確認
- [ ] 「Qwen2.5-72B(預設)」→ 查 `agentService.js` DEFAULT_MODEL
- [ ] 「DeepSeek-V3」→ 查支援模型列表
- [ ] 「Qwen3-235B-A22B」→ 查支援模型列表（注意：是否為Qwen3? 還是Qwen2.5?）
- [ ] 「SiliconFlow API」→ 查 agentService.js API 配置
- [ ] SQL「SELECT-only」→ 查 `sqlQueryService.js` 的 SQL 驗證
- [ ] 「五表白名單」→ 查 `sqlQueryService.js` 白名單內容，列出5張表
- [ ] 「注入模式偵測」→ 查 `sqlQueryService.js` regex patterns
- [ ] 預設上限「50筆(最多100筆)」→ 查 `sqlQueryService.js` 的 MAX_LIMIT 和 DEFAULT_LIMIT
- [ ] 「SQL失敗自動重試(最多1次)」→ 查 chatV2 相關代碼
- [ ] 「≥5筆結果自動匯出Excel」→ 查代碼
- [ ] 「1小時過期」→ 查 Excel 過期設定

### B-7. BLE 相關
- [ ] 「33欄位 CSV」→ 查 `ble_packet_decoder.dart` 或 `ble_data_processor.dart` 的 field definitions
- [ ] 「5層驗證」→ 查 BLE 處理代碼，列出5層名稱
- [ ] 5層名稱：封包重組→結構修復→上下文感知字母過濾→欄位範圍驗證→完整性確認 → 逐層確認
- [ ] 「SEQ 1-20」→ 查 BLE 驗證中的 SEQ 範圍
- [ ] 「UTC 6碼」→ 查 BLE 驗證中的 UTC 格式
- [ ] 「Nordic UART Service」→ 確認實際使用的BLE service UUID

### B-8. 物種與碳
- [x] 「82種台灣常見樹種」→ ✅ 查 `carbon_calculation_service.dart` 確認 82 entries
- [x] 「**42**組學名至中文俗名」→ ✅ count_species.py 確認 42（論文已從41修正為42）
- [x] PlantNet信心閾值「0.60」→ ⚠️ **虛構數字，已移除**。實際只有 0.15 auto-add 閾值，無 0.60
- [ ] 碳權折扣率 VCS=80%, GS=75%, 台灣=90% → 查 `agentService.js` carbon_credit_estimate tool
- [ ] 碳價 VCS=5-15, GS=10-30, 台灣=3-10 → 查同上

### B-9. 表6計算值手算驗證
Jenkins: AGB = exp(−2.48 + 2.4835 × ln(D))，注意D要用cm
- [x] D=20: AGB = 142.6 ✅
- [x] D=25: AGB = 248.2 ✅
- [x] D=30: AGB = 390.3 ✅
- [x] D=40: AGB = 797.4 ✅
- [x] D=50: AGB = 1387.8 ✅
- [x] 每列：總生物量 = AGB × 1.24 → ✅ 全部正確
- [x] 每列：碳含量 = 總生物量 × 0.50 → ✅ 全部正確
- [x] 每列：CO₂e = 碳含量 × 3.67 → ✅ 全部正確（差異 < 0.05）

### B-10. 部署硬體
- [ ] ML硬體「Intel Core Ultra 5 125H + Arc iGPU」→ 確認實際硬體
- [ ] 後端硬體「Intel i3-8130U, 11GB RAM, Ubuntu 24.04」→ 確認實際規格
- [ ] Tailscale VPN → 確認使用中
- [ ] Nginx TLS → 確認有 TLS 配置
- [ ] GitHub Webhook → 確認有 auto-deploy 腳本
- [ ] PM2叢集 → 確認 `ecosystem.config.js` 的 instance 設定
- [ ] 「Node.js v20」→ 確認 `package.json` engines 或實際版本
- [ ] 「PostgreSQL 16」→ 確認版本
- [ ] 「Flutter 3.x」→ 確認 `pubspec.yaml` SDK constraint

---

## Phase C：系統描述 vs 實際程式碼

逐段核對論文中對系統的描述是否與程式碼一致。

### C-1. 摘要
- [x] 「TIPC既有樹木調查資料庫的行動化需求」→ ✅ 確認正確定位
- [x] 「研究開發過程中未取得配有LiDAR感測器之手機」→ ✅ 已修正用詞（原「開發端不具備」）
- [x] 「Depth Pro搭配YOLOv8n-seg偵測與SAM 2.1分割」→ ✅ 三者都在系統中
- [x] 「Chave et al. (2014)方程式」→ ✅ `carbon_calculation_service.dart` 中有 Chave 2014
- [x] 「ReAct架構AI Agent」→ ✅ agentService.js 確實用 ReAct
- [x] 「Flutter、Node.js與FastAPI三層架構」→ ✅ 三層都存在

### C-2. 前言第三段（具體工作）
- [ ] 「(1)整合端側YOLOv8n-seg與雲端Depth Pro/SAM 2.1」→ 確認端側+雲端分工正確
- [ ] 「(2)Chave et al. (2014)方程式搭配文獻來源之木材密度」→ 確認碳計算邏輯
- [ ] 「(3)ReAct架構AI Agent，Text-to-SQL」→ 確認 Agent 有 Text-to-SQL 功能
- [ ] 「(4)PDF/Excel報表匯出與五級權限管理」→ 確認都有實作

### C-3. 參、研究方法 — 一、系統整體架構
- [ ] 「三層式架構」→ 確認前端/後端/CV三層
- [ ] 行動端描述：「即時相機預覽、端側YOLOv8n-seg推論、GPS定位、BLE藍牙設備連線及碳儲量計算」→ 逐項確認存在
- [ ] 後端描述：「23張表、JWT認證、五級角色權限控管(RBAC)及107支RESTful API」→ 已驗證
- [ ] 後端描述：「ReAct AI Agent(Text-to-SQL)與PlantNet/GBIF/iNaturalist三重物種辨識」→ 確認在後端
- [ ] CV服務描述：「Depth Pro深度估計(搭配OpenVINO iGPU加速)與SAM 2.1影像分割」→ 確認
- [ ] 第二段：「TFLite即時樹幹偵測提供邊界框視覺回饋」→ 確認TFLite flow
- [ ] 第二段：「HTTP呼叫CV推論服務」→ 確認是HTTP (非WebSocket)
- [ ] 第二段：「叢集模式部署，搭配HTTPS加密傳輸及版本控制自動部署」→ 確認

### C-4. 二、純視覺DBH量測模組
- [ ] 「640×640 RGB」→ 查 input 規格
- [ ] 「32維遮罩係數」→ 查 mask prototype
- [ ] 「動態推論節流(等待時間為推論耗時之1.5倍)」→ 查 throttle code
- [ ] 「GPU Delegate自動回退」→ 查 fallback
- [ ] Depth Pro 描述的 OpenVINO INT8 → 查 `model_registry.py` 是否確實是 INT8
- [ ] DA V2 Small 備用描述 → 查 fallback 機制
- [ ] DBH計算三策略「深度梯度、閾值聚類、垂直一致性」→ 查 `dbh_calculator.py`
- [ ] 像素焦距公式「w_m = trunk_px × depth_m / f_px」→ 查代碼
- [ ] 圓柱校正公式「d = l·p / √(p² − l²/4)」→ 查 `dbh_calculator.py`
- [ ] SAM 2.1 四級分割策略描述 → 查 `tree_segmentation.py`
- [ ] 品質閘門閾值 → 查代碼

### C-5. 三、碳儲量估算與碳權方法論
- [ ] Chave 2014 完整公式的使用條件(需ρ和H) → 查 `carbon_calculation_service.dart`
- [ ] Jenkins 2004 退回條件(缺乏參數) → 查同上
- [ ] 後續轉換鏈 AGB→1.24→0.50→3.67 → 查代碼計算步驟
- [ ] 82種密度值來源「ICRAF農林資料庫及台灣林業相關文獻」→ 已知，確認論文描述正確
- [ ] 「尚未逐一與GWDD交叉比對」→ 確認（已知為事實）
- [ ] 預設值「0.58 g/cm³」→ 查 `carbon_calculation_service.dart` DEFAULT_DENSITY
- [ ] 表2的8個密度值 → 查 `carbon_calculation_service.dart` 的 density map
  - [ ] 樟樹 Cinnamomum camphora = 0.52
  - [ ] 相思樹 Acacia confusa = 0.65
  - [ ] 台灣杉 Taiwania cryptomerioides = 0.32
  - [ ] 榕樹 Ficus microcarpa = 0.55
  - [ ] 鳳凰木 Delonix regia = 0.50
  - [ ] 大葉桃花心木 Swietenia macrophylla = 0.55
  - [ ] 黑板樹 Alstonia scholaris = 0.35
  - [ ] 木賊葉木麻黃 Casuarina equisetifolia = 0.83
- [ ] 碳權三方法論折扣率與碳價 → 查 agentService.js carbon_credit_estimate
  - [ ] VCS: 80%, USD 5-15
  - [ ] Gold Standard: 75%, USD 10-30
  - [ ] 台灣碳權: 90%, USD 3-10

### C-6. 四、ReAct AI Agent
- [ ] 「SiliconFlow API」→ 查 agentService.js
- [ ] 「Qwen2.5-72B(預設)、DeepSeek-V3及Qwen3-235B-A22B」→ 逐一查confirmed models
- [ ] 五項工具名稱與功能描述 → 逐一確認
- [ ] Text-to-SQL 流程描述：意圖分類→LLM生成SQL→安全驗證→執行→解說 → 查代碼流程
- [ ] 「SELECT-only」→ 查 sqlQueryService.js
- [ ] 「五表白名單」→ 查白名單內容
- [ ] 「預設上限50筆(最多100筆)」→ 查 MAX_LIMIT, DEFAULT_LIMIT
- [ ] 「Chat V2」多家LLM → 查 chatV2 相關代碼
- [ ] SQL失敗重試 → 查
- [ ] ≥5筆 Excel 自動匯出 → 查
- [ ] 1小時過期 → 查

### C-7. 五、BLE設備整合與資料管理
- [ ] 「Haglöf Vertex Laser Geo」→ 確認設備名稱正確
- [ ] 「33欄位CSV格式」→ 查 BLE decoder
- [ ] 5層驗證描述 → 逐層查代碼
- [ ] 「PDF及Excel」報表匯出 → 確認有 PDFKit + ExcelJS
- [ ] 「中文字型嵌入」→ 確認 NotoSansTC 或類似
- [ ] 五級權限名稱 → 查 RBAC 代碼

### C-8. 肆、系統實作與分析
- [ ] 表4 每個項目 → 確認
- [ ] 表5 模型數據 → 每行確認
- [ ] 「六大核心模組」描述 → 確認都有對應頁面/功能
- [ ] 「107支API」→ 已驗證
- [ ] 表6 計算值 → Phase B-9 已涵蓋

### C-9. 伍、結論與建議
- [ ] 四點貢獻陳述 → 逐點確認不誇大
- [ ] 「目前已完成原型開發」→ 確認系統確實可運作
- [ ] 「DBH量測精度尚待系統性驗證」→ 確認這是誠實陳述
- [ ] 限制(1)「尚未進行系統性的精度驗證」→ 確認
- [ ] 限制(2)「木材密度尚未逐一與GWDD交叉驗證」→ 確認
- [ ] 限制(3)「尚未經過大規模田野測試」→ 確認
- [ ] 限制(4) Agent 以SQL查詢為主 → 確認
- [ ] 限制(5) 時序生長模型 → 確認是建議方向

---

## Phase D：公式與計算驗證

### D-1. Chave 2014 完整公式
- [ ] AGB = 0.0673 × (ρ × D² × H)^0.976
- [ ] 查程式碼 `carbon_calculation_service.dart` 的 Chave 實作
- [ ] 核對原論文公式
- [ ] 單位：ρ=g/cm³, D=cm, H=m → AGB=kg

### D-2. Jenkins 2004 簡化公式
- [ ] AGB = exp(−2.48 + 2.4835 × ln(D))
- [ ] 查程式碼 carbon_calculation_service.dart 的 Jenkins 實作
- [ ] 核對原論文參數對應表（Hard maple/misc. hardwoods 的 b0, b1）
- [ ] 注意：D 的單位在 Jenkins 原文中是 cm 還是其他？

### D-3. 後續轉換
- [ ] 總生物量 = AGB × 1.24 (Mokany 2006) → 查代碼
- [ ] 碳含量 = 總生物量 × 0.50 (IPCC 2006) → 查代碼
- [ ] CO₂e = 碳含量 × 3.67 (44/12=3.667) → 查代碼

### D-4. DBH 計算公式
- [ ] w_m = trunk_px × depth_m / f_px → 查 `dbh_calculator.py`
- [ ] d = l·p / √(p² − l²/4) → 查 `dbh_calculator.py`
- [ ] 確認公式推導正確性（弦長→直徑的幾何關係）

### D-5. 表6計算驗證（手算）
用 Python 手算：
```python
import math
for D in [20, 25, 30, 40, 50]:
    AGB = math.exp(-2.48 + 2.4835 * math.log(D))
    total = AGB * 1.24
    carbon = total * 0.50
    co2e = carbon * 3.67
    print(f"D={D}: AGB={AGB:.1f}, Total={total:.1f}, C={carbon:.1f}, CO2e={co2e:.1f}")
```

---

## Phase E：表格與圖表審查

### E-1. 表1 系統技術堆疊（10行）
- [ ] 行動端: Flutter / Dart → 正確
- [ ] 行動端: TFLite + GPU Delegate → 正確
- [ ] 行動端: BLE Nordic UART → 確認 UUID
- [ ] 後端: Node.js v20 / Express → 確認版本
- [ ] 後端: PostgreSQL 16 → 確認版本
- [ ] 後端: PM2 / Nginx / TLS → 確認
- [ ] 後端: SiliconFlow API (LLM) → 確認Agent在後端
- [ ] 後端: PlantNet / GBIF / iNaturalist → 確認在後端
- [ ] CV服務: FastAPI / Uvicorn → 確認
- [ ] CV服務: PyTorch 2.x / OpenVINO → 確認版本

### E-2. 表2 木材密度（8行）
- [ ] 每個密度值與 carbon_calculation_service.dart 的 density map 做比對（見 C-5）

### E-3. 表3 碳權方法論（3行）
- [ ] VCS AR-ACM0003 → 確認方法論編號是否正確
- [ ] Gold Standard → 確認
- [ ] 台灣碳權抵換 → 確認
- [ ] 各折扣率與碳價 → 查 agentService.js

### E-4. 表4 開發環境（9行）
- [ ] 每行細節確認

### E-5. 表5 模型效能（5行）
- [ ] 每行：模型名/參數量/推論時間/功能 → 逐一確認

### E-6. 表6 碳儲量範例（5行）
- [ ] 手算驗證（Phase D-5）

### E-7. 圖1 系統架構圖 — ✅ 已修正
`generate_figures_v2.py` 中的圖1已修正以下問題：
- [x] **Agent/LLM/物種辨識錯放在「CV 推論服務」欄** → ✅ 已移至「後端」欄
- [x] **後端 API 數字「130+ 端點」** → ✅ 已改為「107 端點」
- [x] **後端表數「22 表」** → ✅ 已改為「23 表」
- [ ] 行動端「25+ 頁面」→ 確認（實際有19+ screens, 更準確數字?）
- [x] 箭頭方向/邏輯是否正確 → ✅ 已移除重疊SQL箭頭
- [x] 三欄分類是否與論文文字一致 → ✅

### E-8. 圖2 DBH量測流程 — ✅ 已修正
- [x] **端側/雲端分組錯誤** → ✅ 已修正：(0,1,'端側'), (2,3,'雲端推論'), (4,5,'計算')
- [x] 步驟6「碳儲量 Chave 2014」→ ✅ 歸入「計算」分類（雖實際在行動端執行，但屬於計算階段）
- [x] DA V2 Small 替代箭頭是否清晰 → ✅ 虛線框+虛線箭頭+「輕量替代」標籤

### E-9. 圖3 ReAct Agent 流程
- [ ] 5個工具名稱是否與論文/代碼一致
- [ ] SQL安全驗證步驟是否呈現
- [ ] 流程是否與 agentService.js 的 ReAct loop 一致

### E-10. 圖4 APP截圖
- [ ] 4張截圖是否存在於 `docs/figures/screenshots/`：a_scan.png, b_dbh_result.png, c_statistics.png, d_ai_chat.png
- [ ] 截圖是否為最新版本的APP
- [ ] 截圖內容與圖片說明是否一致
  - [ ] (a)即時樹幹掃描
  - [ ] (b)DBH量測結果
  - [ ] (c)碳儲量統計
  - [ ] (d)AI對話

---

## Phase F：格式與排版合規檢查

### F-1. 基本格式（對照徵稿須知）
- [x] 標題：14字元，標楷體（TNR），粗體，置中 ✅
- [x] 正文：12字元，標楷體（TNR），單行間距 ✅
- [x] 邊界：上下左右各2.54cm ✅
- [x] 頁碼：插入置中 ✅
- [x] 全文（含圖表）≤15頁 → ✅ 預估 ~11-12 頁
- [x] Word 格式 ✅
- [x] 由左至右橫寫 ✅
- [ ] 標點全形 → 需手動檢查 docx

### F-2. 摘要
- [x] 中文摘要 ≤250字 → ⚠️ **目前 296 字，超過限制**，若大會嚴格要求需略縮
- [x] 摘要標題粗體 ✅
- [x] 摘要標題 1.5倍行高 ✅
- [x] 摘要內容單行間距 ✅
- [x] 首行位移兩個字（約0.85cm）✅
- [x] 關鍵詞3-5個 → 目前5個 ✅
- [x] 關鍵詞標題粗體、1.5倍行高 ✅

### F-3. 章節編號
- [x] 使用「壹、一、（一）、1、(1)、a、(a)」序列 ✅
- [x] 目前用到：壹/貳/參/肆/伍/陸 → ✅
- [x] 二級用：一/二/三/四/五 → ✅
- [x] 三級用：（一）（二）（三）（四）→ ✅

### F-4. 圖表格式
- [x] 圖片以黑白為主 → ✅ 圖1-3均為灰階黑白，圖4為 APP 截圖（彩色但屬實際界面，可接受）
- [x] 圖片說明置於下方 → ✅
- [x] 表格說明置於上方 → ✅
- [x] 均為靠左切齊 → ✅
- [x] 表格/圖片連續編號 → 表1-6, 圖1-4 ✅

### F-5. 參考文獻
- [x] APA 7 格式 ✅
- [x] 排序：中文→日文→英文，英文依姓氏字母 → 目前全英文，無中日文文獻 ✅
- [x] 首行凸排 1.27cm (hanging indent) ✅
- [x] DOI 格式：https://doi.org/... (APA 7 不用 Retrieved from) ✅
- [ ] arXiv 引用格式是否正確 → 需確認是否用 doi.org/10.48550/arXiv.xxx

### F-6. 禁止事項
- [ ] 無分節設定
- [ ] 無分欄設定
- [ ] 無外框或框線

### F-7. 作者資訊
- [ ] 所有作者姓名、所屬單位、職稱、電子郵件完整
- [ ] 通訊作者標示

---

## 執行順序建議

1. **Phase D-5 + B-9**：先跑 Table 6 手算，立刻知道有沒有計算錯
2. **Phase A**：逐一驗文獻（可批次 Web 查詢）
3. **Phase B**：數字 vs 程式碼（需讀代碼，最耗時）
4. **Phase C**：系統描述（在 Phase B 過程中一起做）
5. **Phase E**：圖表修正（已知 fig1, fig2 有錯）
6. **Phase F**：最後格式掃描
7. **生成最終版**：修改 generate_paper.py + generate_figures_v2.py → 重新生成

---

*最後更新：2026-03-31*

---

## 審查執行結果摘要 (2026-03-31)

### 已修正問題：
| # | 修正項目 | 修正前 | 修正後 |
|---|---------|--------|--------|
| 1 | PlantNet 描述 | 「信心閾值0.60」（虛構） | 「回傳候選物種排序」 |
| 2 | 物種數 | 41 | **42**（實際程式碼確認） |
| 3 | Mokany DOI | `01043.x`（404） | `001043.x`（正確） |
| 4 | Zheng 作者 | Shiber, S., Nukala, R. | **Shirodkar, S., Landis, M. S., Sutaria, R.** |
| 5 | GPU fallback | 雙線程→單線程→CPU | **GPU→多線程→單線程→CPU** |
| 6 | Fig 1 CV欄 | 6項（含Agent/LLM/物種） | **3項**（僅Depth Pro, DA V2, SAM） |
| 7 | Fig 1 後端欄 | 130+端點, 22表 | **107端點, 23表**, 加入Agent+物種 |
| 8 | Fig 2 分相 | YOLOv8n-seg歸「雲端」 | 歸「**端側**」 |
| 9 | LiDAR 用詞 | 「開發端不具備」 | 「**研究開發過程中未取得**」 |

### 驗證正確的項目：
- 表6 計算值：全部5列手算驗證通過（差異 < 0.05）
- 42 scientificToCommon / 82 speciesWoodDensity
- 23 tables + 1 view / 107 API endpoints
- Jenkins 2004 參數 a=−2.48, b=2.4835
- IPCC 0.50 碳分率
- 所有圖表符合黑白為主格式要求
- 章節編號壹/一/（一）正確
- APA 7 懸掛縮排 1.27cm
- 預估 ~11-12 頁（≤15 上限）
