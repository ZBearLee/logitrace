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


class CarrierOption(BaseModel):
    """承运商下拉项：下钻筛选用，前端据此渲染承运商 Select。"""

    id: int
    name: str
    mode: str


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


class TrendPoint(BaseModel):
    """趋势序列的一天：按计划到达日期聚合的准点表现，供折线图看改善/恶化。"""

    date: str  # YYYY-MM-DD
    total: int = 0
    on_time: int = 0
    delayed: int = 0
    on_time_rate: float = 0


class DelayReason(BaseModel):
    """延误原因聚合：按异常类型统计命中次数，回答"为什么延误"。"""

    type: str  # delay / stalled / route_deviation
    count: int = 0


class RouteFlow(BaseModel):
    """航线流量（桑基图数据源）：起点口岸 → 终点口岸 的运量，按运输方式聚合。

    桑基图用 origin/dest 两类口岸作左右列、link 粗细表运量，前端只负责布局不重算。
    """

    origin: str
    dest: str
    mode: str  # sea/road/air/rail，用于给 link 上色
    count: int = 0


class AnalyticsSummary(BaseModel):
    """运营看板聚合：整体准点率 + 延误分布直方图 + 各承运商对比 + 趋势 + 延误原因 + 航线流量。

    评分口径统一在后端算：只统计已送达（delivered/delayed）且有计划与实际到达的运单，
    actual_arrival <= planned_arrival 记准时，否则按超出小时数落入延误分箱，前端只画图不重算。
    trend 按计划到达日期分天；delay_reasons 来自异常记录表，按类型聚合；
    top_routes 是起点→终点口岸的运量 Top N，供桑基图看「货往哪流」。
    """

    total_rated: int = 0
    on_time: int = 0
    delayed: int = 0
    on_time_rate: float = 0
    delay_buckets: list[DelayBucket] = []
    carriers: list[CarrierMetric] = []
    # 时间维度：趋势折线（按天）与延误原因拆解，让看板从「静态快照」变成可下钻的分析
    trend: list[TrendPoint] = []
    delay_reasons: list[DelayReason] = []
    # 空间维度：起点→终点口岸的运量 Top N，桑基图看全局货流走向
    top_routes: list[RouteFlow] = []


class TopLane(BaseModel):
    """节点下钻吞吐量：该节点关联运单按「对方口岸」聚合的 Top 流向。

    口岸节点看 Top 目的港、承运商节点看 Top 服务口岸，让抽屉下钻不止有总量，
    还能看出「货主要往哪几个点聚」，命中单点依赖风险时尤其有用。
    """

    label: str  # 对方口岸名
    count: int = 0
    mode: str | None = None  # lane 才有运输方式；承运商→口岸聚合后该字段为 None


class NetworkNode(BaseModel):
    """网络拓扑的一个节点：口岸（location）或承运商（carrier）。

    id 带前缀（loc-/car-）避免两类主键都从 1 开始而撞 id。
    volume 是该节点关联的运单总数，用于决定节点大小。
    洞察字段（on_time_rate / risk / 合作方）让前端点开节点就能看到「这个口岸/承运商到底怎么样」，
    而不是只有一张关系示意图。
    """

    id: str
    label: str
    type: str  # 'location' | 'carrier'
    volume: int = 0
    location_type: str | None = None  # location 才有：port/warehouse/city
    country: str | None = None
    carrier_mode: str | None = None  # carrier 才有：sea/road/air/rail
    code: str | None = None  # location 才有：港口 code，前端联动大屏高亮用
    lat: float | None = None  # location 才有：经纬度，前端联动大屏飞行定位用
    lng: float | None = None
    # 洞察字段
    on_time_rate: float | None = None  # 该节点关联运单的准点率（0-1），无评分样本时为 None
    risk: str | None = None  # 'single_carrier'（口岸只被 1 个承运商服务）/ 'single_port'（承运商只服务 1 个口岸）
    served_by: int | None = None  # location：服务它的不同承运商数
    serves: int | None = None  # carrier：它服务的不同口岸数
    partners: list[str] = []  # 主要合作方名称（口岸=承运商名 / 承运商=口岸名），按运量降序取前 5
    top_lanes: list[TopLane] = []  # 节点下钻吞吐量：Top 流向口岸，按运量降序取前 5


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
