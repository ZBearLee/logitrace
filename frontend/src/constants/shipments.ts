// 运单状态 / 运输模式的「展示映射层」。
// 后端返回英文枚举（如 planned / sea），前端统一为中文并兜底未知值。
// 类型取自 api/shipments 的数据契约，避免重复定义、保持单一来源。
import type { ShipmentStatus, TransportMode } from '@/types/shipments'

/** 状态中文文案 */
export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  planned: '已计划',
  in_transit: '运输中',
  delivered: '已送达',
  delayed: '延误',
}

/** 状态对应的 antd Tag 颜色 */
export const STATUS_COLOR: Record<ShipmentStatus, string> = {
  planned: 'default',
  in_transit: 'processing',
  delivered: 'success',
  delayed: 'error',
}

/** 状态筛选项（Select options），由 STATUS_LABEL 推导，文案单一来源 */
export const STATUS_OPTIONS: { value: ShipmentStatus; label: string }[] = (
  Object.keys(STATUS_LABEL) as ShipmentStatus[]
).map((value) => ({ value, label: STATUS_LABEL[value] }))

/** 运输模式中文文案 */
export const MODE_LABEL: Record<TransportMode, string> = {
  sea: '海运',
  air: '空运',
  rail: '铁路',
  road: '公路',
}

/** 运输模式对应的 antd Tag 颜色 */
export const MODE_COLOR: Record<TransportMode, string> = {
  sea: 'blue',
  air: 'cyan',
  rail: 'purple',
  road: 'green',
}

/** 状态取中文，未知值兜底原样返回 */
export const statusLabel = (s: string): string => STATUS_LABEL[s as ShipmentStatus] ?? s

/** 状态取颜色，未知值兜底 'default' */
export const statusColor = (s: string): string => STATUS_COLOR[s as ShipmentStatus] ?? 'default'

/** 模式取中文，未知值兜底原样返回 */
export const modeLabel = (m: string): string => MODE_LABEL[m as TransportMode] ?? m

/** 模式取颜色，未知值兜底 'default' */
export const modeColor = (m: string): string => MODE_COLOR[m as TransportMode] ?? 'default'

/** 里程碑事件类型中文文案（后端 event_type 为英文枚举） */
export const EVENT_LABEL: Record<string, string> = {
  picked_up: '提货',
  loaded: '装运',
  departed: '离港',
  arrived: '到港',
  delivered: '签收',
  delayed: '延误',
  stalled: '滞留',
}

/** 事件类型取中文，未知值兜底原样返回 */
export const eventLabel = (e: string): string => EVENT_LABEL[e] ?? e
