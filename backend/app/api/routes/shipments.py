"""运单接口：列表（分页+筛选）、详情（含运输段）、里程碑事件、轨迹查询。"""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.schemas import (
    LegOut,
    MilestoneEventOut,
    PagedShipments,
    PositionPointOut,
    ShipmentBrief,
    ShipmentDetail,
)
from app.db.models.reference import Carrier, Location
from app.db.models.shipment import Leg, Shipment
from app.db.models.tracking import MilestoneEvent, PositionPoint
from app.db.session import SessionDep

router = APIRouter(prefix="/shipments", tags=["shipments"])

# 起运地和目的地都指向 locations，用别名区分两次 join
Origin = aliased(Location, name="origin")
Dest = aliased(Location, name="dest")
# 运输段同样有起止地点，另建一对别名，避免与运单的那对冲突
LegOrigin = aliased(Location, name="leg_origin")
LegDest = aliased(Location, name="leg_dest")


@router.get("", response_model=PagedShipments)
async def list_shipments(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, description="planned / in_transit / delivered / delayed"),
) -> PagedShipments:
    """运单列表：分页 + 按状态筛选，带出港口 code 和承运商名。"""
    conditions = []
    if status:
        conditions.append(Shipment.status == status)

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
        select(Shipment, Origin.code, Dest.code, Carrier.name)
        .outerjoin(Origin, Shipment.origin_id == Origin.id)
        .outerjoin(Dest, Shipment.dest_id == Dest.id)
        .outerjoin(Carrier, Shipment.carrier_id == Carrier.id)
        .where(Shipment.id == shipment_id)
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="运单不存在")

    s, origin_code, dest_code, carrier_name = row

    # 段也要 join locations 拿港口 code，否则前端链路只能显示地点 id
    leg_rows = (
        await session.execute(
            select(Leg, LegOrigin.code, LegDest.code)
            .outerjoin(LegOrigin, Leg.origin_id == LegOrigin.id)
            .outerjoin(LegDest, Leg.dest_id == LegDest.id)
            .where(Leg.shipment_id == shipment_id)
            .order_by(Leg.seq)
        )
    ).all()

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
        legs=[
            LegOut(
                id=leg.id,
                seq=leg.seq,
                mode=leg.mode,
                origin_id=leg.origin_id,
                dest_id=leg.dest_id,
                origin_code=leg_origin_code,
                dest_code=leg_dest_code,
                planned_start=leg.planned_start,
                planned_end=leg.planned_end,
                status=leg.status,
            )
            for leg, leg_origin_code, leg_dest_code in leg_rows
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
