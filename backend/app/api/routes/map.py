"""大屏聚合接口：一次请求返回全球地点与各运单分段航线，供 Cesium 地球渲染。

航线渲染需要每段的起止经纬度，详情接口虽带这些数据但一次只给一条运单；
大屏要对几十条运单画线，逐条请求就是 N+1，所以单独提供这个聚合读法。
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.deps import current_user
from app.api.schemas import MapLeg, MapOverview, MapPort, MapRoute, MapStats
from app.db.models.reference import Location
from app.db.models.shipment import Leg, Shipment
from app.db.models.tracking import MilestoneEvent, PositionPoint
from app.db.session import SessionDep

router = APIRouter(prefix="/map", tags=["map"], dependencies=[Depends(current_user)])

# 航线段的两端都指向 locations，用别名区分两次 join（与 shipments 路由同一套写法）
Origin = aliased(Location, name="origin")
Dest = aliased(Location, name="dest")


def _epoch_ms(dt: datetime) -> int:
    """UTC naive datetime → epoch 毫秒。

    DB 统一存 UTC、且是 naive（见 simulator/config.py），这里补上 UTC 时区再转，
    避免 .timestamp() 按服务器本地时区解释导致时间轴整体偏移。
    """
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


@router.get("/overview", response_model=MapOverview)
async def map_overview(
    session: SessionDep,
    limit: int = Query(200, ge=1, le=500, description="最多返回的运单航线数"),
) -> MapOverview:
    """大屏首屏数据：全部地点 + 最近 N 条运单的分段航线（含起止经纬度）。"""
    locations = (await session.scalars(select(Location).order_by(Location.id))).all()

    shipments = (
        await session.scalars(select(Shipment).order_by(Shipment.id.desc()).limit(limit))
    ).all()
    shipment_ids = [s.id for s in shipments]

    leg_rows = (
        await session.execute(
            select(
                Leg,
                Origin.code,
                Dest.code,
                Origin.lat,
                Origin.lng,
                Dest.lat,
                Dest.lng,
            )
            .outerjoin(Origin, Leg.origin_id == Origin.id)
            .outerjoin(Dest, Leg.dest_id == Dest.id)
            .where(Leg.shipment_id.in_(shipment_ids))
            .order_by(Leg.shipment_id, Leg.seq)
        )
    ).all()

    legs_by_shipment: dict[int, list[MapLeg]] = {}
    for leg, o_code, d_code, o_lat, o_lng, d_lat, d_lng in leg_rows:
        legs_by_shipment.setdefault(leg.shipment_id, []).append(
            MapLeg(
                seq=leg.seq,
                mode=leg.mode,
                leg_id=leg.id,
                origin_code=o_code,
                dest_code=d_code,
                origin_lat=o_lat,
                origin_lng=o_lng,
                dest_lat=d_lat,
                dest_lng=d_lng,
                status=leg.status,
            )
        )

    # 活动段的最近轨迹点：窗口函数一条 SQL 取每段最近 N 点（避免按段逐条查的 N+1）。
    # 「实际轨迹」需要历史点垫底——实时尾迹从连上那刻才开始累积，长度不可见。
    active_leg_ids = [
        leg.leg_id for legs in legs_by_shipment.values() for leg in legs if leg.status == "active"
    ]
    tracks: dict[int, list[list[float]]] = {}
    if active_leg_ids:
        rn = (
            func.row_number()
            .over(partition_by=PositionPoint.leg_id, order_by=PositionPoint.recorded_at.desc())
            .label("rn")
        )
        recent = (
            select(
                PositionPoint.leg_id,
                PositionPoint.lng,
                PositionPoint.lat,
                PositionPoint.recorded_at,
                rn,
            )
            .where(PositionPoint.leg_id.in_(active_leg_ids))
            .subquery()
        )
        track_rows = (
            await session.execute(
                select(recent.c.leg_id, recent.c.lng, recent.c.lat, recent.c.recorded_at)
                # 模拟器每 60s 落一个点：360 点 ≈ 6 小时航程 ≈ 200km，缩放到位图上
                # 才是一段肉眼可见的线；60 点只有 30km，全球视角下不足 1 像素
                .where(recent.c.rn <= 360)
                .order_by(recent.c.leg_id, recent.c.rn.desc())
            )
        ).all()
        for leg_id, lng, lat, recorded_at in track_rows:
            # 带上时间戳：前端时间轴回放靠它把「已走过」按当前时刻切片
            tracks.setdefault(leg_id, []).append([lng, lat, _epoch_ms(recorded_at)])
    for legs in legs_by_shipment.values():
        for leg in legs:
            leg.track = tracks.get(leg.leg_id, [])

    return MapOverview(
        ports=[MapPort(code=p.code, name=p.name, lat=p.lat, lng=p.lng) for p in locations],
        routes=[
            MapRoute(
                shipment_id=s.id,
                shipment_no=s.shipment_no,
                status=s.status,
                latest_lat=s.latest_lat,
                latest_lng=s.latest_lng,
                legs=legs_by_shipment.get(s.id, []),
            )
            for s in shipments
        ],
    )


@router.get("/stats", response_model=MapStats)
async def map_stats(session: SessionDep) -> MapStats:
    """大屏概览 KPI：运单按状态计数 + 今日（UTC 零点起）里程碑事件数。

    一次聚合返回，避免前端把整张 events 表拉回来自己数；状态分布与今日事件
    都是控制塔一眼要冲的全局数字。
    """
    rows = (
        await session.execute(select(Shipment.status, func.count()).group_by(Shipment.status))
    ).all()
    by_status = {status: count for status, count in rows}
    total = sum(by_status.values())
    # DB 统一存 naive UTC：用 UTC 零点（naive）比较，避免拿 aware datetime 去比 naive 列报错
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_events = (
        await session.scalar(
            select(func.count())
            .select_from(MilestoneEvent)
            .where(MilestoneEvent.occurred_at >= today_start)
        )
    ) or 0
    return MapStats(total=total, by_status=by_status, today_events=today_events)
