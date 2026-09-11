// 运营看板聚合接口：对齐后端 app/api/routes/analytics.py 的返回结构。
import { request } from '@/api/client'
import type { AnalyticsSummary } from '@/types/analytics'

/** 运营看板总入口：整体准点率 + 延误分布 + 承运商对比，一次拿全。 */
export function getAnalyticsSummary() {
  return request<AnalyticsSummary>('/analytics/summary')
}
