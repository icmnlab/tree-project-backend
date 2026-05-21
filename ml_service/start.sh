#!/bin/bash
# ============================================================
# Tree ML Service — Linux 啟動腳本 (Ubuntu Server)
# ============================================================
# 使用方式:
#   cd /opt/tree-app/ml_service
#   ./start.sh                     # 預設模式 (DA V2 Base)
#   ./start.sh --preset pro        # Depth Pro 模式
#   ./start.sh --preset pro_ov     # Depth Pro + OpenVINO
#   ./start.sh --preset openvino   # DA V2 + OpenVINO
#   ./start.sh --verify            # 啟用 numpy 驗證
#   ./start.sh --workers 2         # 多 worker (需較大 RAM)
#   ./start.sh --port 8200         # 自訂 port
#   ./start.sh --debug             # 開啟 /docs
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 解析參數 ---
PRESET="default"
VERIFY=false
DEBUG=false
WORKERS=1
PORT_ARG=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --preset)   PRESET="$2"; shift 2 ;;
        --verify)   VERIFY=true; shift ;;
        --debug)    DEBUG=true; shift ;;
        --workers)  WORKERS="$2"; shift 2 ;;
        --port)     PORT_ARG="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--preset default|pro|openvino|pro_ov] [--verify] [--debug] [--workers N] [--port N]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# --- 載入 .env ---
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo "[config] Loading $ENV_FILE"
    set -a
    # shellcheck disable=SC1090
    source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')
    set +a
fi

# --- 依 Preset 設定模型 ---
case "$PRESET" in
    pro)
        export ML_DEPTH_MODEL="depth_pro"
        export ML_USE_OPENVINO="false"
        echo ""
        echo "  Model: Depth Pro (higher accuracy, slower)"
        ;;
    pro_ov)
        export ML_DEPTH_MODEL="depth_pro"
        export ML_USE_OPENVINO="true"
        echo ""
        echo "  Model: Depth Pro + OpenVINO INT8-W acceleration"
        ;;
    openvino)
        export ML_DEPTH_MODEL="da_v2_base"
        export ML_USE_OPENVINO="true"
        echo ""
        echo "  Model: DA V2 + OpenVINO acceleration"
        ;;
    default)
        : "${ML_DEPTH_MODEL:=da_v2_base}"
        : "${ML_USE_OPENVINO:=false}"
        echo ""
        echo "  Model: $ML_DEPTH_MODEL (default)"
        ;;
    *)
        echo "ERROR: Unknown preset '$PRESET'. Use: default, pro, openvino, pro_ov"
        exit 1
        ;;
esac

# --- Port ---
if [ "$PORT_ARG" -gt 0 ] 2>/dev/null; then
    export PORT="$PORT_ARG"
else
    : "${PORT:=8100}"
fi

# Server-side trunk YOLO letterbox size (align with paper / Windows start.ps1)
: "${ML_SERVER_YOLO_IMGSZ:=832}"

# --- Optional flags ---
: "${ML_ENABLE_SAM:=true}"
: "${ML_SEG_MODEL:=sam2_tiny}"

if [ "$VERIFY" = true ]; then
    export ML_VERIFY_NUMPY="true"
    echo "  Numpy verify: ON"
fi

if [ "$DEBUG" = true ]; then
    export ML_DEBUG="true"
    echo "  Debug (/docs): ON"
fi

# --- 安全檢查 ---
if [ -z "${ML_API_KEY:-}" ]; then
    echo ""
    echo "  WARNING: ML_API_KEY not set — endpoints are unprotected!"
    echo "  Set it in .env or run: export ML_API_KEY='your-key'"
fi

# --- 啟動準備 (Python 路徑) ---
cd "$SCRIPT_DIR"
if [ -n "${VIRTUAL_ENV:-}" ]; then
    PYTHON_EXE="python3"
elif [ -f "$SCRIPT_DIR/venv/bin/python3" ]; then
    PYTHON_EXE="$SCRIPT_DIR/venv/bin/python3"
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/venv/bin/activate"
else
    PYTHON_EXE="python3"
fi

# --- GPU 偵測 ---
GPU_INFO=$($PYTHON_EXE -c "
try:
    import torch
    if hasattr(torch, 'xpu') and torch.xpu.is_available():
        name = torch.xpu.get_device_properties(0).name
        mem = torch.xpu.get_device_properties(0).total_memory / (1024**3)
        print(f'Intel XPU: {name} ({mem:.1f} GB)')
    elif torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        mem = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f'CUDA: {name} ({mem:.1f} GB)')
    else:
        print('CPU only')
except:
    print('CPU only')
" 2>/dev/null || echo "CPU only")

# --- 摘要 ---
echo ""
echo "  ========================================="
echo "  Tree ML Service (Linux)"
echo "  -----------------------------------------"
echo "  Port:      $PORT"
echo "  Model:     $ML_DEPTH_MODEL"
echo "  OpenVINO:  $ML_USE_OPENVINO"
echo "  YOLO imgsz: ${ML_SERVER_YOLO_IMGSZ}"
echo "  SAM:       $ML_ENABLE_SAM ($ML_SEG_MODEL)"
echo "  API Key:   ${ML_API_KEY:+${ML_API_KEY:0:8}...}"
[ -z "${ML_API_KEY:-}" ] && echo "  API Key:   NOT SET"
echo "  Workers:   $WORKERS"
echo "  GPU:       $GPU_INFO"
echo "  ========================================="
echo ""

# --- 清理殘留 process ---
echo "  [Cleanup] Checking for ghost processes on port $PORT..."
EXISTING_PID=$(lsof -ti:"$PORT" 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
    echo "  [Cleanup] Port $PORT in use by PID $EXISTING_PID. Killing..."
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 1
fi

# --- 自動檢查套件 ---
echo "  [Check] Verifying Python dependencies..."
if ! $PYTHON_EXE -c "import fastapi, uvicorn, pydantic" 2>/dev/null; then
    echo "  [Check] Missing critical dependencies. Installing..."
    $PYTHON_EXE -m pip install -r requirements_sota.txt
fi

# --- 自動檢查模型 ---
echo "  [Check] Verifying AI models..."
MODELS_PATH="$SCRIPT_DIR/models"
if [ ! -d "$MODELS_PATH/depth_pro_pt" ] && [ ! -d "$MODELS_PATH/sam2_tiny_pt" ]; then
    echo "  [Check] Models are missing! Downloading..."
    $PYTHON_EXE setup_models.py
fi

# --- 自動啟動 Ngrok (如已設定 ngrok 域名) ---
if [ -n "${ML_SERVICE_URL:-}" ] && echo "$ML_SERVICE_URL" | grep -q "ngrok-free.dev"; then
    DOMAIN=$(echo "$ML_SERVICE_URL" | sed 's|https://||;s|http://||')
    echo ""
    echo "  [Ngrok] Starting ngrok tunnel to $DOMAIN..."
    ngrok http --url="$DOMAIN" "$PORT" --log stdout &
fi

# --- 防止系統睡眠 ---
echo "  [Power] Preventing system sleep..."
if command -v systemd-inhibit &>/dev/null; then
    # systemd-inhibit 會 wrap uvicorn，系統不會休眠
    echo "  [Uvicorn] Starting API server (sleep inhibited)..."
    exec systemd-inhibit --what=idle:sleep --who="Tree ML Service" --why="Running inference server" \
        $PYTHON_EXE -m uvicorn app:app --host 127.0.0.1 --port "$PORT" --workers "$WORKERS"
else
    # Fallback: 使用 caffeinate (macOS) 或直接啟動
    if command -v caffeinate &>/dev/null; then
        echo "  [Uvicorn] Starting API server (caffeinate)..."
        exec caffeinate -s $PYTHON_EXE -m uvicorn app:app --host 127.0.0.1 --port "$PORT" --workers "$WORKERS"
    else
        echo "  [Uvicorn] Starting API server..."
        exec $PYTHON_EXE -m uvicorn app:app --host 127.0.0.1 --port "$PORT" --workers "$WORKERS"
    fi
fi
