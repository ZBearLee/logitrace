"""定时任务：ETA 每小时批量推理 + 异常日报每天 08:00。

任务自己开会话（不依赖请求级 SessionDep）；启动时各先跑一次，
否则演示要干等一小时/到第二天早上才有数据。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db.session import SessionLocal
from app.services import report_service
from app.services.eta_service import refresh_eta_predictions

logger = logging.getLogger(__name__)


async def run_eta_refresh() -> dict:
    """ETA 批量推理一次；异常只记日志不外抛，调度器里的失败不能拖垮应用。"""
    try:
        async with SessionLocal() as session:
            stats = await refresh_eta_predictions(session)
        if "written" in stats:
            logger.info("ETA 批量推理完成：%s", stats)
        return stats
    except Exception:
        logger.exception("ETA 批量推理失败")
        return {"error": "eta-refresh-failed"}


async def run_daily_report() -> dict:
    """生成昨天（跨零点后看昨天才完整）的异常日报。"""
    yesterday = (datetime.now() - timedelta(days=1)).date().isoformat()
    try:
        async with SessionLocal() as session:
            report = await report_service.generate_daily_report(session, yesterday)
        logger.info("异常日报已生成：%s（%s）", report.report_date, report.source)
        return {"date": report.report_date, "source": report.source}
    except Exception:
        logger.exception("异常日报生成失败")
        return {"error": "daily-report-failed"}


def start_scheduler() -> AsyncIOScheduler:
    """注册定时任务并启动；返回调度器供应用关闭时 shutdown。"""
    scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")
    scheduler.add_job(run_eta_refresh, "interval", hours=1, id="eta-refresh", max_instances=1)
    scheduler.add_job(run_daily_report, "cron", hour=8, minute=0, id="daily-report")
    scheduler.start()
    return scheduler
