"""运单接口：列表（分页+筛选）、详情（含运输段）、里程碑事件、轨迹查询。"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.deps import current_user
from app.api.schemas import (
    CarrierOption,
    LegOut,
    MilestoneEventOut,
    PagedShipments,
    PositionPointOut,
    ShipmentBrief,
    ShipmentDetail,
)
from app.db.models.reference import Carrier, Location
from app.db.models.shipment import Leg, Order, Shipment
from app.db.models.tracking import MilestoneEvent, PositionPoint
from app.db.session import SessionDep

router = APIRouter(prefix="/shipments", tags=["shipments"], dependencies=[Depends(current_user)])

# 起运地和目的地都指向 locations，用别名区分两次 join
Origin = aliased(Location, name="origin")
Dest = aliased(Location, name="dest")
# 运输段同样有起止地点，另建一对别名，避免与运单的那对冲突
LegOrigin = aliased(Location, name="leg_origin")
LegDest = aliased(Location, name="leg_dest")


@router.get("/carriers", response_model=list[CarrierOption])
async def list_carriers(session: SessionDep) -> list[CarrierOption]:
    """承运商下拉项：供分析页下钻筛选运单时渲染 Select。放在 /{shipment_id} 之前避免被路径参数吞掉。"""
    rows = (await session.execute(select(Carrier.id, Carrier.name, Carrier.mode))).all()
    return [CarrierOption(id=id, name=name, mode=mode) for id, name, mode in rows]


@router.get("", response_model=PagedShipments)
async def list_shipments(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, description="planned / in_transit / delivered / delayed"),
    shipment_no: str | None = Query(None, description="按运单号模糊匹配（部分即可）"),
    carrier_id: int | None = Query(None, description="按承运商筛选，分析页点击承运商下钻时传入"),
) -> PagedShipments:
    """运单列表：分页 + 按状态/运单号/承运商筛选，带出港口 code 和承运商名。"""
    conditions = []
    if status:
        conditions.append(Shipment.status == status)
    if shipment_no:
        # 模糊匹配，用户输入部分运单号即可定位（运单号含固定前缀，前缀检索仍有意义）
        conditions.append(Shipment.shipment_no.ilike(f"%{shipment_no}%"))
    if carrier_id is not None:
        conditions.append(Shipment.carrier_id == carrier_id)

    total = await session.scalar(select(func.count()).select_from(Shipment).where(*conditions))

    stmt = (
        select(Shipment, Origin.code, Dest.code, Carrier.name)
        .outerjoin(Origin, Shipment.origin_id == Origin.id)
        .outerjoin(Dest, Shipment.dest_id == Dest.id)
        .outerjoin(Carrier, Shipment.carrier_id == Carrier.id)
        .where(*conditions)
        .order_by(Shipment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await session.execute(stmt)).all()

    items = [
        ShipmentBrief(
            id=s.id,
            shipment_no=s.shipment_no,
            status=s.status,
            origin_code=origin_code,
            dest_code=dest_code,
            carrier_name=carrier_name,
            planned_departure=s.planned_departure,
            planned_arrival=s.planned_arrival,
            actual_departure=s.actual_departure,
            actual_arrival=s.actual_arrival,
            latest_lat=s.latest_lat,
            latest_lng=s.latest_lng,
            latest_ts=s.latest_ts,
        )
        for s, origin_code, dest_code, carrier_name in rows
    ]

    return PagedShipments(total=total or 0, page=page, page_size=page_size, items=items)


@router.get("/{shipment_id}", response_model=ShipmentDetail)
async def get_shipment(shipment_id: int, session: SessionDep) -> ShipmentDetail:
    """运单详情：带出各运输段（legs）。"""
    stmt = (
        select(Shipment, Origin.code, Dest.code, Carrier.name, Order.order_no, Order.customer_name)
        .outerjoin(Origin, Shipment.origin_id == Origin.id)
        .outerjoin(Dest, Shipment.dest_id == Dest.id)
        .outerjoin(Carrier, Shipment.carrier_id == Carrier.id)
        .outerjoin(Order, Shipment.order_id == Order.id)
        .where(Shipment.id == shipment_id)
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="运单不存在")

    s, origin_code, dest_code, carrier_name, order_no, customer_name = row

    # 段也要 join locations 拿港口 code，否则前端链路只能显示地点 id
    leg_rows = (
        await session.execute(
            select(
                Leg,
                LegOrigin.code,
                LegDest.code,
                LegOrigin.lat,
                LegOrigin.lng,
                LegDest.lat,
                LegDest.lng,
            )
            .outerjoin(LegOrigin, Leg.origin_id == LegOrigin.id)
            .outerjoin(LegDest, Leg.dest_id == LegDest.id)
            .where(Leg.shipment_id == shipment_id)
            .order_by(Leg.seq)
        )
    ).all()

    # 总起 / 总止经纬度：第一段 origin 与最后一段 dest 的 lat/lng，
    # 用于前端地图画"完整规划路径"虚线（已走过的轨迹只到实时点为止，
    # 没有这些就看不到剩下还要走的路）。
    origin_lat = origin_lng = dest_lat = dest_lng = None
    if leg_rows:
        # leg_rows 已 join 出每段 origin/dest 的 lat/lng（参见上面的 select），
        # 直接取第一段 origin 与最后一段 dest，避免再单独查 Location。
        _, _, _, o_lat, o_lng, _, _ = leg_rows[0]
        _, _, _, _, _, d_lat, d_lng = leg_rows[-1]
        origin_lat, origin_lng = o_lat, o_lng
        dest_lat, dest_lng = d_lat, d_lng

    return ShipmentDetail(
        id=s.id,
        shipment_no=s.shipment_no,
        status=s.status,
        origin_code=origin_code,
        dest_code=dest_code,
        carrier_name=carrier_name,
        planned_departure=s.planned_departure,
        planned_arrival=s.planned_arrival,
        actual_departure=s.actual_departure,
        actual_arrival=s.actual_arrival,
        latest_lat=s.latest_lat,
        latest_lng=s.latest_lng,
        latest_ts=s.latest_ts,
        order_id=s.order_id,
        order_no=order_no,
        customer_name=customer_name,
        origin_lat=origin_lat,
        origin_lng=origin_lng,
        dest_lat=dest_lat,
        dest_lng=dest_lng,
        legs=[
            LegOut(
                id=leg.id,
                seq=leg.seq,
                mode=leg.mode,
                origin_id=leg.origin_id,
                dest_id=leg.dest_id,
                origin_code=leg_origin_code,
                dest_code=leg_dest_code,
                origin_lat=leg_origin_lat,
                origin_lng=leg_origin_lng,
                dest_lat=leg_dest_lat,
                dest_lng=leg_dest_lng,
                planned_start=leg.planned_start,
                planned_end=leg.planned_end,
                status=leg.status,
            )
            for leg, leg_origin_code, leg_dest_code, leg_origin_lat, leg_origin_lng, leg_dest_lat, leg_dest_lng in leg_rows
        ],
    )


@router.get("/{shipment_id}/events", response_model=list[MilestoneEventOut])
async def get_shipment_events(shipment_id: int, session: SessionDep) -> list[MilestoneEventOut]:
    """运单的里程碑事件时间轴。"""
    events = (
        await session.scalars(
            select(MilestoneEvent)
            .where(MilestoneEvent.shipment_id == shipment_id)
            .order_by(MilestoneEvent.occurred_at)
        )
    ).all()
    return [MilestoneEventOut.model_validate(e) for e in events]


@router.get("/{shipment_id}/positions", response_model=list[PositionPointOut])
async def get_shipment_positions(
    shipment_id: int,
    session: SessionDep,
    start: datetime | None = Query(None, description="起始时间（UTC）"),
    end: datetime | None = Query(None, description="结束时间（UTC）"),
    limit: int = Query(2000, ge=1, le=10000),
) -> list[PositionPointOut]:
    """运单的历史轨迹：先取该运单所有段，再按时间范围查轨迹点。"""
    leg_ids = (await session.scalars(select(Leg.id).where(Leg.shipment_id == shipment_id))).all()
    if not leg_ids:
        return []

    conditions = [PositionPoint.leg_id.in_(leg_ids)]
    if start:
        conditions.append(PositionPoint.recorded_at >= start)
    if end:
        conditions.append(PositionPoint.recorded_at <= end)

    stmt = select(PositionPoint).where(*conditions).order_by(PositionPoint.recorded_at).limit(limit)
    points = (await session.scalars(stmt)).all()
    return [PositionPointOut.model_validate(p) for p in points]
