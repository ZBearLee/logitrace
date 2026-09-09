// 登录接口：走 client.ts 的 request()，与其他接口共用错误分类逻辑。
import { request } from '@/api/client'

import type { LoginIn, LoginOut } from '@/types/auth'

export function login(body: LoginIn) {
  return request<LoginOut>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
