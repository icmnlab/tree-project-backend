# ============================================================
# Tree ML Service — Windows 啟動腳本
# ============================================================
# 使用方式:
#   cd backend\ml_service
#   .\start.ps1                  # 預設模式 (DA3 + OpenVINO NPU)
#   .\start.ps1 -Preset pro      # Depth Pro 模式 (PyTorch)
#   .\start.ps1 -Preset pro_ov   # Depth Pro + OpenVINO INT8-W
#   .\start.ps1 -Preset da3      # DA3 Metric Large + OpenVINO FP16 NPU
#   .\start.ps1 -Da3Device NPU    # DA3 OpenVINO on Intel AI Boost NPU
#   .\start.ps1 -Da3Ir 602x448    # DA3 high-res IR (patch-14 aligned)
#   .\start.ps1 -Verify          # 啟用 numpy 驗證
#   .\start.ps1 -Workers 2       # 多 worker (需較大 RAM)
# ============================================================

param(
    [ValidateSet('default', 'pro', 'openvino', 'pro_ov', 'da3')]
    [string]$Preset = 'da3',

    [switch]$Verify,
    [switch]$Debug,
    [int]$Workers = 1,
    [int]$Port = 0,

    [ValidateSet('AUTO', 'GPU', 'NPU', 'CPU')]
    [string]$Da3Device = 'NPU',

    [ValidateSet('504x378', '602x448')]
    [string]$Da3Ir = '504x378',

    [string]$ServerYoloDevice = 'intel:gpu',

    # Force server-side YOLOv8-seg for every /auto_measure_dbh call,
    # ignoring any phone-supplied trunk_mask_base64. Detection-only is the
    # current production path; pass -ForceServerYolo:$false to disable.
    [bool]$ForceServerYolo = $true
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ScriptDir '.env'

# --- 載入 .env ---
if (Test-Path $EnvFile) {
    Write-Host "[config] Loading $EnvFile" -ForegroundColor DarkGray
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $parts = $line -split '=', 2
            if ($parts.Count -eq 2 -and $parts[0].Trim() -and $parts[1].Trim()) {
                $name = $parts[0].Trim()
                # Don't override variables that are already set in the parent shell.
                # This lets the matrix benchmark driver inject ML_DEPTH_MODEL etc.
                if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
                    [Environment]::SetEnvironmentVariable($name, $parts[1].Trim(), 'Process')
                }
            }
        }
    }
}

# --- 依 Preset 設定模型 ---
switch ($Preset) {
    'pro' {
        $env:ML_DEPTH_MODEL = 'depth_pro'
        $env:ML_USE_OPENVINO = 'false'
        Write-Host "`n  Model: Depth Pro (higher accuracy, slower)" -ForegroundColor Cyan
    }
    'pro_ov' {
        $env:ML_DEPTH_MODEL = 'depth_pro'
        $env:ML_USE_OPENVINO = 'true'
        Write-Host "`n  Model: Depth Pro + OpenVINO INT8-W iGPU acceleration" -ForegroundColor Cyan
    }
    'openvino' {
        $env:ML_DEPTH_MODEL = 'da_v2_base'
        $env:ML_USE_OPENVINO = 'true'
        Write-Host "`n  Model: DA V2 + OpenVINO iGPU acceleration" -ForegroundColor Cyan
    }
    'da3' {
        # DA3METRIC-LARGE (ICLR 2026 Oral) + OpenVINO FP16 on Intel AI Boost NPU by default.
        # OV IR auto-loaded by depth_estimation._try_load_da3 if present at
        #   openvino_models/da3_metric_large/openvino_model.xml
        # (export it via: python da3_to_openvino.py)
        # Falls back to PyTorch CPU if IR missing or load fails.
        # ML_USE_OPENVINO is informational here — DA3 OV path is auto-detected.
        $env:ML_DEPTH_MODEL = 'da3_metric_large'
        $env:ML_USE_OPENVINO = 'true'
        $env:ML_DA3_OV_DEVICE = $Da3Device
        if ($Da3Ir -eq '602x448') {
            $env:ML_DA3_OV_DIR = 'openvino_models\da3_metric_large_602x448'
        } else {
            $env:ML_DA3_OV_DIR = 'openvino_models\da3_metric_large'
        }
        Write-Host "`n  Model: DA3 Metric Large + OpenVINO FP16 ($Da3Device, $Da3Ir)" -ForegroundColor Cyan
        $da3OvXml = Join-Path $ScriptDir (Join-Path $env:ML_DA3_OV_DIR 'openvino_model.xml')
        if (Test-Path $da3OvXml) {
            Write-Host "  DA3 OV IR: found ($Da3Ir FP16, device=$Da3Device)" -ForegroundColor Green
        } else {
            Write-Host "  DA3 OV IR: NOT FOUND — will fall back to PyTorch CPU" -ForegroundColor Yellow
            Write-Host "  Run: python da3_to_openvino.py  to export." -ForegroundColor DarkGray
        }
    }
    default {
        if (-not $env:ML_DEPTH_MODEL) { $env:ML_DEPTH_MODEL = 'da_v2_base' }
        if (-not $env:ML_USE_OPENVINO) { $env:ML_USE_OPENVINO = 'false' }
        Write-Host "`n  Model: $($env:ML_DEPTH_MODEL) (default)" -ForegroundColor Cyan
    }
}

# --- Port ---
if ($Port -gt 0) {
    $env:PORT = "$Port"
} elseif (-not $env:PORT) {
    $env:PORT = '8100'
}

# --- Optional flags ---
# Trunk masks now come from YOLOv8-seg. The legacy segmentation switch is kept
# off so old .env values cannot reactivate the retired segmentation path.
$env:ML_ENABLE_SAM = 'false'
$env:ML_SEG_MODEL = 'server_yolo_v8_seg'
if (-not $env:ML_SERVER_YOLO_DEVICE) { $env:ML_SERVER_YOLO_DEVICE = $ServerYoloDevice }
if (-not $env:ML_SERVER_YOLO_IMGSZ)  { $env:ML_SERVER_YOLO_IMGSZ = '832' }

if ($ForceServerYolo) {
    $env:ML_FORCE_SERVER_YOLO = 'true'
    Write-Host "  Force server YOLO: ON (detection-only mode; phone masks ignored)" -ForegroundColor Yellow
}

if ($Verify) {
    $env:ML_VERIFY_NUMPY = 'true'
    Write-Host "  Numpy verify: ON" -ForegroundColor Yellow
}

if ($Debug) {
    $env:ML_DEBUG = 'true'
    Write-Host "  Debug (/docs): ON" -ForegroundColor Yellow
}

# --- 安全檢查 ---
if (-not $env:ML_API_KEY) {
    Write-Host "`n  WARNING: ML_API_KEY not set — endpoints are unprotected!" -ForegroundColor Red
    Write-Host "  Set it in .env or run: `$env:ML_API_KEY='your-key'" -ForegroundColor DarkGray
}

# --- 摘要 ---
Write-Host ""
Write-Host "  ========================================" -ForegroundColor DarkCyan
Write-Host "  Tree ML Service" -ForegroundColor White
Write-Host "  ----------------------------------------" -ForegroundColor DarkCyan
Write-Host "  Port:      $($env:PORT)" -ForegroundColor White
Write-Host "  Model:     $($env:ML_DEPTH_MODEL)" -ForegroundColor White
Write-Host "  OpenVINO:  $($env:ML_USE_OPENVINO)" -ForegroundColor White
Write-Host "  DA3 IR:    $($env:ML_DA3_OV_DIR)" -ForegroundColor White
Write-Host "  DA3 Device:$($env:ML_DA3_OV_DEVICE)" -ForegroundColor White
Write-Host "  Trunk mask: server YOLOv8-seg (per request)" -ForegroundColor White
Write-Host "  Mask Device: device=$($env:ML_SERVER_YOLO_DEVICE), imgsz=$($env:ML_SERVER_YOLO_IMGSZ)" -ForegroundColor White
Write-Host "  API Key:   $(if ($env:ML_API_KEY) { $env:ML_API_KEY.Substring(0,8) + '...' } else { 'NOT SET' })" -ForegroundColor $(if ($env:ML_API_KEY) { 'White' } else { 'Red' })
Write-Host "  Workers:   $Workers" -ForegroundColor White

# --- 啟動準備 (先決定 PythonExe，GPU 偵測需要) ---
Set-Location $ScriptDir
if ($env:VIRTUAL_ENV) {
    $PythonExe = "python"
} elseif (Test-Path "$ScriptDir\venv\Scripts\python.exe") {
    $PythonExe = "$ScriptDir\venv\Scripts\python.exe"
} else {
    $PythonExe = "python"
}

$openvinoDevices = $null
try {
    $openvinoDevices = & $PythonExe -c "
try:
    from openvino import Core
    print(', '.join(Core().available_devices))
except Exception:
    print('unavailable')
" 2>$null
} catch {
    $openvinoDevices = 'unavailable'
}

# --- GPU 偵測 ---
# 使用 try/catch + 暫時放寬 ErrorActionPreference，避免 torch 的 stderr warning
# (例如 "XPU device count is zero") 被 $ErrorActionPreference='Stop' 當成致命錯誤終止腳本。
$gpuInfo = $null
try {
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # 用環境變數抑制 Python warnings + 同時把 stderr 丟掉
    $env:PYTHONWARNINGS = 'ignore'
    $gpuInfo = & $PythonExe -c "
import warnings
warnings.filterwarnings('ignore')
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
except Exception:
    print('CPU only')
" 2>$null
} catch {
    $gpuInfo = 'CPU only (detection skipped)'
} finally {
    $ErrorActionPreference = $prevPref
}
if (-not $gpuInfo) { $gpuInfo = 'CPU only' }
$gpuColor = if ($gpuInfo -and $gpuInfo -notmatch 'CPU only') { 'Green' } else { 'DarkGray' }
Write-Host "  OpenVINO devices: $openvinoDevices" -ForegroundColor $(if ($openvinoDevices -match 'NPU') { 'Green' } else { 'DarkGray' })
Write-Host "  PyTorch device:   $gpuInfo" -ForegroundColor $gpuColor

Write-Host "  ========================================" -ForegroundColor DarkCyan
Write-Host ""

# --- 自動清理殘留的 Process (解決 Port 衝突) ---
Write-Host "`n  [Cleanup] Checking for ghost processes..." -ForegroundColor DarkGray
# 關閉可能卡住的 ngrok
$ngrokProcesses = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue
if ($ngrokProcesses) {
    Write-Host "  [Cleanup] Killing ghost ngrok processes..." -ForegroundColor Yellow
    Stop-Process -Name "ngrok" -Force
}
# 檢查是否有其他程式佔用 8100 port
$portInUse = Get-NetTCPConnection -LocalPort $env:PORT -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "  [Cleanup] Port $($env:PORT) is in use. Attempting to kill occupying process..." -ForegroundColor Yellow
    $pidToKill = $portInUse.OwningProcess
    if ($pidToKill -ne $PID) {
        Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
    }
}

# --- 自動檢查套件 (依賴) ---
Write-Host "`n  [Check] Verifying Python dependencies..." -ForegroundColor DarkGray
& $PythonExe -c "import fastapi, uvicorn, pydantic, websockets" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [Check] Missing critical dependencies. Installing automatically..." -ForegroundColor Yellow
    & $PythonExe -m pip install -r requirements_sota.txt
}

# --- 自動檢查模型 (Models) ---
Write-Host "  [Check] Verifying AI models..." -ForegroundColor DarkGray
$Da3ModelXml = Join-Path $ScriptDir (Join-Path $env:ML_DA3_OV_DIR 'openvino_model.xml')
$ServerYoloDir = Join-Path $ScriptDir 'trunk_detector_training\tree_trunk_seg_best_openvino_model'
$ServerYoloXml = Join-Path $ServerYoloDir 'tree_trunk_seg_best.xml'
$ServerYoloBestXml = Join-Path $ServerYoloDir 'best.xml'
if ($env:ML_DEPTH_MODEL -eq 'da3_metric_large' -and -not (Test-Path $Da3ModelXml)) {
    Write-Host "  [Check] DA3 OpenVINO IR missing: $Da3ModelXml" -ForegroundColor Yellow
    Write-Host "  [Check] Run: python da3_to_openvino.py" -ForegroundColor DarkGray
}
if (-not (Test-Path $ServerYoloXml) -and -not (Test-Path $ServerYoloBestXml)) {
    Write-Host "  [Check] Server YOLO OpenVINO IR missing: $ServerYoloDir" -ForegroundColor Yellow
}

# --- 自動啟動 Ngrok (可選) ---
if ($env:ML_SERVICE_URL -and $env:ML_SERVICE_URL -match "ngrok-free\.dev") {
    $domain = $env:ML_SERVICE_URL.Replace("https://", "").Replace("http://", "")
    Write-Host "`n  [Ngrok] Starting ngrok tunnel to $domain..." -ForegroundColor Yellow
    # 啟動 ngrok 在背景執行 (確保在 uvicorn 之前執行)
    Start-Process ngrok -ArgumentList "http --url=$domain $env:PORT --log stdout" -NoNewWindow
}

# --- 啟動 Uvicorn 伺服器 ---
Write-Host "`n  [Uvicorn] Starting API server..." -ForegroundColor Green

# --- 防止系統睡眠（螢幕可以關，但系統不會休眠）---
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED = 0x80000001
Write-Host "  [Power] Preventing system sleep (screen can turn off)..." -ForegroundColor DarkGray
$sleepGuardCode = @"
using System;
using System.Runtime.InteropServices;
public class SleepGuard {
    [DllImport("kernel32.dll")]
    static extern uint SetThreadExecutionState(uint esFlags);
    public static void Prevent() { SetThreadExecutionState(0x80000001); }
    public static void Restore() { SetThreadExecutionState(0x80000000); }
}
"@
try {
    Add-Type -TypeDefinition $sleepGuardCode -ErrorAction SilentlyContinue
    [SleepGuard]::Prevent()
} catch {}

try {
    & $PythonExe -m uvicorn app:app --host 0.0.0.0 --port $env:PORT --workers $Workers
} finally {
    # 還原電源設定（不論是正常結束或 Ctrl+C）
    Write-Host "`n  [Power] Restoring system sleep settings..." -ForegroundColor DarkGray
    try { [SleepGuard]::Restore() } catch {}
}

