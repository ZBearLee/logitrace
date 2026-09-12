import { Alert, Divider, Select, Skeleton, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import type { TableProps } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getEvents } from '@/api/shipments'
import { getDailyReport } from '@/api/ai'
import type { EventOut } from '@/types/shipments'
import type { DailyReportOut } from '@/types/ai'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { usePagedResource } from '@/hooks/usePagedResource'
import ErrorState from '@/components/feedback/ErrorState'

/** 事件类型中文标签。 */
const EVENT_LABEL: Record<string, string> = {
  picked_up: '提货',
  loaded: '装船',
  departed: '离港',
  arrived: '到港',
  delivered: '签收',
  delayed: '延误',
  stalled: '滞留',
}

/** 运单状态对应的 Tag 颜色。 */
const STATUS_COLOR: Record<string, string> = {
  planned: 'default',
  in_transit: 'processing',
  delivered: 'success',
  delayed: 'warning',
}

const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '—')

/** 日报 by_type 异常类型中文标签。 */
const REPORT_TYPE_LABEL: Record<string, string> = {
  delay: '延误',
  stalled: '滞留',
  route_deviation: '航线偏移',
}

/** payload_json 是 JSON 字符串，拆出可读字段展示，比裸 JSON 直观。 */
function renderDetail(detail: string | null) {
  if (!detail) return '—'
  try {
    const obj = JSON.parse(detail) as Record<string, unknown>
    const parts: string[] = []
    if (obj.leg_id != null) parts.push(`段 ${obj.leg_id}`)
    if (obj.speed != null) parts.push(`速度 ${obj.speed} km/h`)
    return parts.join(' · ') || detail
  } catch {
    // 非法 JSON 时原样展示，避免吞掉信息
    return detail
  }
}

export default function Notifications() {
  const navigate = useNavigate()

  // 异常日报：每天由调度器生成，前端读表展示；无记录时后端现算
  const {
    data: report,
    loading: reportLoading,
    error: reportError,
  } = useAsyncResource<DailyReportOut>(() => getDailyReport(), [])

  // 与运单列表一致的列表取数封装：分页/筛选/空值兜底统一收敛，页面零样板。
  const {
    items,
    total,
    loading,
    error,
    page,
    pageSize,
    filters,
    setFilters,
    setPage,
    setPageSize,
  } = usePagedResource<EventOut, { event_type: string | null }>(
    (p) =>
      getEvents({
        page: p.page,
        page_size: p.page_size,
        event_type: p.event_type ?? undefined,
      }),
    { event_type: null },
  )

  const columns: TableProps<EventOut>['columns'] = [
    {
      title: '运单号',
      dataIndex: 'shipment_no',
      render: (no: string | null, row) =>
        no ? (
          <Typography.Link onClick={() => navigate(`/shipments/${row.shipment_id}`)}>
            {no}
          </Typography.Link>
        ) : (
          '—'
        ),
    },
    { title: '事件', dataIndex: 'event_type', render: (t: string) => EVENT_LABEL[t] ?? t },
    {
      title: '运单状态',
      dataIndex: 'shipment_status',
      render: (s: string | null) => (s ? <Tag color={STATUS_COLOR[s] ?? 'default'}>{s}</Tag> : '—'),
    },
    { title: '详情', dataIndex: 'payload_json', render: renderDetail },
    { title: '发生时间', dataIndex: 'occurred_at', render: fmt },
  ]

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {reportError != null && <Alert type="info" showIcon message="异常日报暂不可用" />}

      {/* 日报信息与事件类型筛选同排：去掉日报卡标题栏，避免两行留白 */}
      <Space wrap size={[8, 8]} align="center">
        {reportLoading || !report ? (
          reportError == null && <Skeleton.Input active size="small" style={{ width: 180 }} />
        ) : (
          <>
            <Typography.Text strong>异常日报</Typography.Text>
            <Tag>{report.report_date}</Tag>
            <Tag color={report.source === 'llm' ? 'purple' : 'default'}>
              {report.source === 'llm' ? 'AI 生成' : '模板'}
            </Tag>
            <Tag color="red">{`当日异常 ${report.stats.total} 起`}</Tag>
            {Object.entries(report.stats.by_type).map(([t, c]) => (
              <Tag key={t}>{`${REPORT_TYPE_LABEL[t] ?? t} ${c}`}</Tag>
            ))}
            <Tooltip
              title={
                <div style={{ maxWidth: 420 }}>
                  <div>{report.summary}</div>
                  {report.stats.top_delayed.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div>延误最重：</div>
                      {report.stats.top_delayed.map((d) => (
                        <div key={d.shipment_no}>
                          {`${d.shipment_no}（${d.origin}→${d.dest}，超计划 ${Math.round(d.delay_hours)}h）`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              }
            >
              <QuestionCircleOutlined style={{ color: '#8aa4c0', cursor: 'help' }} />
            </Tooltip>
            <Divider type="vertical" />
          </>
        )}
        <span>事件类型</span>
        <Select
          allowClear
          placeholder="全部"
          style={{ width: 140 }}
          value={filters.event_type ?? undefined}
          onChange={(v) => setFilters({ event_type: v ?? null })}
          options={[
            { value: 'departed', label: '离港' },
            { value: 'arrived', label: '到港' },
            { value: 'delivered', label: '签收' },
            { value: 'stalled', label: '滞留' },
            { value: 'delayed', label: '延误' },
          ]}
        />
      </Space>

      <Table<EventOut>
        dataSource={items}
        loading={loading}
        rowKey="id"
        columns={columns}
        // 日报与筛选已合并成一行，表体高度按运单列表口径 + 一行日报的高度计算。
        scroll={{ y: 'calc(100vh - 270px)' }}
        locale={
          error != null
            ? { emptyText: <ErrorState error={error} scope="list" entity="事件" /> }
            : undefined
        }
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
      />
    </Space>
  )
}
