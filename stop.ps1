<#
.SYNOPSIS
    LogiTrace 一键停止：停实时推流模拟器（+ 可选前端）+ 停容器。

.DESCRIPTION
    与 start.ps1 对称。默认不碰前端 dev server（通常在 IDE 里跑着，不该被脚本杀掉），
    需要连前端一起停时加 -WithFrontend。

    容器用 docker compose down 停止：数据卷（mysql-data / redis-data）保留，
    下次 start.ps1 起来数据还在；要连数据一起清用 -RemoveVolumes（慎用）。

.PARAMETER WithFrontend
    同时停掉前端 dev server（vite / pnpm dev）。

.PARAMETER RemoveVolumes
    停止容器时一并删除数据卷（docker compose down -v），会清空库里的数据。
#>
param(
    [switch]$WithFrontend,
    [switch]$RemoveVolumes
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$deploy = Join-Path $root 'deploy'

function Write-Step($msg) { Write-Host "[stop] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK   $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  --   $msg" -ForegroundColor DarkGray }

# ---------- 1. 停模拟器 ----------
Write-Step 'stopping position stream simulator'
$sims = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*stream.py*' })
if ($sims.Count -eq 0) {
    Write-Info 'no stream.py instance running'
} else {
    foreach ($p in $sims) {
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            Write-Ok "stopped stream.py (pid $($p.ProcessId))"
        } catch {
            Write-Host "  !!   failed to stop pid $($p.ProcessId): $_" -ForegroundColor Yellow
        }
    }
}

# ---------- 2. 停前端（可选） ----------
if ($WithFrontend) {
    Write-Step 'stopping frontend dev server'
    $fes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object {
            $_.CommandLine -like '*vite*' -or
            ($_.CommandLine -like '*pnpm*' -and $_.CommandLine -like '*dev*')
        })
    if ($fes.Count -eq 0) {
        Write-Info 'no frontend dev server running'
    } else {
        foreach ($p in $fes) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                Write-Ok "stopped frontend (pid $($p.ProcessId))"
            } catch {
                Write-Host "  !!   failed to stop pid $($p.ProcessId): $_" -ForegroundColor Yellow
            }
        }
    }
}

# ---------- 3. 停容器 ----------
Write-Step 'stopping containers (docker compose down)'
Push-Location $deploy
try {
    if ($RemoveVolumes) {
        Write-Host '  !!   -RemoveVolumes: data volumes will be deleted' -ForegroundColor Yellow
        docker compose down -v
    } else {
        docker compose down
    }
    if ($LASTEXITCODE -ne 0) { throw "docker compose down failed (exit $LASTEXITCODE)" }
} catch {
    Write-Host "  !!   $_" -ForegroundColor Yellow
    Pop-Location
    exit 1
}
Pop-Location
Write-Ok 'containers stopped'

# ---------- done ----------
Write-Host ''
Write-Host 'stopped.' -ForegroundColor Cyan
if ($RemoveVolumes) {
    Write-Host '  data volumes removed - next start will re-seed from empty db' -ForegroundColor Yellow
} else {
    Write-Host '  data volumes kept - next start still has your data' -ForegroundColor DarkGray
}
Write-Host '  start again:  .\start.ps1' -ForegroundColor DarkGray
