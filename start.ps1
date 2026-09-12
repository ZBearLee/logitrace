<#
.SYNOPSIS
    LogiTrace 一键启动：起容器（强制 rebuild）+ 实时推流模拟器（单实例）+ 可选前端。

.DESCRIPTION
    解决两个真实踩过的坑：
    1. 改了后端代码却用 docker compose up -d（不带 --build）→ 跑旧镜像，接口全 404。
       本脚本固定带 --build，并在起完后校验路由数量。
    2. 模拟器开了多个实例 → 轨迹点重复写入（曾把表灌到 229 万行）。
       本脚本启动前检查是否已有 stream.py 在跑，有则跳过。

.PARAMETER NoSimulator
    只起容器，不启动模拟器。

.PARAMETER WithFrontend
    额外在新窗口拉起前端 dev server（默认不拉，避免与已开的 dev server 抢端口）。
#>
param(
    [switch]$NoSimulator,
    [switch]$WithFrontend
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$deploy = Join-Path $root 'deploy'
$venvPy = Join-Path $root 'backend\.venv\Scripts\python.exe'

function Write-Step($msg) { Write-Host "[start] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!   $msg" -ForegroundColor Yellow }

# ---------- 1. Docker 是否可用 ----------
Write-Step 'check docker'
try {
    docker version | Out-Null
} catch {
    Write-Host 'Docker is not running. Please start Docker Desktop first.' -ForegroundColor Red
    exit 1
}
Write-Ok 'docker available'

# ---------- 2. 起容器（固定带 --build，避免跑旧镜像） ----------
Write-Step 'starting containers (docker compose up -d --build)'
Push-Location $deploy
try {
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Ok 'containers started'

# ---------- 3. 等待健康检查 ----------
function Wait-Healthy($name, $timeoutSec = 240) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $st = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $name 2>$null
        if ($st -eq 'healthy') { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}

Write-Step 'waiting for health checks'
foreach ($c in @('logitrace-mysql', 'logitrace-redis', 'logitrace-backend')) {
    if (Wait-Healthy $c) {
        Write-Ok "$c healthy"
    } else {
        Write-Warn "$c not healthy in 240s (first MySQL init may take 2+ minutes; recheck: docker compose ps)"
    }
}

# ---------- 4. 后端自检：存活 + 路由数量（识别旧镜像 / 端口被占） ----------
Write-Step 'backend self-check'
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 10
    Write-Ok "health = $($health.status)"
    $api = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 20
    $routeCount = @($api.paths.PSObject.Properties.Name).Count
    if ($routeCount -lt 5) {
        Write-Warn "only $routeCount routes registered - likely stale image or port 8000 taken by another process (netstat -ano | findstr :8000)"
    } else {
        Write-Ok "$routeCount routes registered"
    }
} catch {
    Write-Warn "backend self-check failed: $_"
}

# ---------- 5. 模拟器（单实例保护） ----------
if (-not $NoSimulator) {
    Write-Step 'starting position stream simulator'
    $running = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Where-Object { $_.CommandLine -like '*stream.py*' })
    if ($running.Count -gt 0) {
        Write-Warn "$($running.Count) stream.py instance(s) already running - skipped (duplicates would double-write track points)"
    } else {
        $py = if (Test-Path $venvPy) { $venvPy } else { 'python' }
        Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\simulator'; & '$py' stream.py"
        Write-Ok 'simulator started in a new window'
    }
}

# ---------- 6. 前端（可选） ----------
if ($WithFrontend) {
    Write-Step 'starting frontend dev server'
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; pnpm dev"
    Write-Ok 'frontend started (http://localhost:5173)'
}

# ---------- done ----------
Write-Host ''
Write-Host 'done.' -ForegroundColor Cyan
Write-Host '  dashboard  http://localhost:5173/dashboard'
Write-Host '  swagger    http://127.0.0.1:8000/docs'
Write-Host '  stop       .\stop.ps1'
Write-Host ''
Write-Host 're-run this script after backend code changes (it always rebuilds images).' -ForegroundColor Yellow
