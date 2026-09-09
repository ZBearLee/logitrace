"""订单接口。"""

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.schemas import OrderOut
from app.db.models.shipment import Order
from app.db.session import SessionDep

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("", response_model=list[OrderOut])
async def list_orders(
    session: SessionDep,
    limit: int = Query(50, ge=1, le=200),
) -> list[OrderOut]:
    """订单列表。"""
    orders = (await session.scalars(select(Order).order_by(Order.id.desc()).limit(limit))).all()
    return [OrderOut.model_validate(o) for o in orders]
