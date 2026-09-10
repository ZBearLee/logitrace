import { Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getEvents } from '@/api/shipments'
import type { EventOut } from '@/types/shipments'
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
      <Space>
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
        // 与运单列表完全相同的结构与算法：筛选行(32) + Space 间距(16) + Header(48)
        // + Content 外边距(32) + 表头与分页(112) = 240px；表体填满内容区，分页器落在底部。
        // 之前这两页套了一层 Card，多出的标题栏/内边距只能靠估，估了两次都偏高。
        scroll={{ y: 'calc(100vh - 240px)' }}
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
