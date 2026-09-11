// 运单领域 / 契约类型：对齐后端 app/api/routes/shipments.py 的真实返回结构。
// 作为无依赖的单一来源，api / constants / components 均从此处引用，
// 不反向依赖传输层（api），保持依赖方向单向、无环。

export type ShipmentStatus = 'planned' | 'in_transit' | 'delivered' | 'delayed'
export type TransportMode = 'sea' | 'air' | 'rail' | 'road'

/** 运单列表项：带起运/目的港 code 与承运商名，前端可直接展示。 */
export interface ShipmentBrief {
  id: number
  shipment_no: string
  status: string
  origin_code: string | null
  dest_code: string | null
  carrier_name: string | null
  planned_departure: string | null
  planned_arrival: string | null
  actual_departure: string | null
  actual_arrival: string | null
  latest_lat: number | null
  latest_lng: number | null
  latest_ts: string | null
}

/** 运输段：一票货的其中一段（港口用 id 关联，前端展示 mode/状态即可）。 */
export interface LegOut {
  id: number
  seq: number
  mode: string
  origin_id: number | null
  dest_id: number | null
  origin_code: string | null
  dest_code: string | null
  /** 起止港口经纬度：后端 join 带出，前端按段画规划路径基线。 */
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
  planned_start: string | null
  planned_end: string | null
  status: string
}

/** 运单详情：在列表项基础上带出各运输段。 */
export interface ShipmentDetail extends ShipmentBrief {
  order_id: number | null
  /** 订单号：后端 join orders 带出，页面展示这个而非裸 id */
  order_no: string | null
  /** 货主：同属订单信息，从 orders 带出 */
  customer_name: string | null
  legs: LegOut[]
  /** 总起经纬度（第一段 origin），用于画完整规划路径虚线。 */
  origin_lat: number | null
  origin_lng: number | null
  /** 总止经纬度（最后一段 dest），用于画完整规划路径虚线。 */
  dest_lat: number | null
  dest_lng: number | null
}

/** 里程碑事件（时间轴用）。 */
export interface MilestoneEventOut {
  id: number
  shipment_id: number
  leg_id: number | null
  event_type: string
  occurred_at: string
  payload_json: string | null
}

/** 轨迹点（地图用，带经纬度）。 */
export interface PositionPointOut {
  id: number
  leg_id: number
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  recorded_at: string
}

/** 运单分页结果。 */
export interface PagedShipments {
  total: number
  page: number
  page_size: number
  items: ShipmentBrief[]
}

export interface ShipmentsQuery {
  page?: number
  page_size?: number
  status?: string | null
  /** 按运单号模糊匹配（前端列表搜索框）。 */
  shipment_no?: string | null
}

/** 全局事件筛选参数（通知中心）。 */
export interface EventsQuery {
  page?: number
  page_size?: number
  event_type?: string | null
  shipment_no?: string | null
  since?: string | null
}

/** 全局里程碑事件（通知中心列表项）。 */
export interface EventOut {
  id: number
  shipment_id: number
  leg_id: number | null
  event_type: string
  occurred_at: string
  payload_json: string | null
  shipment_no: string | null
  shipment_status: string | null
}

/** 事件分页结果。 */
export interface PagedEvents {
  total: number
  page: number
  page_size: number
  items: EventOut[]
}

/** 异常筛选参数（异常中心）。 */
export interface ExceptionsQuery {
  page?: number
  page_size?: number
  type?: string | null
  level?: string | null
  unresolved_only?: boolean
}

/** 异常记录（异常中心列表项）。 */
export interface ExceptionOut {
  id: number
  shipment_id: number
  type: string
  level: string
  detail: string | null
  detected_at: string
  resolved_at: string | null
  shipment_no: string | null
  shipment_status: string | null
}

/** 异常分页结果。 */
export interface PagedExceptions {
  total: number
  page: number
  page_size: number
  items: ExceptionOut[]
}

/** 大屏地图：地点标注（港口/仓库/城市统一）。 */
export interface MapPort {
  code: string
  name: string
  lat: number
  lng: number
}

/** 大屏地图：航线段，起止经纬度已由后端 join 带出。 */
export interface MapLeg {
  seq: number
  mode: string
  /** 实时位置流按 leg_id 上报，靠它把位置增量映射回运单与段 */
  leg_id: number
  origin_code: string | null
  dest_code: string | null
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
  status: string
  /** 活动段最近轨迹点（[lng, lat, ts_ms] 升序）：
   * 既是「实际轨迹」的历史垫底，也供时间轴回放按当前时刻切片；
   * ts_ms 为 UTC epoch 毫秒。 */
  track: [number, number, number][]
}

/** 大屏地图：运单航线，聚合各段供按运单着色与点击交互。 */
export interface MapRoute {
  shipment_id: number
  shipment_no: string
  status: string
  latest_lat: number | null
  latest_lng: number | null
  legs: MapLeg[]
}

/** 大屏地图聚合数据：地点 + 航线，一次请求拿全。 */
export interface MapOverview {
  ports: MapPort[]
  routes: MapRoute[]
}
