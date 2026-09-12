import { DatabaseOutlined } from '@ant-design/icons'
import type { AppRoute } from '@/router/types'
import Warehouse from '@/pages/warehouse/Warehouse'

// 仓库 3D 场景：不直接放侧边菜单（入口是大屏点仓库标注联动进入），
// 但注册成路由以便直接访问 /warehouse/:id 与从大屏跳转。
export const warehouseRoutes: AppRoute[] = [
  {
    path: '/warehouse/:id',
    label: '仓库孪生',
    icon: <DatabaseOutlined />,
    hidden: true,
    element: <Warehouse />,
  },
]
