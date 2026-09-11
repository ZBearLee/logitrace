// 运营分析看板（V2.1 D3 看板）：准点率环图 + 延误分布直方图 + 承运商对比堆叠条图 + 准点率趋势 + 延误原因。
// 三张基础图由后端 /analytics/summary 一次性喂数据，纯 D3 手写 SVG。
// 让看板「活起来」：时间范围可切；趋势/原因按天聚合；点承运商下钻到运单列表、点延误区间/原因下钻到对应页面。
import { useEffect, useState } from 'react'
import { Card, Col, Row, Segmented, Spin, Statistic, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getAnalyticsSummary } from '@/api/analytics'
import type { AnalyticsSummary } from '@/types/analytics'
import OnTimeDonut from './components/OnTimeDonut'
import DelayHistogram from './components/DelayHistogram'
import CarrierBar from './components/CarrierBar'
import TrendLine from './components/TrendLine'
import DelayReasons from './components/DelayReasons'
import RouteSankey, { ROUTE_MODE_COLOR } from './components/RouteSankey'

const { Title, Text } = Typography

type RangeKey = 'all' | 7 | 30 | 90

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
  const navigate = useNavigate()
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeKey>('all')

  useEffect(() => {
    let alive = true
    // loading 初始即为 true，这里不必再 setLoading(true)，避免 effect 内同步 setState 触发级联渲染
    getAnalyticsSummary(range === 'all' ? {} : { days: range })
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
  }, [range])

  const rate = data ? Math.round(data.on_time_rate * 100) : 0

  const openCarrier = (carrierId: number) => navigate(`/shipments?carrier_id=${carrierId}`)
  const openBucket = (label: string) =>
    navigate(`/shipments?status=${label === '准时/提前' ? 'delivered' : 'delayed'}`)
  const openReason = (type: string) => navigate(`/exceptions?type=${type}`)

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Title level={4} style={{ marginTop: 0, marginBottom: 0 }}>
          运营分析看板
        </Title>
        <Segmented<RangeKey>
          value={range}
          onChange={setRange}
          options={[
            { label: '全部', value: 'all' },
            { label: '近 90 天', value: 90 },
            { label: '近 30 天', value: 30 },
            { label: '近 7 天', value: 7 },
          ]}
        />
      </div>
      <Text type="secondary">
        跨境运单准点表现与延误分布。可切时间范围；点承运商柱体 / 延误区间 /
        延误原因可下钻到对应运单或异常。
      </Text>

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
                valueStyle={{ color: rate >= 95 ? '#2ea043' : '#f0a020' }}
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

        <Card
          title="准点率趋势（绿线=准点率，蓝面积=当日运量，橙虚线=95% 目标）"
          style={{ marginTop: 16 }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
            <TrendLine trend={data?.trend ?? []} />
          </div>
        </Card>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={8}>
            <Card title="整体准点率">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <OnTimeDonut onTime={data?.on_time ?? 0} delayed={data?.delayed ?? 0} />
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="延误时长分布（点击区间下钻）">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <DelayHistogram buckets={data?.delay_buckets ?? []} onSelectBucket={openBucket} />
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="承运商准点对比（点击柱体下钻）">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <CarrierBar carriers={data?.carriers ?? []} onSelectCarrier={openCarrier} />
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

        <Card title="延误原因（点击下钻到异常中心）" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <DelayReasons reasons={data?.delay_reasons ?? []} onSelect={openReason} />
          </div>
        </Card>

        <Card
          title="航线流量（起点口岸 → 终点口岸，粗细=运量，颜色=运输方式）"
          style={{ marginTop: 16 }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
            <RouteSankey routes={data?.top_routes ?? []} />
          </div>
          <Legend
            items={[
              { color: ROUTE_MODE_COLOR.sea, label: '海运' },
              { color: ROUTE_MODE_COLOR.road, label: '陆运' },
              { color: ROUTE_MODE_COLOR.air, label: '空运' },
              { color: ROUTE_MODE_COLOR.rail, label: '铁运' },
            ]}
          />
        </Card>
      </Spin>
    </div>
  )
}
