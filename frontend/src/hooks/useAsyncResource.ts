// 统一取数 hook：竞态保护 + 自动重试（指数退避）+ 卸载清理。
// - 网络/超时/5xx 自动重试（1s → 2s → 4s，最多 3 次），重试期间不改变 UI
// - 4xx 不重试（重试无意义，且会掩盖接口契约问题）
// - 所有 setState 都在异步回调，避免 effect 同步阶段触发级联渲染
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'

const MAX_RETRY = 3
const BASE_DELAY = 1000

/** 可重试判定：超时/网络（status 0）与 5xx 属可恢复故障；4xx 直接失败 */
const isRetryable = (e: unknown): boolean => {
  if (e instanceof ApiError) return e.status === 0 || e.status >= 500
  return true // 非 ApiError（如 fetch 网络异常）按可恢复处理
}

export interface AsyncResource<T> {
  /** 最新数据；失败时保留上一次成功结果（stale），供优雅降级 */
  data: T | null
  loading: boolean
  error: unknown
  /** 手动重取（供刷新类交互；业务界面不暴露「重试」按钮） */
  retry: () => void
}

/**
 * 统一取数。业务页面只消费状态，不写 try/catch、不写错误处理逻辑。
 * @param fetcher 取数函数，接收 signal（可选取消）
 * @param deps    依赖数组，变化时自动重取（长度需保持稳定）
 */
export function useAsyncResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null)
  // 初始即 loading：省掉 effect 同步阶段的 setLoading(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)

  // fetcher 每次渲染都是新函数，用 ref 持有，避免进入 deps 导致 effect 反复重跑
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const retry = useCallback(() => {
    setLoading(true)
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    let alive = true
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const run = async (): Promise<void> => {
      try {
        const res = await fetcherRef.current(controller.signal)
        if (!alive) return
        setData(res)
        setError(null)
        setLoading(false)
      } catch (e) {
        if (!alive) return
        if (isRetryable(e) && attempt < MAX_RETRY) {
          attempt += 1
          // 1s → 2s → 4s，加抖动避免多个请求同时重试造成尖峰
          const delay = BASE_DELAY * 2 ** (attempt - 1) + Math.random() * 200
          timer = setTimeout(run, delay)
          return
        }
        setError(e)
        setLoading(false)
      }
    }
    void run()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      controller.abort()
    }
    // deps 由调用方传入，tick 用于手动重取；fetcher 走 ref 不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  // 网络恢复 / 页面重新可见时自动重取。
  // 仅在处于错误状态时监听，避免正常情况下切回页面也发请求。
  useEffect(() => {
    if (error == null) return
    const onOnline = () => retry()
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [error, retry])

  return { data, loading, error, retry }
}
