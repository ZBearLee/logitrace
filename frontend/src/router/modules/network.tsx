import { NodeIndexOutlined } from '@ant-design/icons'
import type { AppRoute } from '@/router/types'
import Network from '@/pages/network/Network'

export const networkRoutes: AppRoute[] = [
  {
    path: '/network',
    label: '关系网络',
    icon: <NodeIndexOutlined />,
    element: <Network />,
  },
]
