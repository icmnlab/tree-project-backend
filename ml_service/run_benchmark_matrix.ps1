# =============================================================
# run_benchmark_matrix.ps1
# -------------------------------------------------------------
# Runs the Xiang DBH benchmark across multiple depth models x
# segmentation modes x distance modes, fully unattended.
#
# For each depth model:
#   1. Stop running uvicorn (if any)
#   2. Set $env:ML_DEPTH_MODEL and start ml_service in background
#   3. Wait for /health to come up and to report the expected model
#   4. Run the four (mask x dist) cases sequentially
#   5. Move on to next model
#
# Outputs:
#   benchmark_matrix/<model>__<mask>__<dist>.csv
#   benchmark_matrix/<model>__<mask>__<dist>.json
#   benchmark_matrix/<model>__service.log
#
# Usage:
#   cd C:\projects\tree_project\project_code\backend\ml_service
#   .\run_benchmark_matrix.ps1                 # full matrix
#   .\run_benchmark_matrix.ps1 -Limit 5        # smoke test
#   .\run_benchmark_matrix.ps1 -Models depth_pro,da_v2_small
# =============================================================
[CmdletBinding()]
param(
    [string[]]$Models = @('da_v2_small','da_v2_base','da_v2_large','depth_pro'),
    [int]$Limit = 0,                       # 0 = all 294 photos
    [int]$HealthTimeoutSec = 600,          # 10 min for big models / first-time download
    [string]$Url = 'http://127.0.0.1:8100',
    [string]$OutDir = 'benchmark_matrix',
    [int]$PerCaseTimeoutSec = 180,
    [switch]$SkipExisting                  # skip configs whose CSV already exists
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory $OutDir | Out-Null }

# Mapping: model key -> /health.model substring used to verify load
$ExpectModel = @{
    'da_v2_small'  = 'Small'
    'da_v2_base'   = 'Base'
    'da_v2_large'  = 'Large'
    'depth_pro'    = 'Depth Pro'
    'metric3d_v2'  = 'Metric3D'
    'unidepth_v2'  = 'UniDepth'
}

$cases = @(
    @{ tag='nomask__nodist';  ref=$false; mask=$false },
    @{ tag='nomask__refdist'; ref=$true;  mask=$false },
    @{ tag='gtmask__nodist';  ref=$false; mask=$true  },
    @{ tag='gtmask__refdist'; ref=$true;  mask=$true  }
)

function Stop-MLService {
    Get-Process -Name 'python','python3' -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'uvicorn|app:app' -or $_.MainWindowTitle -match 'ml_service' } |
        ForEach-Object {
            Write-Host "[matrix] Stopping uvicorn pid=$($_.Id)" -ForegroundColor Yellow
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    # Also kill anything bound to the port
    $conn = Get-NetTCPConnection -LocalPort 8100 -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($conn) {
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Seconds 2
}

function Start-MLService {
    param([string]$Model, [string]$LogPath)
    Write-Host "[matrix] Starting ml_service with ML_DEPTH_MODEL=$Model" -ForegroundColor Cyan
    # Build a single-line command for Start-Process
    $cmd = @(
        "`$env:ML_DEPTH_MODEL='$Model';"
        "`$env:ML_ENABLE_SAM='false';"
        "`$env:ML_SEG_MODEL='depth_heuristic';"
        ".\start.ps1 *>&1 | Tee-Object -FilePath '$LogPath'"
    ) -join ' '
    return Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile','-NoExit','-Command', $cmd) `
        -WorkingDirectory $here `
        -PassThru `
        -WindowStyle Minimized
}

function Wait-HealthOk {
    param([string]$Expect, [int]$TimeoutSec)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $h = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 5 -ErrorAction Stop
            if ($h.status -eq 'ok' -and $h.model -match $Expect) {
                Write-Host "[matrix]   /health OK -> $($h.model) ($($h.model_params_m)M)" -ForegroundColor Green
                return $true
            }
            Write-Host "[matrix]   /health up but model='$($h.model)', waiting for '$Expect'..."
        } catch {
            Write-Host "[matrix]   waiting for /health..."
        }
        Start-Sleep -Seconds 5
    }
    return $false
}

# ---------- main loop ----------
$matrixStart = Get-Date
$results = @()

foreach ($model in $Models) {
    if (-not $ExpectModel.ContainsKey($model)) {
        Write-Warning "Unknown model key '$model' — skipping. Add to `$ExpectModel mapping if needed."
        continue
    }
    $expect = $ExpectModel[$model]

    Write-Host ("`n" + ("=" * 70)) -ForegroundColor Magenta
    Write-Host (" MODEL: $model   (expecting /health.model contains '$expect')") -ForegroundColor Magenta
    Write-Host ("=" * 70) -ForegroundColor Magenta

    $logPath = Join-Path $OutDir "$model`__service.log"
    Stop-MLService
    $null = Start-MLService -Model $model -LogPath $logPath
    Start-Sleep -Seconds 6
    $ready = Wait-HealthOk -Expect $expect -TimeoutSec $HealthTimeoutSec
    if (-not $ready) {
        Write-Warning "[matrix] $model failed to come up within $HealthTimeoutSec s. Skipping."
        $results += [pscustomobject]@{ model=$model; tag='startup_failed'; ok=$false }
        Stop-MLService
        continue
    }

    foreach ($c in $cases) {
        $tag    = "$model`__$($c.tag)"
        $csvOut = Join-Path $OutDir "$tag.csv"
        if ($SkipExisting -and (Test-Path $csvOut)) {
            Write-Host "[matrix] [$tag] CSV exists, skipping (-SkipExisting)" -ForegroundColor DarkGray
            continue
        }
        $argList = @(
            'benchmark_xiang.py',
            '--url', $Url,
            '--out', $csvOut,
            '--tag', $tag,
            '--expect-model', $expect,
            '--timeout', $PerCaseTimeoutSec
        )
        if ($Limit -gt 0)  { $argList += @('--limit', $Limit) }
        if ($c.ref)        { $argList += '--use-ref-distance' }
        if ($c.mask)       { $argList += '--use-gt-mask' }

        Write-Host "`n[matrix] >>> $tag" -ForegroundColor Cyan
        $caseStart = Get-Date
        & .\venv\Scripts\python.exe @argList
        $caseSec = ((Get-Date) - $caseStart).TotalSeconds
        $results += [pscustomobject]@{
            model = $model; tag = $tag; ok = ($LASTEXITCODE -eq 0)
            wall_s = [int]$caseSec
        }
    }

    Stop-MLService
}

$totalSec = ((Get-Date) - $matrixStart).TotalSeconds
Write-Host "`n[matrix] DONE in $([int]$totalSec)s" -ForegroundColor Green
$results | Format-Table -AutoSize
$results | Export-Csv -Path (Join-Path $OutDir '_matrix_summary.csv') -NoTypeInformation -Encoding UTF8
Write-Host "[matrix] Summary CSV: $(Join-Path $OutDir '_matrix_summary.csv')"
