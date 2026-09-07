import { Routes, Route, Navigate } from 'react-router-dom'
import type { AppRoute } from './types'
import MainLayout from '../layouts/MainLayout'
import { dashboardRoutes } from './modules/dashboard'
import { shipmentsRoutes } from './modules/shipments'
import { exceptionsRoutes } from './modules/exceptions'

/** 路由聚合：各模块路由在 modules/ 内声明，这里统一收口 */
export const routes: AppRoute[] = [
  ...dashboardRoutes,
  ...shipmentsRoutes,
  ...exceptionsRoutes,
]

export const DEFAULT_ROUTE = '/dashboard'

/** 路由渲染封装，App.tsx 只负责挂载 BrowserRouter */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to={DEFAULT_ROUTE} replace />} />
        {routes.map((r) => (
          <Route key={r.path} path={r.path.replace(/^\//, '')} element={r.element} />
        ))}
      </Route>
    </Routes>
  )
}
