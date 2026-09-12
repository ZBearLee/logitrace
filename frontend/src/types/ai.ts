// AI 赋能相关类型：与后端 app/api/schemas.py 的 AI 部分对齐。

/** AI 能力开关：前端据此决定渲染还是隐藏入口（无 Key 全降级）。 */
export interface AiStatus {
  enabled: boolean
  model: string | null
  /** ETA 模型产物是否已训练落盘（服务化的前提） */
  eta_ready: boolean
}

/** NL 查数结果项：带起止港经纬度，便于直接派发地图联动。 */
export interface ShipmentBrief {
  id: number
  shipment_no: string
  status: string
  origin_code: string | null
  dest_code: string | null
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
  carrier_name: string | null
  planned_departure: string | null
  planned_arrival: string | null
  actual_departure: string | null
  actual_arrival: string | null
  latest_lat: number | null
  latest_lng: number | null
  latest_ts: string | null
}

/** NL 查数结果：解析出的查询参数（透明可审计）+ 命中的运单。 */
export interface AiQueryOut {
  params: Record<string, unknown>
  total: number
  items: ShipmentBrief[]
  latency_ms: number
}

/** 异常日报结构化统计。 */
export interface DailyReportStats {
  date: string
  total: number
  by_type: Record<string, number>
  by_level: Record<string, number>
  top_delayed: Array<{
    shipment_no: string
    origin: string
    dest: string
    delay_hours: number
  }>
}

/** 异常日报：摘要 + 结构化统计（前端卡片自行渲染数字）。 */
export interface DailyReportOut {
  report_date: string
  summary: string
  stats: DailyReportStats
  source: string
  created_at: string
}

/** 单票 ETA 预测：模型到达时间 + 置信度 + 相对计划的偏差。 */
export interface EtaOut {
  shipment_id: number
  predicted_arrival: string
  confidence: number
  model_version: string
  features_json: string | null
  deviation_hours: number | null
  created_at: string
}
