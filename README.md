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

---

## 效果展示

### 运单列表
![运单列表](https://github.com/user-attachments/assets/05b8e67f-40d5-46d7-b6af-41252a28f3bd)

### Echarts显示运输中轨迹
![Echarts显示运输中轨迹](https://github.com/user-attachments/assets/a03793c3-0374-4ddb-8f35-53183e6b1dd7)

### 高德地图显示运输中轨迹
![高德地图显示运输中轨迹](https://github.com/user-attachments/assets/b6c9df7c-b1a0-48d2-886c-4d439473324e)

### 首页大圆插值显示航线
![首页大圆插值显示航线](https://github.com/user-attachments/assets/bdcb828d-a641-43cd-8742-776590c71616)

### 首页大圆根据状态显示航线
![首页大圆根据状态显示航线](https://github.com/user-attachments/assets/684d24aa-6cbd-4e66-bd79-82cbc70b1855)

### 历史回放显示航线位置运输运动过程
![历史回放显示航线位置运输运动过程](https://github.com/user-attachments/assets/53c2b601-d222-4751-9ce9-d3b509e892c9)

### 首页大屏点击航线跳转到对应的运单详情
![首页大屏点击航线跳转到对应的运单详情](https://github.com/user-attachments/assets/de99350c-118f-45fa-a74c-848dd89cce38)

### D3应用-运营看板
![D3应用-运营看板](https://github.com/user-attachments/assets/68c9f787-b227-430c-b2be-e6268d59844b)

### 港口网络图
![港口网络图](https://github.com/user-attachments/assets/f817ab8a-d1c4-43a7-86c5-1bb947138adf)

### 框选网络图之后跳转到首页大屏展示对应港口的运输关系
![框选网络图之后跳转到首页大屏展示对应港口的运输关系](https://github.com/user-attachments/assets/8eaf3e3e-d93a-4df8-a6c7-e231decf79a2)

### 框选的港口的航线在大屏高亮显示
![框选的港口的航线在大屏高亮显示](https://github.com/user-attachments/assets/ee518d6c-8867-480f-aa70-dc81f0574684)

### 首页大圆点击仓库可进入3D场景
![首页大圆点击仓库可进入3D场景](https://github.com/user-attachments/assets/d62cb7e4-4c78-47eb-afe0-cdbee1da1a3b)

### 查看仓库的使用情况
![查看仓库的使用情况](https://github.com/user-attachments/assets/a58aa25e-a22e-44aa-a0d2-5dd89b3478a7)

### 点击库位查看使用情况
![点击库位查看使用情况](https://github.com/user-attachments/assets/16723898-4de9-4aaf-9695-a9aa9aad9300)

### AI异常时降级使用保证其它功能正常
![AI异常时降级使用保证其它功能正常](https://github.com/user-attachments/assets/0080853b-1367-4cc4-b68b-e13464d1e977)

### AI控制面板全局弹出查数
![AI控制面板全局弹出查数](https://github.com/user-attachments/assets/3fb8052b-7382-4905-9e68-48a30e8be02e)

### AI辅助-ETA预测到达时间
![AI辅助-ETA预测到达时间](https://github.com/user-attachments/assets/dd0b6611-a495-4fc5-a5eb-5adfacbf7f76)

### AI辅助-异常日报
![AI辅助-异常日报](https://github.com/user-attachments/assets/94173a06-18ad-4270-98af-62d4a52688ae)
