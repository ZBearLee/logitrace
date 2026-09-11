"""应用入口：创建实例、挂载路由。后续 CORS/中间件/生命周期事件都在这里扩展。"""

from fastapi import FastAPI

from app.api.routes import (
    analytics,
    auth,
    events,
    exceptions,
    health,
    network,
    orders,
    realtime,
    shipments,
)
from app.api.routes import (
    map as map_routes,
)

app = FastAPI(
    title="LogiTrace API",
    description="实时物流追踪平台-后端服务",
    version="0.1.0",
)

# health 与 auth 保持公开：前者给探活用，后者是拿令牌的入口
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(shipments.router)
app.include_router(orders.router)
app.include_router(realtime.router)
app.include_router(events.router)
app.include_router(exceptions.router)
app.include_router(map_routes.router)
app.include_router(analytics.router)
app.include_router(network.router)
