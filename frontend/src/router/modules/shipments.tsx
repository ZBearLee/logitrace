import { TableOutlined } from '@ant-design/icons'
import type { AppRoute } from '../types'
import Shipments from '../../pages/shipments/Shipments'

export const shipmentsRoutes: AppRoute[] = [
  { path: '/shipments', label: '运单', icon: <TableOutlined />, element: <Shipments /> },
]
