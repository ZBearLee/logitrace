import { AlertOutlined } from '@ant-design/icons'
import type { AppRoute } from '@/router/types'
import Exceptions from '@/pages/exceptions/Exceptions'

export const exceptionsRoutes: AppRoute[] = [
  { path: '/exceptions', label: '异常', icon: <AlertOutlined />, element: <Exceptions /> },
]
