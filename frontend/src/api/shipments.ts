// 运单相关接口：对齐后端 app/api/routes/shipments.py 的真实返回结构。
// 业务闭环阶段统一走 client.ts 的 request()，将来鉴权在 request() 内注入即可。
import { request } from '@/api/client'

import type {
  ShipmentDetail,
  MilestoneEventOut,
  PositionPointOut,
  PagedShipments,
  ShipmentsQuery,
} from '@/types/shipments'

/** 运单列表：分页 + 按状态筛选。 */
export function getShipments(q: ShipmentsQuery = {}) {
  const params = new URLSearchParams()
  if (q.page) params.set('page', String(q.page))
  if (q.page_size) params.set('page_size', String(q.page_size))
  if (q.status) params.set('status', q.status)
  if (q.shipment_no) params.set('shipment_no', q.shipment_no)
  const qs = params.toString()
  return request<PagedShipments>(`/shipments${qs ? `?${qs}` : ''}`)
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
