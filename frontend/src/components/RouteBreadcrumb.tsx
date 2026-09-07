import { Breadcrumb } from 'antd'
import { useLocation } from 'react-router-dom'
import { routes } from '../router'

/**
 * 头部面包屑：父级（平台根）+ 当前路由逐级 label。
 * 由 pathname 在 routes 配置中逐段前缀匹配生成，将来嵌套详情页可自然延伸层级。
 */
export default function RouteBreadcrumb() {
  const { pathname } = useLocation()
  const segs = pathname.split('/').filter(Boolean)
  const trail: string[] = []
  let acc = ''
  for (const seg of segs) {
    acc += `/${seg}`
    const r = routes.find((x) => x.path === acc)
    if (r) trail.push(r.label)
  }
  const items = trail.map((t) => ({ title: t }))
  return <Breadcrumb items={items} />
}
