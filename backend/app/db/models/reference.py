"""参照数据：用户、地点、承运商。"""

from datetime import datetime

from sqlalchemy import DateTime, Double, Enum, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    """示例账号：只区分角色，不做复杂权限。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, server_default="viewer")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Location(Base):
    """地点：港口 / 仓库 / 城市统一建模，画图和路由都用它。"""

    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(
        Enum("port", "warehouse", "city", name="location_type"), nullable=False
    )
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    lng: Mapped[float] = mapped_column(Double, nullable=False)
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Carrier(Base):
    """承运商：海运 / 陆运 / 空运 / 铁运。"""

    __tablename__ = "carriers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    mode: Mapped[str] = mapped_column(
        Enum("sea", "road", "air", "rail", name="carrier_mode"), nullable=False
    )
    avg_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
