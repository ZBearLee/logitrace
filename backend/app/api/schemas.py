"""API 请求/响应模型（Pydantic v2）。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LegOut(BaseModel):
    """运输段：一票货的其中一段。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    seq: int
    mode: str
    origin_id: int | None = None
    dest_id: int | None = None
    # 起止港口 code：查询时 join locations 带出，前端链路视图可直接展示
    origin_code: str | None = None
    dest_code: str | None = None
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    status: str


class ShipmentBrief(BaseModel):
    """运单列表项：带起运/目的港 code 和承运商名，前端可直接展示。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    shipment_no: str
    status: str
    origin_code: str | None = None
    dest_code: str | None = None
    carrier_name: str | None = None
    planned_departure: datetime | None = None
    planned_arrival: datetime | None = None
    actual_departure: datetime | None = None
    actual_arrival: datetime | None = None
    latest_lat: float | None = None
    latest_lng: float | None = None
    latest_ts: datetime | None = None


class ShipmentDetail(ShipmentBrief):
    """运单详情：在列表项基础上带出各运输段。"""

    order_id: int | None = None
    # 订单号与货主：join orders 带出，前端直接展示（只给 order_id 页面上是无意义的数字）
    order_no: str | None = None
    customer_name: str | None = None
    legs: list[LegOut] = []


class MilestoneEventOut(BaseModel):
    """里程碑事件。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    shipment_id: int
    leg_id: int | None = None
    event_type: str
    occurred_at: datetime
    payload_json: str | None = None


class PositionPointOut(BaseModel):
    """轨迹点。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    leg_id: int
    lat: float
    lng: float
    speed: float | None = None
    heading: float | None = None
    recorded_at: datetime


class PagedShipments(BaseModel):
    """运单分页结果。"""

    total: int
    page: int
    page_size: int
    items: list[ShipmentBrief]


class OrderOut(BaseModel):
    """订单。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    order_no: str
    customer_name: str
    status: str
    created_at: datetime


class LoginIn(BaseModel):
    """登录入参。"""

    username: str
    password: str


class LoginOut(BaseModel):
    """登录结果：令牌 + 当前账号信息，前端据此渲染头部与做路由守卫。"""

    access_token: str
    token_type: str = "bearer"
    username: str
    role: str


class UserClaims(BaseModel):
    """从令牌解析出的身份，供受保护接口声明依赖。"""

    username: str
    role: str
