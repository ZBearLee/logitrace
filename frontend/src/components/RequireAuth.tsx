// 路由守卫：未登录时重定向到登录页。
// 真正的鉴权在后端（业务接口返回 401），这里只是让未登录的人先看到登录页，不展示一个取不到数据的空壳。
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getToken } from '@/utils/auth'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()

  if (!getToken()) {
    // 带上来源路径，登录后可以回到原本要去的页面
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
