"""运营看板聚合：准点率 / 延误分布 / 承运商对比 / 趋势 / 延误原因，供 D3 看板一次性拉取。

前端只负责画图，所有口径（哪些是「已送达」、准时怎么判、延误怎么分箱、按天怎么聚合趋势）
都在这里算，避免把整张 shipments 表拉回浏览器自己数——样本稍大就是 N+1 + 大体积传输。
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.schemas import AnalyticsSummary, CarrierMetric, DelayBucket, DelayReason, TrendPoint
from app.db.models.reference import Carrier
from app.db.models.shipment import Shipment
from app.db.models.tracking import ExceptionRecord
from app.db.session import SessionDep

router = APIRouter(prefix="/analytics", tags=["analytics"])

# 延误时长分箱（小时）：actual_arrival - planned_arrival 归到可读区间。
# 升序、末桶到 +inf，查找时取第一个「delay_hours <= hi」的桶即可连续覆盖。
_DELAY_BUCKETS: list[tuple[str, float]] = [
    ("准时/提前", 0),
    ("0-12h", 12),
    ("12-24h", 24),
    ("24-48h", 48),
    ("48h+", float("inf")),
]

_UNKNOWN_CARRIER = ("未知承运商", "unknown")


@router.get("/summary", response_model=AnalyticsSummary)
async def analytics_summary(
    session: SessionDep,
    days: int | None = Query(None, ge=1, description="最近 N 天，按计划到达日期筛选；不传则全部"),
) -> AnalyticsSummary:
    """D3 运营看板总入口：整体 + 分承运商 + 每日趋势 + 延误原因，一次返回。

    趋势按「计划到达日期」分天聚合（计划到达总在评分样本里非空），让折线图能反映
    准点率是改善还是恶化，而不是一张静态快照。delay_reasons 来自异常记录表按类型聚合，
    回答「为什么延误」。
    """
    now = datetime.now()
    window_start = now - timedelta(days=days) if days else None

    base = (
        select(
            Shipment.status,
            Shipment.carrier_id,
            Shipment.planned_arrival,
            Shipment.actual_arrival,
            Carrier.name,
            Carrier.mode,
        )
        .join(Carrier, Carrier.id == Shipment.carrier_id, isouter=True)
        .where(Shipment.status.in_(["delivered", "delayed"]))
    )
    if window_start is not None:
        base = base.where(Shipment.planned_arrival >= window_start)
    rows = (await session.execute(base)).all()

    total_rated = on_time = delayed = 0
    buckets: dict[str, int] = {label: 0 for label, _ in _DELAY_BUCKETS}
    carriers: dict[int | None, CarrierMetric] = {}
    # 趋势：按计划到达日期分天，存 [total, on_time, delayed]
    trend: dict[str, list[int]] = {}

    for status, carrier_id, planned, actual, carrier_name, carrier_mode in rows:
        if planned is None or actual is None:
            continue  # 没到齐到达时间无法评分，跳过
        delay_hours = (actual - planned).total_seconds() / 3600
        is_on_time = delay_hours <= 0

        total_rated += 1
        if is_on_time:
            on_time += 1
        else:
            delayed += 1

        for label, hi in _DELAY_BUCKETS:
            if delay_hours <= hi:
                buckets[label] += 1
                break

        day = planned.date().isoformat()
        t = trend.setdefault(day, [0, 0, 0])
        t[0] += 1
        if is_on_time:
            t[1] += 1
        else:
            t[2] += 1

        key = carrier_id
        if key not in carriers:
            name, mode = (carrier_name, carrier_mode) if carrier_id is not None else _UNKNOWN_CARRIER
            carriers[key] = CarrierMetric(carrier_id=carrier_id, name=name or "未知承运商", mode=mode or "unknown")
        cm = carriers[key]
        cm.total += 1
        if is_on_time:
            cm.on_time += 1
        else:
            cm.delayed += 1
            cm.avg_delay_hours += delay_hours

    for cm in carriers.values():
        cm.on_time_rate = round(cm.on_time / cm.total, 4) if cm.total else 0
        cm.avg_delay_hours = round(cm.avg_delay_hours / cm.delayed, 1) if cm.delayed else 0

    trend_points = [
        TrendPoint(
            date=day,
            total=v[0],
            on_time=v[1],
            delayed=v[2],
            on_time_rate=round(v[1] / v[0], 4) if v[0] else 0,
        )
        for day, v in sorted(trend.items())
    ]

    # 延误原因：异常记录按类型聚合；窗口同样作用于检测时间
    ex_base = select(ExceptionRecord.type, func.count()).group_by(ExceptionRecord.type)
    if window_start is not None:
        ex_base = ex_base.where(ExceptionRecord.detected_at >= window_start)
    delay_reasons = [DelayReason(type=t, count=c) for t, c in (await session.execute(ex_base)).all()]

    return AnalyticsSummary(
        total_rated=total_rated,
        on_time=on_time,
        delayed=delayed,
        on_time_rate=round(on_time / total_rated, 4) if total_rated else 0,
        delay_buckets=[DelayBucket(label=label, count=buckets[label]) for label, _ in _DELAY_BUCKETS],
        carriers=sorted(carriers.values(), key=lambda c: c.total, reverse=True),
        trend=trend_points,
        delay_reasons=delay_reasons,
    )
