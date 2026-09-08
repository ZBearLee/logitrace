import { useEffect, useState } from 'react'
import { Badge, Spin, Typography } from 'antd'
import { getHealth, type HealthResponse } from '@/api/client'

/**
 * 全局健康状态指示灯：在 MainLayout 的 Header 常驻，
 * 定时探活后端，任何页面都能看到连通状态（不再绑定到某个页面）。
 */
export default function StatusIndicator() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const check = () => {
      getHealth()
        .then((h) => {
          if (!alive) return
          setHealth(h)
          setError(false)
        })
        .catch(() => {
          if (alive) setError(true)
        })
    }
    check()
    const timer = setInterval(check, 15000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (error) {
    return (
      <Badge status="error" text={<Typography.Text type="danger">后端未连通</Typography.Text>} />
    )
  }
  if (health) {
    return <Badge status="success" text={`${health.app} · ${health.status}`} />
  }
  return <Spin size="small" />
}
