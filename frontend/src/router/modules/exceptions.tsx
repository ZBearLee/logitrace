import { AlertOutlined } from '@ant-design/icons'
import type { AppRoute } from '../types'
import Exceptions from '../../pages/Exceptions'

export const exceptionsRoutes: AppRoute[] = [
  { path: '/exceptions', label: '异常', icon: <AlertOutlined />, element: <Exceptions /> },
]
