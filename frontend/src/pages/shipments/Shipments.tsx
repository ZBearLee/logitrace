import { Button, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getShipments } from '@/api/shipments'
import { STATUS_OPTIONS, statusColor, statusLabel } from '@/constants/shipments'
import type { ShipmentBrief, ShipmentStatus } from '@/types/shipments'
import { usePagedResource } from '@/hooks/usePagedResource'
import ErrorState from '@/components/feedback/ErrorState'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

// 后端时间是 ISO 字符串，列表里只截到分钟，去掉 T 更易读
const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '—')

// 复制运单号：常驻可见的图标按钮，避免 antd Typography copyable 默认"hover 文本才显示
// 图标、鼠标移到图标上易脱离 hover 链导致图标消失、点不到"的毛病。点击复制到剪贴板
// 并阻断冒泡，避免误触发整行的详情导航。
function CopyCell({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (e: MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // 剪贴板 API 不可用（非 https / 旧浏览器）时降级到 execCommand
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}
      onClick={(e) => e.stopPropagation()}
    >
      <Typography.Text
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography.Text>
      <Tooltip title={copied ? '已复制' : '复制运单号'}>
        <Button
          type="text"
          size="small"
          style={{ flex: '0 0 auto' }}
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={copy}
        />
      </Tooltip>
    </span>
  )
}

// 列定义与组件状态无关，提到组件外避免每次渲染重建；
// render 只用模块级纯函数（statusLabel/statusColor/fmt），无闭包依赖。
const columns: TableColumnsType<ShipmentBrief> = [
  {
    title: '运单号',
    dataIndex: 'shipment_no',
    key: 'shipment_no',
    align: 'center',
    width: 200,
    // 复制按钮点击不冒泡到整行，避免误触发详情导航
    render: (v: string) => <CopyCell value={v} />,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    align: 'center',
    render: (s: string) => <Tag color={statusColor(s)}>{statusLabel(s)}</Tag>,
  },
  {
    title: '航线',
    key: 'route',
    align: 'center',
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
    align: 'center',
    render: (v: string | null) => v ?? '—',
  },
  {
    title: '计划出发',
    dataIndex: 'planned_departure',
    key: 'planned_departure',
    align: 'center',
    render: (v: string | null) => fmt(v),
  },
  {
    title: '计划到达',
    dataIndex: 'planned_arrival',
    key: 'planned_arrival',
    align: 'center',
    render: (v: string | null) => fmt(v),
  },
  {
    title: '最新位置时间',
    dataIndex: 'latest_ts',
    key: 'latest_ts',
    align: 'center',
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
  } = usePagedResource<ShipmentBrief, { status: ShipmentStatus | null; shipment_no: string }>(
    (p) => getShipments(p),
    {
      status: null,
      shipment_no: '',
    },
  )

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space>
        <Select
          allowClear
          placeholder="按状态筛选"
          style={{ width: 160 }}
          options={STATUS_OPTIONS}
          value={filters.status ?? undefined}
          onChange={(v) => setFilters({ status: v ?? null, shipment_no: filters.shipment_no })}
        />
        <Input.Search
          allowClear
          placeholder="按运单号搜索"
          style={{ width: 260 }}
          value={filters.shipment_no}
          // 清除时立即重置；回车 / 点搜索按钮才发起查询，避免每次按键都请求
          onChange={(e) => {
            if (e.target.value === '') {
              setFilters({ status: filters.status, shipment_no: '' })
            }
          }}
          onSearch={(v) => setFilters({ status: filters.status, shipment_no: v.trim() })}
        />
      </Space>

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
