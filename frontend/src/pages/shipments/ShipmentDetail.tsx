// 运单详情页：展示单票运单的基本信息、运输链路与里程碑事件。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { getShipmentDetail, getShipmentEvents, getShipmentPositions } from '@/api/shipments'
import { getEta } from '@/api/ai'
import { connectPositions } from '@/api/ws'
import type { PositionPointOut } from '@/types/shipments'
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

  // ETA 预测：模型对在途运单批量推理的产物，详情页用「预测到达」替代原计划到达基线
  const { data: eta, error: etaError } = useAsyncResource(() => getEta(shipmentId), [shipmentId])

  // 实时位置：REST 给历史快照，WS 给增量，二者拼成地图要的连续轨迹。
  // 实时点按 leg 归属；leg id 全局唯一，切换运单后旧条目不会被 displayPositions
  // 取到，因此无需在切单时清理（在 effect 里 setState 会触发级联渲染）。
  const [liveByLeg, setLiveByLeg] = useState<Record<number, PositionPointOut>>({})
  const legIdsRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (detail) legIdsRef.current = new Set(detail.legs.map((l) => l.id))
  }, [detail])

  useEffect(() => {
    return connectPositions((msg) => {
      if (!legIdsRef.current.has(msg.leg_id)) return
      setLiveByLeg((prev) => ({
        ...prev,
        [msg.leg_id]: {
          id: -msg.leg_id,
          leg_id: msg.leg_id,
          lat: msg.lat,
          lng: msg.lng,
          speed: msg.speed,
          heading: msg.heading,
          recorded_at: msg.ts,
        },
      }))
    })
  }, [shipmentId])

  const displayPositions = useMemo<PositionPointOut[]>(() => {
    // 取不到历史轨迹时返回空数组而非 null：地图组件的 points 不接受可空，
    // 外层已按 positions 判空，这里的 [] 不会被渲染出来。
    if (!positions) return []
    const legs = detail?.legs ?? []
    const byLeg = new Map<number, PositionPointOut[]>()
    for (const p of positions) {
      if (!byLeg.has(p.leg_id)) byLeg.set(p.leg_id, [])
      byLeg.get(p.leg_id)!.push(p)
    }
    const out: PositionPointOut[] = []
    for (const leg of [...legs].sort((a, b) => a.seq - b.seq)) {
      out.push(...(byLeg.get(leg.id) ?? []))
      const live = liveByLeg[leg.id]
      if (live) out.push(live)
    }
    return out
  }, [positions, detail, liveByLeg])

  // 三个地图组件（ECharts/Canvas/高德）接收的路线 props 完全一致，先收集成
  // 一个对象再展开，避免每处调用重复写一长串 origin/dest/legs。
  const mapViewProps = detail
    ? {
        points: displayPositions,
        originCode: detail.origin_code,
        destCode: detail.dest_code,
        originLat: detail.origin_lat,
        originLng: detail.origin_lng,
        destLat: detail.dest_lat,
        destLng: detail.dest_lng,
        legs: detail.legs,
      }
    : null

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
                {
                  key: 'pa',
                  label: (
                    <Tooltip title="承运商原计划到达时间（与实际到达对比可看准点率）">
                      <span style={{ borderBottom: '1px dashed #bfbfbf' }}>计划到达</span>
                    </Tooltip>
                  ),
                  children: fmt(detail.planned_arrival),
                },
                {
                  key: 'eta',
                  // ETA 模型对在途运单批量推理的产物：相对计划到达的偏差超 24h 触发延误预警
                  label: (
                    <Tooltip title="ETA 模型预测到达时间；相对计划到达的偏差超 24h 会触发延误预警">
                      <span style={{ borderBottom: '1px dashed #bfbfbf' }}>预测到达 (ETA)</span>
                    </Tooltip>
                  ),
                  children: eta ? (
                    <Space size={6}>
                      {fmt(eta.predicted_arrival)}
                      <Tag color="blue">{`置信度 ${Math.round(eta.confidence * 100)}%`}</Tag>
                    </Space>
                  ) : (
                    <Tooltip title={etaError != null ? 'ETA 模型未训练或运单不在途' : '加载中'}>
                      <Typography.Text type="secondary">—</Typography.Text>
                    </Tooltip>
                  ),
                },
                { key: 'ad', label: '实际出发', children: fmt(detail.actual_departure) },
                { key: 'aa', label: '实际到达', children: fmt(detail.actual_arrival) },
              ]}
            />
          </Card>

          {eta && eta.deviation_hours != null && eta.deviation_hours > 24 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message={`预测到达比计划晚约 ${Math.round(eta.deviation_hours)} 小时，已触发延误预警`}
              description={`模型版本 ${eta.model_version} · 置信度 ${Math.round(eta.confidence * 100)}%`}
            />
          )}

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

            {positionsError == null && positions && positions.length > 0 && mapViewProps && (
              <Tabs
                defaultActiveKey="echarts"
                // 只挂载当前页签，避免三个地图同时初始化（高德会去加载 JS API）
                destroyOnHidden
                items={[
                  {
                    key: 'echarts',
                    label: 'ECharts 地理图',
                    children: <EchartsMap key={shipmentId} {...mapViewProps} />,
                  },
                  {
                    key: 'canvas',
                    label: 'Canvas 世界地图',
                    children: <CanvasMap {...mapViewProps} />,
                  },
                  {
                    key: 'amap',
                    label: '高德真实地图',
                    children: <AMapMap {...mapViewProps} />,
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
