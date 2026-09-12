// 命令面板：全局 Ctrl+K 唤起，自然语言查运单。
// LLM 只产出结构化查询参数（后端白名单校验后落库），这里只负责把结果表格化、
// 点到详情，并把命中运单的起止港派发到大屏做联动高亮——AI 是器官，不在这里做对话。
import { useEffect, useState } from 'react'
import { Alert, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { queryAi } from '@/api/ai'
import { statusColor, statusLabel } from '@/constants/shipments'
import { linkage, type LinkPoint } from '@/store/linkage'
import type { AiQueryOut, ShipmentBrief } from '@/types/ai'

const { Text, Paragraph } = Typography
const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '—')

/** 把结果里的起止港经纬度收成去重的联动点（地图 flyToBounds 需要坐标）。 */
function collectLinkPoints(items: ShipmentBrief[]): { codes: string[]; points: LinkPoint[] } {
  const seen = new Set<string>()
  const codes: string[] = []
  const points: LinkPoint[] = []
  for (const it of items) {
    for (const [code, lat, lng] of [
      [it.origin_code, it.origin_lat, it.origin_lng],
      [it.dest_code, it.dest_lat, it.dest_lng],
    ] as const) {
      if (code && lat != null && lng != null && !seen.has(code)) {
        seen.add(code)
        codes.push(code)
        points.push({ lat, lng })
      }
    }
  }
  return { codes, points }
}

interface Props {
  open: boolean
  onClose: () => void
  /** AI 是否启用：未配置 Key 时面板只给出降级说明，不发起查询 */
  enabled: boolean
}

export default function CommandPalette({ open, onClose, enabled }: Props) {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AiQueryOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [linked, setLinked] = useState(false)

  // 每次打开清空上一次结果，避免残留误导
  useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect -- 打开时重置结果属于外部（弹窗）状态同步，非多余渲染
      setResult(null)
      setError(null)
      setLinked(false)
    }
  }, [open])

  const run = async () => {
    const q = question.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setLinked(false)
    try {
      const out = await queryAi(q)
      setResult(out)
      // 命中运单的起止港派发到地球高亮：不在地图页也能先记下来，进大屏即消费
      const { codes, points } = collectLinkPoints(out.items)
      if (points.length > 0) {
        linkage.request({ kind: 'flyToBounds', codes, points })
        setLinked(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    {
      title: '运单号',
      dataIndex: 'shipment_no',
      render: (no: string, row: ShipmentBrief) => (
        <Typography.Link
          onClick={() => {
            onClose()
            navigate(`/shipments/${row.id}`)
          }}
        >
          {no}
        </Typography.Link>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: string) => <Tag color={statusColor(s)}>{statusLabel(s)}</Tag>,
    },
    {
      title: '航线',
      render: (_: unknown, row: ShipmentBrief) =>
        `${row.origin_code ?? '—'} → ${row.dest_code ?? '—'}`,
    },
    { title: '承运商', dataIndex: 'carrier_name', render: (v: string | null) => v ?? '—' },
    { title: '计划到达', dataIndex: 'planned_arrival', render: fmt },
  ]

  return (
    <Modal
      title="命令面板 · 自然语言查运单"
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnHidden
    >
      {!enabled ? (
        <Alert
          type="info"
          showIcon
          message="AI 能力未启用"
          description="未配置 AI_API_KEY，自然语言查数暂不可用。在 backend/.env 配好 AI_API_KEY / AI_BASE_URL / AI_MODEL 后即可使用。"
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input.Search
            placeholder="例如：上个月延误超 48 小时的海运单"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onSearch={run}
            enterButton="查询"
            loading={loading}
            allowClear
          />

          {error != null && <Alert type="error" showIcon message={error} />}

          {linked && (
            <Alert
              type="success"
              showIcon
              message="已在地球高亮命中运单的起止港（切到全球大屏即可看到）"
            />
          )}

          {result && (
            <>
              <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                LLM 解析出的查询参数（透明可审计，已做白名单校验）：
                <Text code>{JSON.stringify(result.params)}</Text>
                ，命中 {result.total} 票，耗时 {result.latency_ms} ms
              </Paragraph>
              {result.items.length === 0 ? (
                <Alert type="info" showIcon message="没有命中的运单" />
              ) : (
                <Table<ShipmentBrief>
                  dataSource={result.items}
                  rowKey="id"
                  columns={columns}
                  size="small"
                  pagination={false}
                  scroll={{ y: 320 }}
                />
              )}
            </>
          )}
        </Space>
      )}
    </Modal>
  )
}
