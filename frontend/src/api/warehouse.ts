// 仓库数字孪生接口：对齐后端 app/api/routes/warehouse.py 的返回结构。
import { request } from '@/api/client'
import type { WarehouseLayout } from '@/types/warehouse'

/** 仓库 3D 场景数据源：库位布局 + 月台状态 + 在库作业任务，一次拿全。 */
export function getWarehouseLayout(id: number) {
  return request<WarehouseLayout>(`/warehouse/${id}/layout`)
}
