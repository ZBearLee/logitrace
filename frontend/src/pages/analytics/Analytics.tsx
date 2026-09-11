// 运营分析看板（V2.1 D3 看板）：准点率环图 + 延误分布直方图 + 承运商对比堆叠条图。
// 三张图都由后端 /analytics/summary 一次性喂数据，纯 D3 手写 SVG 渲染，不引开箱图表库。
import { useEffect, useState } from 'react'
import { Card, Col, Row, Spin, Statistic, Typography } from 'antd'
import { getAnalyticsSummary } from '@/api/analytics'
import type { AnalyticsSummary } from '@/types/analytics'
import OnTimeDonut from './components/OnTimeDonut'
import DelayHistogram from './components/DelayHistogram'
import CarrierBar from './components/CarrierBar'

const { Title, Text } = Typography

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {it.label}
          </Text>
        </span>
      ))}
    </div>
  )
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    getAnalyticsSummary()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        /* 静默失败：看板留空，菜单与路由照常 */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const rate = data ? Math.round(data.on_time_rate * 100) : 0

  return (
    <div style={{ padding: 16 }}>
      <Title level={4} style={{ marginTop: 0 }}>
        运营分析看板
      </Title>
      <Text type="secondary">跨境运单准点表现与延误分布，数据由后端一次聚合，D3 纯手写渲染。</Text>

      <Spin spinning={loading}>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="已评分运单" value={data?.total_rated ?? 0} suffix="票" />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic
                title="整体准点率"
                value={rate}
                suffix="%"
                valueStyle={{ color: '#2ea043' }}
              />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic
                title="延误运单"
                value={data?.delayed ?? 0}
                suffix="票"
                valueStyle={{ color: '#f0a020' }}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={8}>
            <Card title="整体准点率">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <OnTimeDonut onTime={data?.on_time ?? 0} delayed={data?.delayed ?? 0} />
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="延误时长分布">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <DelayHistogram buckets={data?.delay_buckets ?? []} />
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="承运商准点对比">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <CarrierBar carriers={data?.carriers ?? []} />
              </div>
              <Legend
                items={[
                  { color: '#2ea043', label: '准时' },
                  { color: '#f0a020', label: '延误' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  )
}
