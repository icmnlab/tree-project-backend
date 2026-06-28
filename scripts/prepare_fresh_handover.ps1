# Prepare a clean orphan branch for handover push (no prior commit history).
# Usage:
#   cd backend
#   .\scripts\prepare_fresh_handover.ps1
#   git remote add recipient https://github.com/<RECIPIENT>/tree-project-backend.git
#   git push recipient handover:main
#   git checkout main

param(
    [string]$BranchName = 'handover'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $PSScriptRoot '..\package.json'))) {
    Write-Error 'Run from tree-project-backend repo root (backend/).'
}

Set-Location (Join-Path $PSScriptRoot '..')

$dirty = git status --porcelain
if ($dirty) {
    Write-Error "Working tree not clean. Commit or stash changes first.`n$dirty"
}

git checkout main | Out-Null

if (git rev-parse --verify $BranchName 2>$null) {
    git branch -D $BranchName | Out-Null
}

git checkout --orphan $BranchName | Out-Null
git add -A

$msg = @(
    'Initial handover snapshot (2026-06)',
    '',
    'Copyright (c) 2025 KyleliuNDHU. See LICENSE and AUTHORS.md.',
    '',
    'Original development and primary maintenance by KyleliuNDHU.',
    'Fresh history push without prior commit log (LAB_DEPLOYMENT_GUIDE.md section 0.1).'
) -join "`n"

git commit -m $msg

Write-Host ''
Write-Host 'Orphan branch ready:' -ForegroundColor Green
Write-Host "  Branch: $BranchName"
Write-Host '  Next:'
Write-Host '    git remote add recipient https://github.com/<RECIPIENT>/tree-project-backend.git'
Write-Host "    git push recipient ${BranchName}:main"
Write-Host '    git checkout main'
Write-Host ''
Write-Host 'Before pushing: export private git log for your records (see AUTHORS.md).' -ForegroundColor Yellow
