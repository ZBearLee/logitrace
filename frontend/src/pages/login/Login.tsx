// 登录页：校验演示账号，成功后保存令牌并进入系统。
import { useState } from 'react'
import { Button, Card, Form, Input, Typography, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { setSession } from '@/utils/auth'

interface LoginForm {
  username: string
  password: string
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)

  // 被守卫拦下来的页面会把原路径带过来，登录后回到那里
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  const onFinish = async (values: LoginForm) => {
    setSubmitting(true)
    try {
      const res = await login(values)
      setSession(res.access_token, { username: res.username, role: res.role })
      navigate(from, { replace: true })
    } catch (e) {
      // 登录失败只区分「凭据不对」和「服务不可用」两类，不暴露更多细节
      const status = e instanceof ApiError ? e.status : 0
      message.error(status === 401 ? '用户名或密码错误' : '登录失败，请检查服务后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ textAlign: 'center', marginBottom: 24 }}>
          LogiTrace
        </Typography.Title>
        <Form<LoginForm> onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoFocus />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
