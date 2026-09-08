// 统一错误呈现组件，两种粒度：
// - inline：局部数据失败时嵌在表格/卡片内，保持布局不塌，且不提供任何按钮
// - page：页面级失败时整页展示，出口是调用方传入的业务动作（如返回列表）
// 文案由「场景 + 实体」推导：不暴露状态码、接口路径、技术异常串，技术细节只进 console。
import type { ReactNode } from 'react'
import { Empty, Result } from 'antd'
import { ApiError } from '@/api/client'

type Size = 'inline' | 'page'

/** list：集合类（列表/看板），永不提示「内容不存在」；detail：单个资源 */
type Scope = 'list' | 'detail'

type ResultStatus = 'success' | 'error' | 'info' | 'warning' | '404' | '403' | '500'

export interface ErrorStateProps {
  error: unknown
  /**
   * 必填：强制调用方声明场景，从类型上杜绝用错文案。
   * 集合类接口即使返回 404 也多是接口契约问题，不能说成「内容不存在」。
   */
  scope: Scope
  /** inline：表格/卡片内；page：整页 Result */
  size?: Size
  /** 业务实体名，如「运单」，用于生成准确文案 */
  entity?: string
  /** 业务化文案：传入后优先于推导结果，用于特殊场景覆盖 */
  message?: string
  /** 整页失败时的业务动作（如「返回列表」）。由调用方传入，组件不内置任何「重试」按钮 */
  extra?: ReactNode
}

/** 错误 + 场景 → 用户可读文案 */
const describe = (error: unknown, scope: Scope, entity?: string): string => {
  const subject = entity ?? '内容'
  const status = error instanceof ApiError ? error.status : null

  // 集合类：拿不到数据就是拿不到，与「资源是否存在」无关
  if (scope === 'list') {
    if (status === 0) return '网络似乎不太稳定'
    if (status !== null && status >= 500) return '服务暂时不可用，请稍后再试'
    return `${subject}数据暂时加载不出来`
  }

  if (status === 0) return '网络似乎不太稳定'
  if (status === 404) return `${subject}不存在或已被删除`
  if (status === 403) return '没有访问该内容的权限'
  if (status !== null && status >= 500) return '服务暂时不可用，请稍后再试'
  return '数据暂时加载不出来'
}

/** 错误 + 场景 → antd Result 的 status */
const resultStatus = (error: unknown, scope: Scope): ResultStatus => {
  // 列表失败统一用警告态，不伪装成 404/500 这类资源级语义
  if (scope === 'list') return 'warning'
  if (error instanceof ApiError) {
    if (error.status === 404) return '404'
    if (error.status === 403) return '403'
    if (error.status >= 500) return '500'
  }
  return 'warning'
}

export default function ErrorState({
  error,
  scope,
  size = 'inline',
  entity,
  message,
  extra,
}: ErrorStateProps) {
  const text = message ?? describe(error, scope, entity)

  if (size === 'inline') {
    // 局部失败：安静占住原位，不打断页面布局
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />
  }

  // 整页失败：出口是业务动作，而非技术性的重试
  return <Result status={resultStatus(error, scope)} title={text} extra={extra} />
}
