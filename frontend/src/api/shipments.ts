// 运单相关接口：对齐后端 app/api/routes/shipments.py 的真实返回结构。
import { request } from '@/api/client'

import type {
  ShipmentDetail,
  MilestoneEventOut,
  PositionPointOut,
  PagedShipments,
  ShipmentsQuery,
  PagedEvents,
  PagedExceptions,
  EventsQuery,
  ExceptionsQuery,
  MapOverview,
  MapStats,
  CarrierOption,
} from '@/types/shipments'

/** 运单列表：分页 + 按状态/承运商/运单号筛选。 */
export function getShipments(q: ShipmentsQuery = {}) {
  const params = new URLSearchParams()
  if (q.page) params.set('page', String(q.page))
  if (q.page_size) params.set('page_size', String(q.page_size))
  if (q.status) params.set('status', q.status)
  if (q.carrier_id != null) params.set('carrier_id', String(q.carrier_id))
  if (q.shipment_no) params.set('shipment_no', q.shipment_no)
  const qs = params.toString()
  return request<PagedShipments>(`/shipments${qs ? `?${qs}` : ''}`)
}

/** 承运商下拉项：分析页下钻筛选运单时渲染 Select。 */
export function getCarriers() {
  return request<CarrierOption[]>('/shipments/carriers')
}

/** 运单详情（含运输段）。 */
export function getShipmentDetail(id: number) {
  return request<ShipmentDetail>(`/shipments/${id}`)
}

/** 运单历史轨迹点。 */
export function getShipmentPositions(id: number) {
  return request<PositionPointOut[]>(`/shipments/${id}/positions`)
}

/** 运单里程碑事件。 */
export function getShipmentEvents(id: number) {
  return request<MilestoneEventOut[]>(`/shipments/${id}/events`)
}

/** 全局事件流（通知中心）：分页 + 按类型/运单号/时间筛选。 */
export function getEvents(q: EventsQuery = {}) {
  const params = new URLSearchParams()
  if (q.page) params.set('page', String(q.page))
  if (q.page_size) params.set('page_size', String(q.page_size))
  if (q.event_type) params.set('event_type', q.event_type)
  if (q.shipment_no) params.set('shipment_no', q.shipment_no)
  if (q.since) params.set('since', q.since)
  const qs = params.toString()
  return request<PagedEvents>(`/events${qs ? `?${qs}` : ''}`)
}

/** 异常列表（异常中心）：分页 + 按类型/等级/未处理筛选。 */
export function getExceptions(q: ExceptionsQuery = {}) {
  const params = new URLSearchParams()
  if (q.page) params.set('page', String(q.page))
  if (q.page_size) params.set('page_size', String(q.page_size))
  if (q.type) params.set('type', q.type)
  if (q.level) params.set('level', q.level)
  if (q.unresolved_only) params.set('unresolved_only', 'true')
  const qs = params.toString()
  return request<PagedExceptions>(`/exceptions${qs ? `?${qs}` : ''}`)
}

/** 大屏地图聚合数据：港口 + 航线，一次请求拿全（避免按运单逐条请求）。 */
export function getMapOverview() {
  return request<MapOverview>('/map/overview')
}

/** 大屏概览 KPI：运单状态分布 + 今日事件数。 */
export function getMapStats() {
  return request<MapStats>('/map/stats')
}
