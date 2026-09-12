/** 仓库数字孪生类型：对齐后端 /warehouse/{id}/layout 的返回结构。 */

/** 库位状态：有货 / 空位 / 预占（决定 InstancedMesh 实例颜色）。 */
export type SlotStatus = 'occupied' | 'empty' | 'reserved'

export interface WarehouseSlot {
  /** 实例下标，与 Three.js InstancedMesh 的 instanceId 一一对应，拾取时靠它反查 */
  index: number
  row: number
  col: number
  level: number
  status: SlotStatus
  shipment_no?: string | null
  sku?: string | null
}

export interface WarehouseDock {
  code: string
  status: 'loading' | 'idle'
  shipment_no?: string | null
}

/** 在库作业任务：月台 → 目标库位，场景里的搬运动画据此驱动。 */
export interface WarehouseFlow {
  shipment_no: string
  from_dock: string
  to_slot: number
}

export interface WarehouseLayout {
  id: number
  code: string
  name: string
  rows: number
  cols: number
  levels: number
  occupancy_rate: number
  slots: WarehouseSlot[]
  docks: WarehouseDock[]
  flows: WarehouseFlow[]
}
