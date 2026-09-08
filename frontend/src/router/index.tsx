/* oxlint-disable react/only-export-components -- 路由聚合配置：导出 routes/DEFAULT_ROUTE 常量为设计意图，非组件文件，fast-refresh 不适用 */
import { Routes, Route, Navigate } from 'react-router-dom'
import type { AppRoute } from '@/router/types'
import MainLayout from '@/layouts/MainLayout'
import { dashboardRoutes } from '@/router/modules/dashboard'
import { shipmentsRoutes } from '@/router/modules/shipments'
import { exceptionsRoutes } from '@/router/modules/exceptions'

/** 路由聚合：各模块路由在 modules/ 内声明，这里统一收口 */
export const routes: AppRoute[] = [...dashboardRoutes, ...shipmentsRoutes, ...exceptionsRoutes]

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
