/* oxlint-disable react/only-export-components -- 路由聚合配置：导出 routes/DEFAULT_ROUTE 常量为设计意图，非组件文件，fast-refresh 不适用 */
import { Routes, Route, Navigate } from 'react-router-dom'
import type { AppRoute } from '@/router/types'
import MainLayout from '@/layouts/MainLayout'
import Login from '@/pages/login/Login'
import RequireAuth from '@/components/RequireAuth'
import { dashboardRoutes } from '@/router/modules/dashboard'
import { shipmentsRoutes } from '@/router/modules/shipments'
import { exceptionsRoutes } from '@/router/modules/exceptions'
import { notificationsRoutes } from '@/router/modules/notifications'
import { analyticsRoutes } from '@/router/modules/analytics'
import { networkRoutes } from '@/router/modules/network'

/** 路由聚合：各模块路由在 modules/ 内声明，这里统一收口 */
export const routes: AppRoute[] = [
  ...dashboardRoutes,
  ...shipmentsRoutes,
  ...exceptionsRoutes,
  ...notificationsRoutes,
  ...analyticsRoutes,
  ...networkRoutes,
]

// 默认落地到大屏总览（带 KPI 概览卡片的控制塔主视图）。
export const DEFAULT_ROUTE = '/dashboard'

/**
 * 按 pathname 匹配路由，支持动态段（如 /shipments/:id 匹配 /shipments/12）。
 * 菜单、Sider 选中态用 path 相等判断即可；面包屑这类需要认出「当前正停在详情页」的场景用这个。
 */
export function matchRoute(pathname: string): AppRoute | undefined {
  return routes.find((r) => {
    const pattern = r.path.replace(/:[^/]+/g, '[^/]+')
    return new RegExp(`^${pattern}$`).test(pathname)
  })
}

/** 路由渲染封装，App.tsx 只负责挂载 BrowserRouter */
export function AppRoutes() {
  return (
    <Routes>
      {/* 登录页在守卫之外：它本身就是未登录时的去处 */}
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <MainLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to={DEFAULT_ROUTE} replace />} />
        {routes.map((r) => (
          <Route key={r.path} path={r.path.replace(/^\//, '')} element={r.element} />
        ))}
      </Route>
    </Routes>
  )
}
