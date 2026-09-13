# LogiTrace

实时物流追踪平台：跨境物流为主，国内段作为链路的一环。

---

## 功能

- **实时追踪**：大屏地图（Cesium）展示在途运单位置、尾迹与推送心跳
- **运单管理**：运单列表 / 详情，多段联运（短驳 → 干线 → 短驳）与里程碑时间线
- **异常中心**：延误 / 滞留 / 航线偏移三类异常与通知
- **数据分析**：航线流量桑基图、承运商准点率、口岸—承运商网络关系
- **ETA 预测**：基于历史运单训练的到达时间预测，偏差超阈值触发预警
- **仓库数字孪生**：Three.js 库区 + 月台 + 在库作业动画
- **AI 能力**：自然语言查运单、生成运营日报

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | FastAPI · SQLAlchemy 2.0 · Alembic · MySQL · Redis（Pub/Sub + 缓存）· WebSocket |
| 实时链路 | 模拟器 → Redis `ch:positions` → 后端 `/ws/positions` → 前端（高频消息不进 React state） |
| 前端 | React 18 + Vite + TypeScript · Ant Design · Cesium（三维地球）/ ECharts / D3（桑基图、力导向图）/ Three.js（仓库孪生）/ 高德地图 JS API（按需加载，需 `VITE_AMAP_KEY`） |
| 机器学习 | scikit-learn（ETA 回归，模型落盘 joblib） |
| 编排 | Docker Compose（backend / mysql / redis） |

---

## 快速启动

前置：先启动 **Docker Desktop**，等状态变绿。

```powershell
# 终端 A：起容器（一次性命令，跑完就结束）
.\start.ps1
# 同一个终端接着起模拟器（实时地图 / 通知 / 异常中心的数据来源，需常驻）
cd simulator
..\backend\.venv\Scripts\python.exe stream.py

# 终端 B：前端
cd frontend
pnpm dev
```

- 大屏：<http://localhost:5173/dashboard>
- Swagger：<http://127.0.0.1:8000/docs>
- 健康检查：<http://127.0.0.1:8000/health>

**说明**

- `start.ps1` 只负责**容器**：默认 `docker compose up -d`（用已存在镜像，无需联网、秒起），并等三容器 healthy + 后端路由自检。改完后端代码加 **`-Build`** 才重建镜像。
- 模拟器与前端**不代起**（不弹独立窗口）。模拟器必须常驻，且**只能开一个**——多实例会重复写入轨迹点。
- 大屏心跳显示「等待位置推送」= 模拟器没起，按上面流程起 `stream.py` 即可。
- 停止：`.\stop.ps1`（保留数据卷；连前端一起停加 `-WithFrontend`）。
- 提示禁止运行脚本时：`powershell -ExecutionPolicy Bypass -File .\start.ps1`

---

## 目录结构

```
logitrace/
├── backend/      # FastAPI 后端
├── frontend/     # React + Vite 前端
├── simulator/    # 数据模拟器
└── deploy/       # docker-compose 编排
```
