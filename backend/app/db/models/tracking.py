"""追踪与事件：轨迹点、里程碑、异常记录。"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Double,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PositionPoint(Base):
    """轨迹点：高频写入，按月 RANGE 分区。

    MySQL 要求分区键必须属于所有唯一键，所以主键是 (id, recorded_at) 复合主键。
    分区 DDL 由迁移脚本手写（autogenerate 生成不了）。

    注意 leg_id 没有外键：MySQL 的分区表不支持外键约束，只能去掉，
    完整性由写入方（模拟器 / 业务逻辑）保证 —— 这是分区换来的性能与可归档性。
    """

    __tablename__ = "position_points"
    __table_args__ = (
        PrimaryKeyConstraint("id", "recorded_at"),
        Index("idx_leg_time", "leg_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, autoincrement=True)
    leg_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # 坐标必须用 double：float 单精度经 MySQL 文本协议只回 6 位有效数字，
    # 经度（整数部 2-3 位）小数位不足，会把轨迹量化成"横粗竖细"的直角楼梯
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    lng: Mapped[float] = mapped_column(Double, nullable=False)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class MilestoneEvent(Base):
    """里程碑事件：提货 / 装船 / 离港 / 到港 / 签收等。"""

    __tablename__ = "milestone_events"
    __table_args__ = (Index("idx_events_shipment_time", "shipment_id", "occurred_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id"), nullable=False)
    leg_id: Mapped[int | None] = mapped_column(ForeignKey("legs.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(
        Enum(
            "picked_up",
            "loaded",
            "departed",
            "arrived",
            "delivered",
            "delayed",
            "stalled",
            name="milestone_event_type",
        ),
        nullable=False,
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    payload_json: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ExceptionRecord(Base):
    """异常记录：延误 / 滞留 / 偏航。"""

    __tablename__ = "exception_records"
    __table_args__ = (Index("idx_exceptions_shipment", "shipment_id", "detected_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id"), nullable=False)
    type: Mapped[str] = mapped_column(
        Enum("delay", "stalled", "route_deviation", name="exception_type"), nullable=False
    )
    level: Mapped[str] = mapped_column(
        Enum("info", "warning", "critical", name="exception_level"),
        nullable=False,
        server_default="info",
    )
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
