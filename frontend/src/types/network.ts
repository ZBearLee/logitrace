/** 物流关系网络数据类型：对齐后端 /network/graph 的返回结构。 */

export interface NetworkNode {
  /** 带前缀主键：loc-{id} 或 car-{id}，避免两类主键撞 id */
  id: string
  label: string
  /** 'location' | 'carrier' */
  type: string
  /** 关联运单总数，决定节点大小 */
  volume: number
  location_type?: string | null
  country?: string | null
  carrier_mode?: string | null
}

export interface NetworkEdge {
  source: string
  target: string
  /** 'lane' | 'serve' */
  type: string
  weight: number
  /** lane 才有：sea/road/air/rail，用于上色 */
  mode?: string | null
}

export interface NetworkGraph {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
}
