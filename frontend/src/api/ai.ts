// AI 赋能接口：状态开关 / NL 查数 / 异常日报 / 单票 ETA。
// 全部走统一 request()，鉴权头已在内部注入；调用前需已登录（路由守卫保证）。
import { request } from '@/api/client'

import type { AiQueryOut, AiStatus, DailyReportOut, EtaOut } from '@/types/ai'

/** AI 能力开关：前端据此渲染/隐藏入口（无 Key 全降级）。 */
export function getAiStatus() {
  return request<AiStatus>('/ai/status')
}

/** 自然语言查运单：一句自然语言 → LLM 解析参数 → 白名单校验 → 落到既有查询。 */
export function queryAi(question: string) {
  return request<AiQueryOut>('/ai/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
}

/** 异常日报：优先读表，缺当天记录时按需生成。 */
export function getDailyReport(date?: string) {
  const qs = date ? `?date=${date}` : ''
  return request<DailyReportOut>(`/ai/daily-report${qs}`)
}

/** 单票 ETA 预测（最新一条）。 */
export function getEta(shipmentId: number) {
  return request<EtaOut>(`/ai/eta/${shipmentId}`)
}
