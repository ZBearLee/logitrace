import { NotificationOutlined } from '@ant-design/icons'
import type { AppRoute } from '@/router/types'
import Notifications from '@/pages/notifications/Notifications'

export const notificationsRoutes: AppRoute[] = [
  {
    path: '/notifications',
    label: '通知中心',
    icon: <NotificationOutlined />,
    element: <Notifications />,
  },
]
