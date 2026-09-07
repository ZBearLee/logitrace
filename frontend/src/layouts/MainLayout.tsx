import { Layout, Menu, Typography } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Header, Sider, Content } = Layout

const items = [
  { key: '/dashboard', label: '总览' },
  { key: '/shipments', label: '运单' },
  { key: '/exceptions', label: '异常' },
]

export default function MainLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" breakpoint="lg" collapsedWidth="64">
        <div style={{ color: '#fff', padding: '16px 20px', fontWeight: 600 }}>LogiTrace</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', display: 'flex', alignItems: 'center' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            实时物流追踪平台
          </Typography.Title>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}