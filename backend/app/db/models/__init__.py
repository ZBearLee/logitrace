"""ORM 模型汇总：统一导出，保证 Alembic autogenerate 能识别到全部表。

新增模型时记得在这里导出，否则迁移生成时会漏表。
"""

from app.db.models.reference import Carrier, Location, User
from app.db.models.shipment import Leg, Order, Shipment
from app.db.models.tracking import ExceptionRecord, MilestoneEvent, PositionPoint

__all__ = [
    "Carrier",
    "ExceptionRecord",
    "Leg",
    "Location",
    "MilestoneEvent",
    "Order",
    "PositionPoint",
    "Shipment",
    "User",
]
