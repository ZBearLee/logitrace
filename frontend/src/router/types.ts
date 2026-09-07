import type { ReactNode } from 'react'

export interface AppRoute {
  /** 路由路径（绝对路径，同时用作菜单 key） */
  path: string
  /** 菜单显示名 */
  label: string
  /** 菜单图标 */
  icon?: ReactNode
  /** 页面组件 */
  element: ReactNode
  /** 大屏页：Sider 默认折叠 + Content 满铺，留给地图/地球 */
  fullscreen?: boolean
  /** true 则不进菜单（如详情页） */
  hidden?: boolean
}
