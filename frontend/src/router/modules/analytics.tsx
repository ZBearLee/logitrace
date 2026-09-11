import { BarChartOutlined } from '@ant-design/icons'
import type { AppRoute } from '@/router/types'
import Analytics from '@/pages/analytics/Analytics'

export const analyticsRoutes: AppRoute[] = [
  {
    path: '/analytics',
    label: '运营分析',
    icon: <BarChartOutlined />,
    element: <Analytics />,
  },
]
