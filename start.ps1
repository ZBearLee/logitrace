<#
.SYNOPSIS
    LogiTrace 一键启动：起容器（默认直接 up，可加 -Build 重建）+ 后端自检。
    模拟器 / 前端不代起：结尾打印命令，在 VS Code 终端自行启动（弹独立窗口一关服务就死）。

.DESCRIPTION
    解决两个真实踩过的坑：
    1. 改了后端代码却用 docker compose up -d（不带 --build）→ 跑旧镜像，接口全 404。
       故提供 -Build 开关在改完代码后显式重建，并在起完后校验路由数量；日常不加 -Build 直接 up。
    2. 模拟器开了多个实例 → 轨迹点重复写入（曾把表灌到 229 万行）。
       本脚本启动前检查是否已有 stream.py 在跑，有则跳过。

.PARAMETER NoSimulator
    跳过模拟器运行状态检测（纯起容器时用）。

.PARAMETER Build
    重建 backend 镜像后再启动。仅改了后端代码 / 依赖(requirements.txt) / Dockerfile 时才需要。
    日常起服务请用默认（不加 -Build），用已存在的镜像，无需联网、秒起。
#>
param(
    [switch]$NoSimulator,
    [switch]$Build
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$deploy = Join-Path $root 'deploy'

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

# -Build 需要联网拉取镜像；本网络访问 Docker Hub 受限，提前提示配置镜像加速器。
if ($Build) {
    $mirrors = docker info --format '{{json .RegistryConfig.Mirrors}}' 2>$null
    if (-not $mirrors -or $mirrors -eq '[]' -or $mirrors -eq 'null') {
        Write-Warn '未配置 registry mirror；-Build 需要拉取镜像，本网络访问 Docker Hub 可能受限。若卡住/失败，请在 Docker Desktop 配置镜像加速器（Settings → Docker Engine → registry-mirrors），或去掉 -Build。'
    }
}

# ---------- 2. 起容器 ----------
# 默认直接 docker compose up -d（用已存在的镜像，无需联网/构建，秒起）。
# 改了后端代码 / 依赖 / Dockerfile 后，传 -Build 才重建镜像。
# 本机访问 Docker Hub 受限，--build 会触发拉取 BuildKit 前端等被墙镜像，故默认不构建。
Write-Step $('starting containers (docker compose up -d' + $(if ($Build) { ' --build' } else { '' }) + ')')
Push-Location $deploy
try {
    $upArgs = @('compose', 'up', '-d')
    if ($Build) { $upArgs += '--build' }
    docker @upArgs
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

# ---------- 5. 模拟器：只检测，不代起（避免弹独立窗口，窗口一关服务就死） ----------
$simRunning = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*stream.py*' })
if ($simRunning.Count -gt 0) {
    Write-Ok "stream.py already running ($($simRunning.Count) instance)"
} elseif ($NoSimulator) {
    Write-Warn 'simulator not started (-NoSimulator)'
} else {
    Write-Warn 'stream.py not running - realtime data needs it. Start in another VS Code terminal:'
    Write-Host "  cd $root\simulator" -ForegroundColor Yellow
    Write-Host "  ..\backend\.venv\Scripts\python.exe stream.py" -ForegroundColor Yellow
}

# ---------- done ----------
Write-Host ''
Write-Host 'done.' -ForegroundColor Cyan
Write-Host '  dashboard  http://localhost:5173/dashboard  (need: cd frontend; pnpm dev)'
Write-Host '  swagger    http://127.0.0.1:8000/docs'
Write-Host '  stop       .\stop.ps1'
Write-Host ''
Write-Host '改了后端代码后重跑本脚本请加 -Build（否则用旧镜像）；日常直接 .\start.ps1 即可。' -ForegroundColor Yellow
