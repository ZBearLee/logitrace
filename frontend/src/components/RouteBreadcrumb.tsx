import type { MouseEvent } from 'react'
import { Breadcrumb } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { matchRoute } from '@/router'

/**
 * 头部面包屑：由 pathname 逐段累加，在 routes 配置里查出对应 label 逐级展示。
 * 用 matchRoute 而非 path 相等，动态路由（/shipments/12）才能显示到详情页这一级。
 * 除当前页外的层级都可点击回跳。
 */
export default function RouteBreadcrumb() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const segs = pathname.split('/').filter(Boolean)
  const trail: { label: string; path: string }[] = []
  let acc = ''
  for (const seg of segs) {
    acc += `/${seg}`
    const r = matchRoute(acc)
    if (r) trail.push({ label: r.label, path: acc })
  }

  const items = trail.map((t, index) => {
    // 末级是当前所在页，不作为链接
    if (index === trail.length - 1) return { title: t.label }
    // href 让 antd 渲染成带手型的 <a>，onClick 拦截默认跳转改用 navigate，避免整页刷新
    return {
      title: t.label,
      href: t.path,
      onClick: (e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        navigate(t.path)
      },
    }
  })

  return <Breadcrumb items={items} />
}
