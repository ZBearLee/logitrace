import { Card, Descriptions, Tag, Alert, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { getHealth, type HealthResponse } from '../api/client'

export default function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card title="系统状态">
      {loading && <Spin />}
      {error && <Alert type="error" message={`后端未连通：${error}`} showIcon />}
      {health && (
        <Descriptions column={1} size="small">
          <Descriptions.Item label="服务名">{health.app}</Descriptions.Item>
          <Descriptions.Item label="健康状态">
            <Tag color="success">{health.status}</Tag>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Card>
  )
}