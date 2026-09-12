# LogiTrace

实时物流追踪平台，跨境物流为主，国内段作为链路的一环。

---

## 快速启动

### 本地 venv（无需 Docker）

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

首次使用需先建环境：`python -m venv .venv` → `.\.venv\Scripts\Activate.ps1` → `pip install -r requirements.txt`

### Docker Compose（需先启动 Docker Desktop）

```powershell
cd deploy
docker compose up -d --build
docker compose ps        # 三个服务 healthy 即可
```

- Swagger 文档：<http://127.0.0.1:8000/docs>
- 健康检查：<http://127.0.0.1:8000/health>

### 一键启动（推荐）

```powershell
.\start.ps1                 # 起容器（自动 rebuild）+ 实时位置推流
.\start.ps1 -WithFrontend   # 额外拉起前端 dev server
.\start.ps1 -NoSimulator    # 只起容器
```

脚本会等三个容器 healthy 后再启动推流，并自动跳过已运行的实例（多实例会重复写入轨迹点）。
停止用 `.\stop.ps1`（默认保留数据卷），要连前端一起停加 `-WithFrontend`。
若提示禁止运行脚本：`powershell -ExecutionPolicy Bypass -File .\start.ps1`。

---

## 目录结构

```
logitrace/
├── backend/      # FastAPI 后端
├── frontend/     # React + Vite 前端
├── simulator/    # 数据模拟器
├── deploy/       # docker-compose 编排
```
