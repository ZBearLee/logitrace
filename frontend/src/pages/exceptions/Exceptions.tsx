import { Checkbox, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getExceptions } from '@/api/shipments'
import type { ExceptionOut } from '@/types/shipments'
import { usePagedResource } from '@/hooks/usePagedResource'
import ErrorState from '@/components/feedback/ErrorState'

/** 异常类型中文标签。 */
const TYPE_LABEL: Record<string, string> = {
  delay: '延误',
  stalled: '滞留',
  route_deviation: '偏航',
}

/** 异常等级对应的 Tag 颜色。 */
const LEVEL_COLOR: Record<string, string> = {
  info: 'default',
  warning: 'warning',
  critical: 'error',
}

const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '—')

export default function Exceptions() {
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
  } = usePagedResource<
    ExceptionOut,
    { type: string | null; level: string | null; unresolved_only: boolean }
  >(
    (p) =>
      getExceptions({
        page: p.page,
        page_size: p.page_size,
        type: p.type ?? undefined,
        level: p.level ?? undefined,
        unresolved_only: p.unresolved_only,
      }),
    { type: null, level: null, unresolved_only: false },
  )

  const columns: TableProps<ExceptionOut>['columns'] = [
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
    { title: '类型', dataIndex: 'type', render: (t: string) => TYPE_LABEL[t] ?? t },
    {
      title: '等级',
      dataIndex: 'level',
      render: (l: string) => <Tag color={LEVEL_COLOR[l] ?? 'default'}>{l}</Tag>,
    },
    { title: '详情', dataIndex: 'detail', render: (d: string | null) => d ?? '—' },
    { title: '检测时间', dataIndex: 'detected_at', render: fmt },
    {
      title: '处理状态',
      dataIndex: 'resolved_at',
      render: (r: string | null) =>
        r ? <Tag color="success">已处理</Tag> : <Tag color="processing">待处理</Tag>,
    },
  ]

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <span>类型</span>
        <Select
          allowClear
          placeholder="全部"
          style={{ width: 110 }}
          value={filters.type ?? undefined}
          onChange={(v) =>
            setFilters({
              type: v ?? null,
              level: filters.level,
              unresolved_only: filters.unresolved_only,
            })
          }
          options={[
            { value: 'delay', label: '延误' },
            { value: 'stalled', label: '滞留' },
            { value: 'route_deviation', label: '偏航' },
          ]}
        />
        <span>等级</span>
        <Select
          allowClear
          placeholder="全部"
          style={{ width: 110 }}
          value={filters.level ?? undefined}
          onChange={(v) =>
            setFilters({
              type: filters.type,
              level: v ?? null,
              unresolved_only: filters.unresolved_only,
            })
          }
          options={[
            { value: 'warning', label: '警告' },
            { value: 'critical', label: '严重' },
          ]}
        />
        <Checkbox
          checked={filters.unresolved_only}
          onChange={(e) =>
            setFilters({
              type: filters.type,
              level: filters.level,
              unresolved_only: e.target.checked,
            })
          }
        >
          只看未处理
        </Checkbox>
      </Space>

      <Table<ExceptionOut>
        dataSource={items}
        loading={loading}
        rowKey="id"
        columns={columns}
        // 与运单列表完全一致：筛选行(32) + Space 间距(16) + Header(48)
        // + Content 外边距(32) + 表头与分页(112) = 240px，分页器落在内容区底部。
        scroll={{ y: 'calc(100vh - 240px)' }}
        locale={
          error != null
            ? { emptyText: <ErrorState error={error} scope="list" entity="异常" /> }
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
