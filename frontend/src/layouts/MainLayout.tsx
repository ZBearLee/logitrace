import { useEffect, useState } from 'react'
import { Button, Layout, Menu, Space, Typography } from 'antd'
import {
  LogoutOutlined,
  MacCommandOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { matchRoute, routes } from '@/router'
import { clearSession, getUser } from '@/utils/auth'
import { getAiStatus } from '@/api/ai'
import StatusIndicator from '@/components/StatusIndicator'
import RouteBreadcrumb from '@/components/RouteBreadcrumb'
import EventNotifier from '@/components/EventNotifier'
import CommandPalette from '@/components/CommandPalette'

const { Header, Sider, Content } = Layout

export default function MainLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = getUser()

  // AI 能力开关：决定命令面板入口是否展示（无 Key 全降级，CI 与离线环境不受影响）
  const [aiEnabled, setAiEnabled] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    // oxlint-disable-next-line react/hook-dependencies -- 仅挂载时探一次能力开关，无需进依赖
    getAiStatus()
      .then((s) => setAiEnabled(s.enabled))
      .catch(() => setAiEnabled(false))
  }, [])
  useEffect(() => {
    // 全局 Ctrl/⌘+K 唤起命令面板：与输入框聚焦互不冲突（输入框内也允许唤起）
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 当前路由元信息：大屏页让 Sider 默认折叠，给地图让位；数据页默认展开
  // 用 matchRoute 而非 routes.find 精确匹配：详情页 /shipments/12 要命中 /shipments/:id，
  // 否则 current 为 undefined，侧边栏选中态会丢。
  const current = matchRoute(pathname)

  // 折叠状态受路由驱动：切到大屏页自动折叠，切回数据页自动展开；
  // 同页内手动展开/收起后保持，直到再次切换路由
  const [collapsed, setCollapsed] = useState(current?.fullscreen ?? false)
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 路由切换时需把 Sider 折叠态重置为该路由的 fullscreen 值，属外部系统（路由）同步，非多余渲染
    setCollapsed(current?.fullscreen ?? false)
  }, [pathname, current?.fullscreen])

  // 菜单从路由派生，自动带图标；hidden 项不进菜单
  const menuItems = routes
    .filter((r) => !r.hidden)
    .map((r) => ({ key: r.path, label: r.label, icon: r.icon }))

  return (
    <Layout style={{ height: '100vh' }}>
      <EventNotifier />
      <Sider
        theme="dark"
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        collapsedWidth="64"
        trigger={null}
      >
        <div
          style={{
            color: '#fff',
            fontWeight: 600,
            textAlign: 'center',
            padding: '16px 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {collapsed ? 'LT' : 'LogiTrace'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          // 选中态用匹配到的路由 path（/shipments），而不是原始 pathname（/shipments/12），
          // 否则详情页没有任何菜单项被选中。
          selectedKeys={[current?.path ?? pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            height: 48,
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((c) => !c)}
            />
            <RouteBreadcrumb />
          </div>
          <Space size={12}>
            {aiEnabled && (
              <Button
                type="text"
                icon={<MacCommandOutlined />}
                onClick={() => setPaletteOpen(true)}
                title="命令面板 (Ctrl+K)"
              >
                命令面板
              </Button>
            )}
            <StatusIndicator />
            {user && <Typography.Text type="secondary">{user.username}</Typography.Text>}
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                clearSession()
                navigate('/login', { replace: true })
              }}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content
          style={{
            margin: current?.fullscreen ? 0 : 16,
            padding: current?.fullscreen ? 0 : undefined,
            position: 'relative',
            // 内容区不滚动：滚动交给页面/表格内部，避免内外两层滚动条。
            // minHeight:0 是必需的——flex item 默认 min-height:auto 会被内容撑高，
            // 从而顶破外层 100vh 容器，导致整个页面（连侧边栏和头部）一起滚。
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        enabled={aiEnabled}
      />
    </Layout>
  )
}
