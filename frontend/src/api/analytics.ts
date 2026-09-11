// 运营看板聚合接口：对齐后端 app/api/routes/analytics.py 的返回结构。
import { request } from '@/api/client'
import type { AnalyticsSummary } from '@/types/analytics'

/** 运营看板总入口：整体准点率 + 延误分布 + 承运商对比 + 趋势 + 延误原因，一次拿全。
 *  days 不传则全部；传则按「计划到达日期」取最近 N 天。 */
export function getAnalyticsSummary(params: { days?: number } = {}) {
  const qs = params.days ? `?days=${params.days}` : ''
  return request<AnalyticsSummary>(`/analytics/summary${qs}`)
}
