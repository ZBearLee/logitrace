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

---

## 目录结构

```
logitrace/
├── backend/      # FastAPI 后端
├── frontend/     # React + Vite 前端
├── simulator/    # 数据模拟器
├── deploy/       # docker-compose 编排
```
