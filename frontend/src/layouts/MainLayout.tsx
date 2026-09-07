import { useEffect, useState } from 'react'
import { Button, Layout, Menu } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { routes } from '../router'
import StatusIndicator from '../components/StatusIndicator'
import RouteBreadcrumb from '../components/RouteBreadcrumb'

const { Header, Sider, Content } = Layout

export default function MainLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // 当前路由元信息：大屏页让 Sider 默认折叠，给地图让位；数据页默认展开
  const current = routes.find((r) => r.path === pathname)

  // 折叠状态受路由驱动：切到大屏页自动折叠，切回数据页自动展开；
  // 同页内手动展开/收起后保持，直到再次切换路由
  const [collapsed, setCollapsed] = useState(current?.fullscreen ?? false)
  useEffect(() => {
    setCollapsed(current?.fullscreen ?? false)
  }, [pathname, current?.fullscreen])

  // 菜单从路由派生，自动带图标；hidden 项不进菜单
  const menuItems = routes
    .filter((r) => !r.hidden)
    .map((r) => ({ key: r.path, label: r.label, icon: r.icon }))

  return (
    <Layout style={{ height: '100vh' }}>
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
          selectedKeys={[pathname]}
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
          <StatusIndicator />
        </Header>
        <Content
          style={{
            margin: current?.fullscreen ? 0 : 16,
            padding: current?.fullscreen ? 0 : undefined,
            position: 'relative',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
