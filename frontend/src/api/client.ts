// 统一请求层：所有接口走 request()，集中处理 baseURL / 错误 / 将来鉴权
const BASE = '/api'

export class ApiError extends Error {
  declare status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const DEFAULT_TIMEOUT = 10000

export async function request<T>(
  path: string,
  options?: RequestInit & { timeout?: number },
): Promise<T> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: options?.signal ?? controller.signal,
    })
    if (!res.ok) {
      throw new ApiError(res.status, `请求失败 ${path}: ${res.status}`)
    }
    return res.json() as Promise<T>
  } catch (e) {
    // 超时（AbortController 触发）转成可读错误，而不是抛出原始 AbortError
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(0, `请求超时 ${path} (${timeout}ms)`)
    }
    // HTTP 错误（上面 throw 的 ApiError）原样上抛，保留真实状态码，
    // 否则 4xx 会被误判成可重试的网络故障
    if (e instanceof ApiError) throw e
    // 网络层异常（断网时 fetch 直接 reject）统一归为 status 0，
    // 保证「错误分类唯一来源」：下游只需判断 ApiError.status 即可分类与决定文案
    throw new ApiError(0, `网络异常 ${path}`)
  } finally {
    clearTimeout(timer)
  }
}

export interface HealthResponse {
  status: string
  app: string
}

export function getHealth() {
  return request<HealthResponse>('/health')
}

// 业务闭环阶段在此追加：getShipments / getExceptions ... 均复用 request()
// 将来需要鉴权时，在 request() 内统一注入 Authorization 头即可
