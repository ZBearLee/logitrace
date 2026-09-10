"""全局里程碑事件流接口：通知中心的数据源。

数据由模拟器侧在运单推进时写入 milestone_events（departed / arrived /
delivered / stalled 等），这里只负责查询，不新增任何写入路径。
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, select

from app.api.deps import current_user
from app.api.schemas import EventOut, PagedEvents
from app.db.models.shipment import Shipment
from app.db.models.tracking import MilestoneEvent
from app.db.session import SessionDep

router = APIRouter(prefix="/events", tags=["events"], dependencies=[Depends(current_user)])


@router.get("", response_model=PagedEvents)
async def list_events(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    event_type: Optional[str] = Query(
        None,
        description="picked_up / loaded / departed / arrived / delivered / delayed / stalled",
    ),
    shipment_no: Optional[str] = Query(None, description="按运单号模糊匹配"),
    since: Optional[datetime] = Query(None, description="只取该时间之后的事件（UTC）"),
) -> PagedEvents:
    """事件流：分页 + 按类型/运单号/时间筛选，联表带出运单号。"""
    conditions = []
    if event_type:
        conditions.append(MilestoneEvent.event_type == event_type)
    if shipment_no:
        conditions.append(Shipment.shipment_no.ilike(f"%{shipment_no}%"))
    if since:
        conditions.append(MilestoneEvent.occurred_at >= since)

    total = await session.scalar(
        select(func.count())
        .select_from(MilestoneEvent)
        .outerjoin(Shipment, MilestoneEvent.shipment_id == Shipment.id)
        .where(and_(*conditions))
    )

    stmt = (
        select(MilestoneEvent, Shipment.shipment_no, Shipment.status)
        .outerjoin(Shipment, MilestoneEvent.shipment_id == Shipment.id)
        .where(and_(*conditions))
        .order_by(MilestoneEvent.occurred_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await session.execute(stmt)).all()

    items = [
        EventOut(
            id=e.id,
            shipment_id=e.shipment_id,
            leg_id=e.leg_id,
            event_type=e.event_type,
            occurred_at=e.occurred_at,
            payload_json=e.payload_json,
            shipment_no=shipment_no,
            shipment_status=shipment_status,
        )
        for e, shipment_no, shipment_status in rows
    ]

    return PagedEvents(total=total or 0, page=page, page_size=page_size, items=items)
