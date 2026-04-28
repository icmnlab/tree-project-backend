# ============================================================
# Tree ML Service — Windows 啟動腳本
# ============================================================
# 使用方式:
#   cd backend\ml_service
#   .\start.ps1                  # 預設模式 (DA V2 Base)
#   .\start.ps1 -Preset pro      # Depth Pro 模式 (PyTorch)
#   .\start.ps1 -Preset pro_ov   # Depth Pro + OpenVINO INT8-W (推薦)
#   .\start.ps1 -Verify          # 啟用 numpy 驗證
#   .\start.ps1 -Workers 2       # 多 worker (需較大 RAM)
# ============================================================

param(
    [ValidateSet('default', 'pro', 'openvino', 'pro_ov')]
    [string]$Preset = 'pro_ov',

    [switch]$Verify,
    [switch]$Debug,
    [int]$Workers = 1,
    [int]$Port = 0
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
                [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
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
# SAM segmentation removed (2026-04-28). Trunk segmentation is now
# performed exclusively on-device with YOLOv8-seg; the phone uploads the
# binary mask via trunk_mask_base64. Server-side SAM is hard-disabled.
$env:ML_ENABLE_SAM = 'false'
if (-not $env:ML_SEG_MODEL)    { $env:ML_SEG_MODEL = 'depth_heuristic' }

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
Write-Host "  Segmentation: on-device YOLOv8-seg (server SAM disabled)" -ForegroundColor White
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
Write-Host "  GPU:       $gpuInfo" -ForegroundColor $gpuColor

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
$ModelsPath = Join-Path $ScriptDir "models"
if (-not (Test-Path "$ModelsPath\depth_pro_pt") -and -not (Test-Path "$ModelsPath\sam2_tiny_pt")) {
    Write-Host "  [Check] Models are missing! Automatically downloading and setting up models..." -ForegroundColor Yellow
    & $PythonExe setup_models.py
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

