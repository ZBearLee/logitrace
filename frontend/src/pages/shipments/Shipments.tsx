import { Select, Space, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getShipments } from '@/api/shipments'
import { STATUS_OPTIONS, statusColor, statusLabel } from '@/constants/shipments'
import type { ShipmentBrief, ShipmentStatus } from '@/types/shipments'
import { usePagedResource } from '@/hooks/usePagedResource'
import ErrorState from '@/components/feedback/ErrorState'

// 后端时间是 ISO 字符串，列表里只截到分钟，去掉 T 更易读
const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '—')

// 列定义与组件状态无关，提到组件外避免每次渲染重建；
// render 只用模块级纯函数（statusLabel/statusColor/fmt），无闭包依赖。
const columns: TableColumnsType<ShipmentBrief> = [
  {
    title: '运单号',
    dataIndex: 'shipment_no',
    key: 'shipment_no',
    // 复制按钮的点击不冒泡到整行，避免误触发详情导航
    render: (v: string) => (
      <span onClick={(e) => e.stopPropagation()}>
        <Typography.Text copyable>{v}</Typography.Text>
      </span>
    ),
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    render: (s: string) => <Tag color={statusColor(s)}>{statusLabel(s)}</Tag>,
  },
  {
    title: '航线',
    key: 'route',
    render: (_: unknown, r: ShipmentBrief) => (
      <span>
        {r.origin_code ?? '—'} → {r.dest_code ?? '—'}
      </span>
    ),
  },
  {
    title: '承运商',
    dataIndex: 'carrier_name',
    key: 'carrier_name',
    render: (v: string | null) => v ?? '—',
  },
  {
    title: '计划出发',
    dataIndex: 'planned_departure',
    key: 'planned_departure',
    render: (v: string | null) => fmt(v),
  },
  {
    title: '计划到达',
    dataIndex: 'planned_arrival',
    key: 'planned_arrival',
    render: (v: string | null) => fmt(v),
  },
  {
    title: '最新位置时间',
    dataIndex: 'latest_ts',
    key: 'latest_ts',
    render: (v: string | null) => fmt(v),
  },
]

export default function Shipments() {
  const navigate = useNavigate()

  // 列表取数交给统一 hook：分页与筛选状态、空值兜底全部收敛。
  // 自动重试、断网与页面重新可见的自愈、竞态保护由 useAsyncResource 继承，
  // 页面零错误处理代码。
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
  } = usePagedResource<ShipmentBrief, { status: ShipmentStatus | null }>((p) => getShipments(p), {
    status: null,
  })

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Select
        allowClear
        placeholder="按状态筛选"
        style={{ width: 160 }}
        options={STATUS_OPTIONS}
        value={filters.status ?? undefined}
        onChange={(v) => setFilters({ status: v ?? null })}
      />

      {/* 有旧数据时优雅降级：只给轻提示，不清空表格内容 */}
      {error != null && items.length > 0 && (
        <Typography.Text type="secondary">数据可能不是最新的</Typography.Text>
      )}

      <Table<ShipmentBrief>
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        // 表头固定、表体内部滚动，分页条留在表格下方不随滚动。
        // 高度按视口算出：扣掉 Header(48) + Content 外边距(32) + 筛选器(32)
        // + Space 间距(16) + 表头与分页约(112)，换算得 240px。
        scroll={{ y: 'calc(100vh - 240px)' }}
        // 取数失败时表格区域显示友好空态（不提供重试按钮），保持布局不塌
        locale={
          error != null
            ? {
                emptyText: <ErrorState error={error} scope="list" entity="运单" />,
              }
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
        onRow={(record) => ({
          onClick: () => navigate(`/shipments/${record.id}`),
          style: { cursor: 'pointer' },
        })}
      />
    </Space>
  )
}
