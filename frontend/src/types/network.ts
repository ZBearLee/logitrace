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
  /** 该节点关联运单的准点率（0-1），无评分样本时为 null */
  on_time_rate?: number | null
  /** 'single_carrier'（口岸只被 1 个承运商服务）/ 'single_port'（承运商只服务 1 个口岸） */
  risk?: string | null
  /** location：服务它的不同承运商数；carrier：它服务的不同口岸数 */
  served_by?: number | null
  serves?: number | null
  /** 主要合作方名称（口岸=承运商名 / 承运商=口岸名），按运量降序取前 5 */
  partners?: string[]
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
