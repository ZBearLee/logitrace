// 登录会话：令牌与账号信息存 localStorage，供请求层注入 Authorization、供路由守卫判断是否已登录。
const TOKEN_KEY = 'logitrace.token'
const USER_KEY = 'logitrace.user'

export interface SessionUser {
  username: string
  role: string
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionUser
  } catch {
    // 内容被改坏时按未登录处理，不要让应用卡在启动阶段
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export function setSession(token: string, user: SessionUser): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
