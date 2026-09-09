"""业务主体：订单、运单、运输段。"""

from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Order(Base):
    """货主的原始订单，一单可拆多票运单。"""

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    customer_name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="created")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Shipment(Base):
    """运单：一票货的全链路，追踪的主体。"""

    __tablename__ = "shipments"
    __table_args__ = (
        Index("idx_shipments_status", "status"),
        Index("idx_shipments_order", "order_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    status: Mapped[str] = mapped_column(
        Enum("planned", "in_transit", "delivered", "delayed", name="shipment_status"),
        nullable=False,
        server_default="planned",
    )
    origin_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    dest_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    carrier_id: Mapped[int | None] = mapped_column(ForeignKey("carriers.id"), nullable=True)

    planned_departure: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    planned_arrival: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_departure: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_arrival: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 冗余最新位置：列表页展示在途运单免 JOIN 轨迹表（读多写少，空间换时间）
    latest_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    latest_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    latest_ts: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Leg(Base):
    """运输段：一票货的多段联运（海运段 / 陆运段...）。"""

    __tablename__ = "legs"
    __table_args__ = (Index("idx_legs_shipment", "shipment_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id"), nullable=False)
    seq: Mapped[int] = mapped_column(nullable=False)
    mode: Mapped[str] = mapped_column(
        Enum("sea", "road", "air", "rail", name="leg_mode"), nullable=False
    )
    origin_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    dest_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    planned_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    planned_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(
        Enum("planned", "active", "completed", "skipped", name="leg_status"),
        nullable=False,
        server_default="planned",
    )
