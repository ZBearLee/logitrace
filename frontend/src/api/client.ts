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
    throw e
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
