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

export interface AnalyticsSummary {
  total_rated: number
  on_time: number
  delayed: number
  on_time_rate: number
  delay_buckets: DelayBucket[]
  carriers: CarrierMetric[]
}
