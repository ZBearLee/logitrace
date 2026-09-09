import { TableOutlined } from '@ant-design/icons'
import type { AppRoute } from '@/router/types'
import Shipments from '@/pages/shipments/Shipments'
import ShipmentDetail from '@/pages/shipments/ShipmentDetail'

export const shipmentsRoutes: AppRoute[] = [
  { path: '/shipments', label: '运单', icon: <TableOutlined />, element: <Shipments /> },
  // 详情页：不出现在侧边栏菜单
  { path: '/shipments/:id', label: '运单详情', hidden: true, element: <ShipmentDetail /> },
]
