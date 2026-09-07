// 统一请求层：所有接口走 request()，集中处理 baseURL / 错误 / 将来鉴权
const BASE = '/api'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    throw new ApiError(res.status, `请求失败 ${path}: ${res.status}`)
  }
  return res.json() as Promise<T>
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
