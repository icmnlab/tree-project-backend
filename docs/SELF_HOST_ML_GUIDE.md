# 自架 ML Service 指南

> 🚧 **狀態：目前停用，保留供未來開發。**
> 視覺 DBH 量測／ML Service（`backend/ml_service/`）未納入目前交接的穩定版本；程式碼與本指南
> 保留於 repo 供後續接手者繼續開發。穩定版的 DBH 以人工量測輸入，不依賴本服務。

## 架構總覽

```
┌─────────────────────────────────────────────────────────┐
│                    Render (免費方案)                      │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │  Node.js Backend    │  │  PostgreSQL Database     │  │
│  │  (tree-app-backend) │  │  (Basic-256mb)           │  │
│  │  Free plan          │  │                          │  │
│  └─────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                        │
                        │ API calls
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   自架 ML Service                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  MacBook Pro 2012 (推薦)                         │    │
│  │  - i7 2.3GHz 四核心, 8GB RAM                     │    │
│  │  - FastAPI + PyTorch (Depth Anything V2 Small)   │    │
│  │  - 推論時間: ~15-25 秒 (比 Render 快)             │    │
│  │  - 透過 ngrok / Cloudflare Tunnel 對外           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  備用: Acer Aspire S3 (i3, 12GB RAM)             │    │
│  │  - 可跑但較慢 (~30-50 秒)                        │    │
│  │  - 適合跑 Backend，不適合跑 ML                    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 省錢效果

| 項目 | 目前 (Render) | 自架後 |
|------|-------------|--------|
| Backend | Free ($0) | Free ($0) - 維持 Render |
| ML Service | Starter ($7/月) | **$0** - 自架 |
| Database | Basic-256mb ($0) | Basic-256mb ($0) - 維持 Render |
| ngrok | 免費方案即可 | $0 |
| **月費總計** | **$7/月** | **$0/月** |

## 硬體對比

| | MacBook Pro 2012 | Acer Aspire S3 |
|---|---|---|
| CPU | i7 2.3GHz 四核心 | i3（~2核） |
| RAM | 8GB DDR3 | 12GB（自升級） |
| OS | macOS Sonoma 14.8.2 | Windows / Linux |
| **ML 推論速度** | **~15-25 秒** ✅ | ~30-50 秒 ⚠️ |
| **推薦用途** | **ML Service** | Node.js Backend (未來) |

## 終極目標架構（兩台都用）

等回學校後，可以把兩台都用上：
- **MacBook Pro** → ML Service (FastAPI + PyTorch)
- **Acer Aspire S3** → Node.js Backend + PostgreSQL
- 完全脫離 Render，月費 $0

---

## MacBook Pro 設定步驟

### 1. 安裝 Python 環境

```bash
# 安裝 Homebrew（如果還沒有）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安裝 Python 3.11
brew install python@3.11

# 確認版本
python3.11 --version
```

### 2. 建立專案環境

```bash
# 建立工作目錄
mkdir -p ~/tree-ml-service
cd ~/tree-ml-service

# 建立虛擬環境
python3.11 -m venv venv
source venv/bin/activate

# 複製 ML 服務程式碼（從 Git repo）
git clone https://github.com/<GITHUB_OWNER>/tree-project-backend.git
cd tree-project-backend/ml_service

# 安裝依賴（CPU 版本 PyTorch，不需要 GPU）
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. 預下載模型權重

```bash
# 預下載 Depth Anything V2 模型（約 100MB）
python -c "
from transformers import AutoImageProcessor, AutoModelForDepthEstimation
print('下載模型中...')
AutoImageProcessor.from_pretrained('depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf')
AutoModelForDepthEstimation.from_pretrained('depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf')
print('模型下載完成！')
"
```

### 4. 啟動 ML Service

```bash
# 開發模式（看 log）
cd ~/tree-ml-service/tree-project-backend/ml_service
source ~/tree-ml-service/venv/bin/activate

# 用 uvicorn 直接跑（開發）
uvicorn app:app --host 0.0.0.0 --port 8000

# 或用 gunicorn（正式）
gunicorn app:app --workers 1 --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 --timeout 120
```

驗證：瀏覽器打開 `http://localhost:8000/health`，應該看到：
```json
{"status": "ok", "model_loaded": true}
```

### 5. 用 ngrok 對外暴露

```bash
# 安裝 ngrok
brew install ngrok

# 註冊免費帳號 https://ngrok.com 取得 authtoken
ngrok config add-authtoken <YOUR_TOKEN>

# 啟動 tunnel
ngrok http 8000
```

ngrok 會給你一個公開 URL，例如：
```
https://xxxx-xxxx-xxxx.ngrok-free.app
```

**記下這個 URL，下一步要用。**

> ⚠️ ngrok 免費版每次重啟 URL 會變。可考慮：
> - ngrok 固定域名（免費方案可設一個）：`ngrok http 8000 --domain=your-name.ngrok-free.app`
> - 或用 Cloudflare Tunnel（完全免費 + 固定域名，需要自己的域名）

### 6. 更新 Frontend 設定

在 `frontend/lib/config/app_config.dart` 中更新 `mlServiceUrl`：

```dart
// 改為你的 ngrok URL
mlServiceUrl = 'https://xxxx-xxxx-xxxx.ngrok-free.app/api/v1';
```

或更好的做法 — 加入環境變數切換（見下方進階設定）。

---

## 進階：一鍵啟動腳本

在 MacBook 上建立 `~/tree-ml-service/start.sh`：

```bash
#!/bin/bash
echo "🌲 啟動 Tree ML Service..."

cd ~/tree-ml-service/tree-project-backend/ml_service
source ~/tree-ml-service/venv/bin/activate

# 設定環境變數
export TRANSFORMERS_CACHE=~/.cache/huggingface
export HF_HOME=~/.cache/huggingface

# 啟動服務（背景）
gunicorn app:app \
  --workers 1 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 120 \
  --daemon \
  --pid /tmp/tree-ml.pid \
  --access-logfile ~/tree-ml-service/access.log \
  --error-logfile ~/tree-ml-service/error.log

echo "✅ ML Service 已啟動 (port 8000)"
echo "📋 PID: $(cat /tmp/tree-ml.pid)"

# 啟動 ngrok（如果有設定固定域名）
# ngrok http 8000 --domain=your-name.ngrok-free.app &

echo "🔗 請手動啟動 ngrok: ngrok http 8000"
```

```bash
chmod +x ~/tree-ml-service/start.sh
```

## 停止服務

```bash
# 停止 gunicorn
kill $(cat /tmp/tree-ml.pid)

# 停止 ngrok
# Ctrl+C 或 kill ngrok 程序
```

## 更新程式碼

```bash
cd ~/tree-ml-service/tree-project-backend
git pull origin main
# 重啟服務
kill $(cat /tmp/tree-ml.pid)
~/tree-ml-service/start.sh
```

---

## 切換回 Render（備用）

如果 MacBook 關機或不方便自架，隨時可以切回 Render：

1. `render.yaml` 中 ML service 改回 `plan: starter`
2. `app_config.dart` 中 `mlServiceUrl` 改回 `https://tree-app-ml-service.onrender.com/api/v1`
3. Push & deploy

---

## Troubleshooting

| 問題 | 解決方案 |
|------|---------|
| `python3.11: command not found` | `brew install python@3.11` 然後 `export PATH="/opt/homebrew/bin:$PATH"` |
| PyTorch 安裝失敗 | macOS 12+ 用 `pip install torch torchvision`（不需 CUDA） |
| ngrok URL 變了 | 用固定域名 `ngrok http 8000 --domain=xxx.ngrok-free.app` |
| 模型載入很慢 | 第一次約 30 秒，之後就快了（已快取） |
| RAM 不夠 | Depth Anything V2 Small 只需 ~500MB，8GB 綽綽有餘 |
| macOS 睡眠斷線 | 系統偏好設定 → 節能 → 取消勾選「如果可能，讓硬碟進入睡眠」 |
| MacBook 蓋上蓋子斷線 | 安裝 `brew install --cask amphetamine` 防止睡眠 |

## 注意事項

- MacBook 需要保持開機 + 連網
- 建議接電源（長時間推論耗電）
- ngrok 免費版有流量限制（每月約 1GB），正常使用不會超過
- 如果在學校用，確保校園網路允許 ngrok 穿透
