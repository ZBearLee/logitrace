// 物流关系网络接口：对齐后端 app/api/routes/network.py 的返回结构。
import { request } from '@/api/client'
import type { NetworkGraph } from '@/types/network'

/** 关系网络总入口：口岸↔口岸航线 + 承运商服务口岸，一次拿全。 */
export function getNetworkGraph() {
  return request<NetworkGraph>('/network/graph')
}
