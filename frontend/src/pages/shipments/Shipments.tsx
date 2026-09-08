import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getShipments } from '@/api/shipments'
import { STATUS_OPTIONS, statusColor, statusLabel } from '@/constants/shipments'
import type { PagedShipments, ShipmentBrief, ShipmentStatus } from '@/types/shipments'

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
  const [data, setData] = useState<ShipmentBrief[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<ShipmentStatus | null>(null)
  // 初始即 loading：避免 effect 同步阶段调用 setLoading 触发级联渲染
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    let alive = true
    // 注意：effect 同步路径内不做 setState（会触发级联渲染 lint）。
    // loading 由初始 state 承担；error 在请求成功时清空。
    getShipments({ page, page_size: pageSize, status })
      .then((res: PagedShipments) => {
        if (!alive) return
        setData(res.items)
        setTotal(res.total)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [page, pageSize, status])

  useEffect(() => load(), [load])

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Select
        allowClear
        placeholder="按状态筛选"
        style={{ width: 160 }}
        options={STATUS_OPTIONS}
        value={status ?? undefined}
        onChange={(v) => {
          setStatus(v ?? null)
          setPage(1)
        }}
      />

      {error ? (
        <Alert
          type="error"
          message="运单列表加载失败"
          description={error}
          // 重试是事件处理（非 effect），此处 setLoading 不触发该 lint，且能恢复转圈
          action={<Button onClick={() => { setLoading(true); load() }}>重试</Button>}
        />
      ) : (
        <Table<ShipmentBrief>
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
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
      )}
    </Space>
  )
}
