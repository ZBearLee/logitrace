import { DashboardOutlined } from '@ant-design/icons'
import type { AppRoute } from '../types'
import Dashboard from '../../pages/dashboard/Dashboard'

export const dashboardRoutes: AppRoute[] = [
  {
    path: '/dashboard',
    label: '总览',
    icon: <DashboardOutlined />,
    element: <Dashboard />,
    fullscreen: true,
  },
]
