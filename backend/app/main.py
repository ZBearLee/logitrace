"""应用入口：创建实例、挂载路由、定时任务。

lifespan 里启动 APScheduler（ETA 每小时批量推理、异常日报每天 08:00），
并在启动时各先跑一次——否则要干等一个小时才有 ETA 数据。
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import (
    ai,
    analytics,
    auth,
    events,
    exceptions,
    health,
    network,
    orders,
    realtime,
    shipments,
    warehouse,
)
from app.api.routes import (
    map as map_routes,
)
from app.services.jobs import run_daily_report, run_eta_refresh, start_scheduler


@asynccontextmanager
async def lifespan(_: FastAPI):
    scheduler = start_scheduler()
    # 启动先各跑一次：ETA 立刻有数据可看；当天日报缺就现算
    await run_eta_refresh()
    await run_daily_report()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="LogiTrace API",
    description="实时物流追踪平台-后端服务",
    version="0.1.0",
    lifespan=lifespan,
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
app.include_router(warehouse.router)
app.include_router(ai.router)
