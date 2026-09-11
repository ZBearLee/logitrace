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
    # 起止港口经纬度：join locations 带出。前端地图按段画"规划路径"基线
    # （淡色实线）+ 已走过轨迹（鲜艳实线），单线连续无重叠。
    origin_lat: float | None = None
    origin_lng: float | None = None
    dest_lat: float | None = None
    dest_lng: float | None = None
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
    # 总起 / 总止地点经纬度：第一段 origin 与最后一段 dest 的经纬度。
    # 前端地图用这些画"完整规划路径"虚线，覆盖还没走到的那段，
    # 否则只看到已走过的轨迹，缺失整条路线的全貌。
    origin_lat: float | None = None
    origin_lng: float | None = None
    dest_lat: float | None = None
    dest_lng: float | None = None


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


class EventOut(BaseModel):
    """全局里程碑事件（通知中心的数据源）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    shipment_id: int
    leg_id: int | None = None
    event_type: str
    occurred_at: datetime
    payload_json: str | None = None
    # 联表带出，前端直接展示，不必再查 shipments
    shipment_no: str | None = None
    shipment_status: str | None = None


class PagedEvents(BaseModel):
    """事件分页结果。"""

    total: int
    page: int
    page_size: int
    items: list[EventOut]


class ExceptionOut(BaseModel):
    """异常记录（异常中心的数据源）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    shipment_id: int
    type: str
    level: str
    detail: str | None = None
    detected_at: datetime
    resolved_at: datetime | None = None
    shipment_no: str | None = None
    shipment_status: str | None = None


class PagedExceptions(BaseModel):
    """异常分页结果。"""

    total: int
    page: int
    page_size: int
    items: list[ExceptionOut]


class MapPort(BaseModel):
    """大屏地图：地点标注（港口/仓库/城市统一）。"""

    code: str
    name: str
    lat: float
    lng: float


class MapLeg(BaseModel):
    """大屏地图：航线段，起止经纬度已 join 带出，前端直接画大圆弧。"""

    seq: int
    mode: str
    # 实时位置流按 leg_id 上报，前端靠它把位置增量映射回运单与段
    leg_id: int
    origin_code: str | None = None
    dest_code: str | None = None
    origin_lat: float | None = None
    origin_lng: float | None = None
    dest_lat: float | None = None
    dest_lng: float | None = None
    status: str
    # 活动段最近轨迹点（[lng, lat, ts_ms] 升序）：
    # - ts_ms 为 UTC epoch 毫秒，供大屏时间轴回放按当前时刻切片；
    # - 大屏「实际轨迹」用历史垫底才可见，否则实时尾迹从连上那刻才开始累积，
    #   慢速船几分钟内画不出可见长度
    track: list[list[float]] = []


class MapRoute(BaseModel):
    """大屏地图：运单航线，聚合各段供前端按运单着色与点击交互。"""

    shipment_id: int
    shipment_no: str
    status: str
    latest_lat: float | None = None
    latest_lng: float | None = None
    legs: list[MapLeg] = []


class MapOverview(BaseModel):
    """大屏地图聚合数据：地点 + 航线，一次请求拿全。"""

    ports: list[MapPort] = []
    routes: list[MapRoute] = []


class MapStats(BaseModel):
    """大屏概览 KPI：运单状态分布 + 今日里程碑事件数，一次聚合返回。"""

    total: int = 0
    by_status: dict[str, int] = {}
    today_events: int = 0


class DelayBucket(BaseModel):
    """延误分布直方图的一个桶：延误时长区间标签 + 落入该区间的运单数。"""

    label: str
    count: int


class CarrierMetric(BaseModel):
    """单个承运商的准点表现：仅在 rated（已送达且计划/实际到达齐全）样本上统计。"""

    carrier_id: int | None = None
    name: str
    mode: str
    total: int = 0
    on_time: int = 0
    delayed: int = 0
    on_time_rate: float = 0
    avg_delay_hours: float = 0


class AnalyticsSummary(BaseModel):
    """运营看板聚合：整体准点率 + 延误分布直方图 + 各承运商对比，一次返回给 D3 看板。

    评分口径统一在后端算：只统计已送达（delivered/delayed）且有计划与实际到达的运单，
    actual_arrival <= planned_arrival 记准时，否则按超出小时数落入延误分箱，前端只画图不重算。
    """

    total_rated: int = 0
    on_time: int = 0
    delayed: int = 0
    on_time_rate: float = 0
    delay_buckets: list[DelayBucket] = []
    carriers: list[CarrierMetric] = []


class NetworkNode(BaseModel):
    """网络拓扑的一个节点：口岸（location）或承运商（carrier）。

    id 带前缀（loc-/car-）避免两类主键都从 1 开始而撞 id。
    volume 是该节点关联的运单总数，用于决定节点大小。
    """

    id: str
    label: str
    type: str  # 'location' | 'carrier'
    volume: int = 0
    location_type: str | None = None  # location 才有：port/warehouse/city
    country: str | None = None
    carrier_mode: str | None = None  # carrier 才有：sea/road/air/rail


class NetworkEdge(BaseModel):
    """网络拓扑的一条边。

    lane：口岸→口岸 的航线，按 (起点,终点,运输方式) 聚合运单数，mode 上色。
    serve：承运商→口岸 的服务关系，承运商在某票货里以该口岸为起点或终点即计一次。
    """

    source: str
    target: str
    type: str  # 'lane' | 'serve'
    weight: int = 0
    mode: str | None = None


class NetworkGraph(BaseModel):
    """物流关系网络：口岸/承运商为节点，航线/服务为边，供前端力导向图一次性渲染。"""

    nodes: list[NetworkNode] = []
    edges: list[NetworkEdge] = []
