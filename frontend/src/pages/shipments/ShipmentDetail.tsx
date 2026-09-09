// 运单详情页：展示单票运单的基本信息、运输链路与里程碑事件。
import { Fragment } from 'react'
import { Button, Card, Descriptions, Skeleton, Space, Tabs, Tag, Timeline, Typography } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { getShipmentDetail, getShipmentEvents, getShipmentPositions } from '@/api/shipments'
import AMapMap from '@/pages/shipments/components/AMapMap'
import CanvasMap from '@/pages/shipments/components/CanvasMap'
import EchartsMap from '@/pages/shipments/components/EchartsMap'
import { eventLabel, modeColor, modeLabel, statusColor, statusLabel } from '@/constants/shipments'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import ErrorState from '@/components/feedback/ErrorState'

const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '—')

/** 链路节点里只取日期：带上时分会让节点描述过长而被折行 */
const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : '—')

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const shipmentId = Number(id)

  // 主信息与事件分开取：事件取数失败只降级时间轴，不牵连运单主信息
  const {
    data: detail,
    loading: detailLoading,
    error: detailError,
  } = useAsyncResource(() => getShipmentDetail(shipmentId), [shipmentId])
  const {
    data: events,
    loading: eventsLoading,
    error: eventsError,
  } = useAsyncResource(() => getShipmentEvents(shipmentId), [shipmentId])
  const {
    data: positions,
    loading: positionsLoading,
    error: positionsError,
  } = useAsyncResource(() => getShipmentPositions(shipmentId), [shipmentId])

  // 外层 Content 不滚动（避免双滚动条），滚动交给页面自身
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
      {detailError != null && (
        <ErrorState
          error={detailError}
          scope="detail"
          entity="运单"
          size="page"
          // 整页失败的出口是业务动作，不暴露「重试」这类技术按钮
          extra={<Button onClick={() => navigate('/shipments')}>返回运单列表</Button>}
        />
      )}

      {detailError == null && (detailLoading || !detail) && (
        <Skeleton active title paragraph={{ rows: 6 }} />
      )}

      {detailError == null && detail && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Card
            title={detail.shipment_no}
            extra={<Tag color={statusColor(detail.status)}>{statusLabel(detail.status)}</Tag>}
          >
            <Descriptions
              column={2}
              bordered
              size="small"
              items={[
                { key: 'no', label: '运单号', children: detail.shipment_no },
                { key: 'carrier', label: '承运商', children: detail.carrier_name ?? '—' },
                {
                  key: 'route',
                  label: '航线',
                  children: `${detail.origin_code ?? '—'} → ${detail.dest_code ?? '—'}`,
                },
                { key: 'order', label: '关联订单', children: detail.order_no ?? '—' },
                { key: 'customer', label: '客户名称', children: detail.customer_name ?? '—' },
                { key: 'pd', label: '计划出发', children: fmt(detail.planned_departure) },
                { key: 'pa', label: '计划到达', children: fmt(detail.planned_arrival) },
                { key: 'ad', label: '实际出发', children: fmt(detail.actual_departure) },
                { key: 'aa', label: '实际到达', children: fmt(detail.actual_arrival) },
              ]}
            />
          </Card>

          <Card title="运输链路">
            {detail.legs.length === 0 ? (
              <Typography.Text type="secondary">暂无运输段</Typography.Text>
            ) : (
              // 不用 Steps：它的节点文本区宽度受 flex 约束，多行内容会在换行与截断之间反复。
              // 改用自适应横向卡片，块内文字自然排布，不会溢出也不会被裁。
              <div style={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', gap: 8 }}>
                {detail.legs.map((leg, index) => (
                  // 箭头与卡片同为外层 flex item：容器 gap 在箭头两侧对称生效，
                  // 它才会真正居中在两张卡之间（挂在卡片内部会让右侧多吃一段 gap）
                  <Fragment key={leg.id}>
                    <div
                      style={{
                        border: '1px solid #f0f0f0',
                        borderColor: leg.status === 'active' ? '#91caff' : '#f0f0f0',
                        borderRadius: 8,
                        padding: '10px 14px',
                        minWidth: 190,
                        background: leg.status === 'active' ? '#e6f4ff' : '#fafafa',
                      }}
                    >
                      <Space size={6}>
                        <Tag color={modeColor(leg.mode)}>{`${modeLabel(leg.mode)}段`}</Tag>
                        <Typography.Text type="secondary">{`第 ${leg.seq} 段`}</Typography.Text>
                      </Space>
                      <div style={{ fontWeight: 600, marginTop: 6 }}>
                        {`${leg.origin_code ?? '—'} → ${leg.dest_code ?? '—'}`}
                      </div>
                      <Typography.Text type="secondary">
                        {`${fmtDate(leg.planned_start)} → ${fmtDate(leg.planned_end)}`}
                      </Typography.Text>
                    </div>
                    {index < detail.legs.length - 1 && (
                      <ArrowRightOutlined
                        style={{
                          margin: '0 10px',
                          color: '#1677ff',
                          fontSize: 16,
                          alignSelf: 'center',
                        }}
                      />
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </Card>

          <Card title="历史轨迹">
            {positionsError != null && (
              <ErrorState error={positionsError} scope="list" entity="轨迹" />
            )}

            {positionsError == null && (positionsLoading || !positions) && (
              <Skeleton active title={false} paragraph={{ rows: 5 }} />
            )}

            {positionsError == null && positions && positions.length === 0 && (
              <Typography.Text type="secondary">暂无轨迹点</Typography.Text>
            )}

            {positionsError == null && positions && positions.length > 0 && (
              <Tabs
                defaultActiveKey="echarts"
                // 只挂载当前页签，避免三个地图同时初始化（高德会去加载 JS API）
                destroyOnHidden
                items={[
                  {
                    key: 'echarts',
                    label: 'ECharts 地理图',
                    children: <EchartsMap points={positions} />,
                  },
                  {
                    key: 'canvas',
                    label: 'Canvas 世界地图',
                    children: <CanvasMap points={positions} />,
                  },
                  {
                    key: 'amap',
                    label: '高德真实地图',
                    children: <AMapMap points={positions} />,
                  },
                ]}
              />
            )}
          </Card>

          <Card title="里程碑事件">
            {eventsError != null && <ErrorState error={eventsError} scope="list" entity="事件" />}

            {eventsError == null && (eventsLoading || !events) && (
              <Skeleton active title={false} paragraph={{ rows: 4 }} />
            )}

            {eventsError == null && events && events.length === 0 && (
              <Typography.Text type="secondary">暂无事件</Typography.Text>
            )}

            {eventsError == null && events && events.length > 0 && (
              <Timeline
                items={events.map((e) => ({
                  key: e.id,
                  children: (
                    <span>
                      <Typography.Text strong>{eventLabel(e.event_type)}</Typography.Text>
                      <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                        {fmt(e.occurred_at)}
                      </Typography.Text>
                    </span>
                  ),
                }))}
              />
            )}
          </Card>
        </Space>
      )}
    </div>
  )
}
