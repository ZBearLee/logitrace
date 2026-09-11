// 物流关系网络（V2.1 D3 力导向）：口岸↔口岸航线 + 承运商服务口岸，后端一次聚合，D3 手写布局。
import { useEffect, useState } from 'react'
import { Card, Spin, Typography } from 'antd'
import { getNetworkGraph } from '@/api/network'
import type { NetworkGraph } from '@/types/network'
import NetworkForce from './components/NetworkForce'

const { Title, Text } = Typography

const MODE_COLOR: Record<string, string> = {
  sea: '#2f81f7',
  road: '#f0a020',
  air: '#e3529c',
  rail: '#3fb950',
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#1677ff' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          口岸
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f0a020' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          承运商
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 18,
            height: 0,
            borderTop: '2px solid #9fb4cc',
            background: 'transparent',
          }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          航线（实线，按运输方式上色）
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 18, height: 0, borderTop: '2px dashed #9aa7b5' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          承运商服务口岸（虚线）
        </Text>
      </span>
      {Object.entries(MODE_COLOR).map(([mode, color]) => (
        <span key={mode} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 3, background: color }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {mode}
          </Text>
        </span>
      ))}
    </div>
  )
}

export default function Network() {
  const [data, setData] = useState<NetworkGraph | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    getNetworkGraph()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        /* 静默失败：网络留空 */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <Title level={4} style={{ marginTop: 0 }}>
        物流关系网络
      </Title>
      <Text type="secondary">
        口岸与承运商的关系拓扑：航线按运输方式着色，节点大小随运单量变化。可拖拽节点、滚轮缩放。
      </Text>

      <Spin spinning={loading}>
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
            <NetworkForce data={data ?? { nodes: [], edges: [] }} />
          </div>
          <Legend />
        </Card>
      </Spin>
    </div>
  )
}
