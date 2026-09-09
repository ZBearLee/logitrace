"""应用入口：创建实例、挂载路由。后续 CORS/中间件/生命周期事件都在这里扩展。"""

from fastapi import FastAPI

from app.api.routes import auth, health, orders, shipments

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
