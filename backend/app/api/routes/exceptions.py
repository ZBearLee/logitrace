"""异常记录接口：异常中心的数据源。

数据由模拟器侧的滞留检测写入 exception_records（见 simulator/stream.py 的
_check_stall），这里只负责查询，不新增任何写入路径。
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, select

from app.api.deps import current_user
from app.api.schemas import ExceptionOut, PagedExceptions
from app.db.models.shipment import Shipment
from app.db.models.tracking import ExceptionRecord
from app.db.session import SessionDep

router = APIRouter(prefix="/exceptions", tags=["exceptions"], dependencies=[Depends(current_user)])


@router.get("", response_model=PagedExceptions)
async def list_exceptions(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    type: str | None = Query(None, description="delay / stalled / route_deviation"),
    level: str | None = Query(None, description="info / warning / critical"),
    unresolved_only: bool = Query(False, description="只看未处理（resolved_at 为空）的异常"),
) -> PagedExceptions:
    """异常列表：分页 + 按类型/等级筛选，带出运单号便于直接定位是哪票货。"""
    conditions = []
    if type:
        conditions.append(ExceptionRecord.type == type)
    if level:
        conditions.append(ExceptionRecord.level == level)
    if unresolved_only:
        conditions.append(ExceptionRecord.resolved_at.is_(None))

    total = await session.scalar(
        select(func.count()).select_from(ExceptionRecord).where(and_(*conditions))
    )

    stmt = (
        select(ExceptionRecord, Shipment.shipment_no, Shipment.status)
        .outerjoin(Shipment, ExceptionRecord.shipment_id == Shipment.id)
        .where(and_(*conditions))
        .order_by(ExceptionRecord.detected_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await session.execute(stmt)).all()

    items = [
        ExceptionOut(
            id=e.id,
            shipment_id=e.shipment_id,
            type=e.type,
            level=e.level,
            detail=e.detail,
            detected_at=e.detected_at,
            resolved_at=e.resolved_at,
            shipment_no=shipment_no,
            shipment_status=shipment_status,
        )
        for e, shipment_no, shipment_status in rows
    ]

    return PagedExceptions(total=total or 0, page=page, page_size=page_size, items=items)
