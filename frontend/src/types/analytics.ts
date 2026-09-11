/** 运营看板聚合数据类型：对齐后端 /analytics/summary 的返回结构。 */

export interface DelayBucket {
  /** 延误时长区间标签，如 "0-12h" */
  label: string
  /** 落入该区间的运单数 */
  count: number
}

export interface CarrierMetric {
  carrier_id: number | null
  name: string
  mode: string
  /** rated 样本数（已送达且到达时间齐全） */
  total: number
  on_time: number
  delayed: number
  /** 0-1 */
  on_time_rate: number
  avg_delay_hours: number
}

export interface TrendPoint {
  /** YYYY-MM-DD，按计划到达日期聚合 */
  date: string
  total: number
  on_time: number
  delayed: number
  /** 0-1 */
  on_time_rate: number
}

export interface DelayReason {
  /** delay / stalled / route_deviation */
  type: string
  count: number
}

/** 航线流量（桑基图）：起点口岸 → 终点口岸 的运量，按运输方式着色。 */
export interface RouteFlow {
  origin: string
  dest: string
  mode: string
  count: number
}

export interface AnalyticsSummary {
  total_rated: number
  on_time: number
  delayed: number
  on_time_rate: number
  delay_buckets: DelayBucket[]
  carriers: CarrierMetric[]
  /** 时间维度：每日趋势与延误原因拆解，让看板可下钻 */
  trend: TrendPoint[]
  delay_reasons: DelayReason[]
  /** 空间维度：起点→终点口岸运量 Top N，桑基图看全局货流走向 */
  top_routes: RouteFlow[]
}
