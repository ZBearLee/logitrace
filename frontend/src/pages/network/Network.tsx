// 物流关系网络：口岸↔口岸航线 + 承运商服务口岸，后端一次聚合，D3 手写布局。
// 让图「活起来」：点节点出右侧详情抽屉（准点率 / 依赖风险 / 合作方）；风险节点自动标红；
// 按运输方式筛选航线、搜索高亮节点、选中后聚焦其邻居（其余淡出）。
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Checkbox, Drawer, Input, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getNetworkGraph } from '@/api/network'
import type { NetworkGraph, NetworkNode } from '@/types/network'
import { linkage } from '@/store/linkage'
import NetworkForce from './components/NetworkForce'

const { Text, Paragraph } = Typography

const MODE_COLOR: Record<string, string> = {
  sea: '#2f81f7',
  road: '#f0a020',
  air: '#e3529c',
  rail: '#3fb950',
}
const MODE_LABEL: Record<string, string> = { sea: '海运', road: '陆运', air: '空运', rail: '铁运' }
const ALL_MODES = ['sea', 'road', 'air', 'rail']

const RISK_DESC: Record<string, string> = {
  single_carrier: '该口岸只被 1 个承运商服务，承运商出问题即断供（单点依赖）',
  single_port: '该承运商只服务 1 个口岸，口岸出问题即无替代（单点依赖）',
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#1677ff' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          口岸
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f0a020' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          承运商
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#cf1322' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          单点依赖风险节点
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 18, height: 0, borderTop: '2px solid #9fb4cc' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          航线（按运输方式上色）
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 18, height: 0, borderTop: '2px dashed #9aa7b5' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          承运商服务口岸（虚线）
        </Text>
      </span>
      {ALL_MODES.map((m) => (
        <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 3, background: MODE_COLOR[m] }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {MODE_LABEL[m]}
          </Text>
        </span>
      ))}
    </div>
  )
}

export default function Network() {
  const navigate = useNavigate()
  const [data, setData] = useState<NetworkGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<NetworkNode | null>(null)
  const [modeFilter, setModeFilter] = useState<string[]>(ALL_MODES)
  const [search, setSearch] = useState('')
  // 框选模式：开启后可在图上拖拽框选口岸；框选结果经联动通道在大屏高亮
  const [selectionMode, setSelectionMode] = useState(false)
  const [boxIds, setBoxIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // 节点索引：抽屉定位、框选高亮都靠它把 id 解成 code/经纬度
  const nodeById = data ? new Map(data.nodes.map((n) => [n.id, n])) : null

  // 图谱容器尺寸：跟随卡片实际宽高，避免固定 760 宽在宽屏上两侧留白
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [chartSize, setChartSize] = useState({ width: 760, height: 540 })
  useEffect(() => {
    const el = chartRef.current
    if (el == null) return
    const update = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      setChartSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    getNetworkGraph()
      .then((d) => {
        if (alive) {
          setData(d)
          setError(null)
        }
      })
      .catch(() => {
        // 显式提示：静默吞错会让「接口 500」和「真的没数据」在页面上无法区分
        if (alive) setError('网络数据加载失败，拓扑可能不是最新的')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const carrierId = selected?.type === 'carrier' ? Number(selected.id.slice(4)) : null

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {/* 与其它模块一致：首行只放筛选控件，页面标题交给顶部面包屑；说明收进「?」 */}
      <Space wrap align="center" size={[12, 8]}>
        <Input.Search
          allowClear
          placeholder="搜索口岸 / 承运商"
          style={{ width: 220 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Checkbox.Group
          options={ALL_MODES.map((m) => ({ label: MODE_LABEL[m], value: m }))}
          value={modeFilter}
          onChange={(vals) => setModeFilter(vals as string[])}
        />
        <Button
          type={selectionMode ? 'primary' : 'default'}
          onClick={() => {
            setSelectionMode((v) => !v)
            setBoxIds([])
          }}
        >
          {selectionMode ? '退出框选' : '框选口岸'}
        </Button>
        <Tooltip title="口岸与承运商的关系拓扑：航线按运输方式着色，节点大小随运单量变化。点节点看详情、拖拽节点、滚轮缩放。">
          <QuestionCircleOutlined style={{ color: '#8aa4c0', cursor: 'help' }} />
        </Tooltip>
      </Space>

      {error != null && <Alert type="warning" showIcon message={error} style={{ marginTop: 8 }} />}

      {selectionMode && (
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          在空白处拖拽框选口岸，松手后可一键在大屏高亮这些点。
        </Text>
      )}

      {boxIds.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            background: '#eef4ff',
            border: '1px solid #bcd3f7',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Text>
            已框选 <Text strong>{boxIds.length}</Text> 个口岸
          </Text>
          <Button
            type="primary"
            size="small"
            onClick={() => {
              const ports = boxIds
                .map((id) => nodeById?.get(id))
                .filter(
                  (n): n is NetworkNode =>
                    !!n && n.type === 'location' && n.lat != null && n.lng != null && !!n.code,
                )
              if (ports.length === 0) return
              linkage.request({
                kind: 'flyToBounds',
                codes: ports.map((p) => p.code as string),
                points: ports.map((p) => ({ lat: p.lat as number, lng: p.lng as number })),
              })
              navigate('/dashboard')
            }}
          >
            在大屏高亮
          </Button>
          <Button size="small" onClick={() => setBoxIds([])}>
            清除
          </Button>
        </div>
      )}

      <Spin spinning={loading}>
        <Card style={{ marginTop: 12 }} bodyStyle={{ padding: 12 }}>
          {/* 容器撑满卡片宽高：图谱随可用空间铺开，减少两侧与上下留白 */}
          <div
            ref={chartRef}
            style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 420 }}
          >
            <NetworkForce
              data={data ?? { nodes: [], edges: [] }}
              selectedId={selected?.id ?? null}
              onSelectNode={setSelected}
              modeFilter={modeFilter}
              search={search}
              selectionMode={selectionMode}
              onBoxSelect={setBoxIds}
              width={chartSize.width}
              height={chartSize.height}
            />
          </div>
          <Legend />
        </Card>
      </Spin>

      <Drawer
        title={selected ? selected.label : ''}
        open={selected != null}
        onClose={() => setSelected(null)}
        width={360}
      >
        {selected && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space>
              <Tag color={selected.type === 'carrier' ? 'orange' : 'blue'}>
                {selected.type === 'carrier' ? '承运商' : '口岸'}
              </Tag>
              {selected.country && <Tag>{selected.country}</Tag>}
              {selected.carrier_mode && (
                <Tag color="default">
                  {MODE_LABEL[selected.carrier_mode] ?? selected.carrier_mode}
                </Tag>
              )}
            </Space>

            <Paragraph style={{ marginBottom: 0 }}>
              关联运单量：<Text strong>{selected.volume}</Text> 票
            </Paragraph>

            <Paragraph style={{ marginBottom: 0 }}>
              准点率：
              {selected.on_time_rate != null ? (
                <Text
                  strong
                  style={{ color: selected.on_time_rate >= 0.95 ? '#2ea043' : '#f0a020' }}
                >
                  {Math.round(selected.on_time_rate * 100)}%
                </Text>
              ) : (
                <Text type="secondary">暂无评分样本</Text>
              )}
            </Paragraph>

            {selected.type === 'location' && (
              <Paragraph style={{ marginBottom: 0 }}>
                服务承运商数：<Text strong>{selected.served_by ?? 0}</Text> 家
              </Paragraph>
            )}
            {selected.type === 'carrier' && (
              <Paragraph style={{ marginBottom: 0 }}>
                服务口岸数：<Text strong>{selected.serves ?? 0}</Text> 个
              </Paragraph>
            )}

            {selected.top_lanes && selected.top_lanes.length > 0 && (
              <div>
                <Text type="secondary">
                  {selected.type === 'location'
                    ? '主要目的港（运量 Top 5）'
                    : '主要服务口岸（运量 Top 5）'}
                </Text>
                <div style={{ marginTop: 6 }}>
                  {selected.top_lanes.map((l) => (
                    <div
                      key={l.label}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '3px 0',
                        borderBottom: '1px solid rgba(5,5,5,0.06)',
                      }}
                    >
                      <span>{l.label}</span>
                      <span>
                        <Text strong>{l.count}</Text> 票
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selected.risk && (
              <Paragraph type="danger" style={{ marginBottom: 0 }}>
                ⚠ 风险：{RISK_DESC[selected.risk]}
              </Paragraph>
            )}

            {selected.partners && selected.partners.length > 0 && (
              <div>
                <Text type="secondary">主要合作方</Text>
                <div style={{ marginTop: 6 }}>
                  {selected.partners.map((p) => (
                    <Tag key={p} style={{ marginBottom: 4 }}>
                      {p}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            {selected.type === 'location' &&
              selected.lat != null &&
              selected.lng != null &&
              selected.code && (
                <Button
                  block
                  onClick={() => {
                    linkage.request({
                      kind: 'flyToPort',
                      code: selected.code as string,
                      label: selected.label,
                      point: { lat: selected.lat as number, lng: selected.lng as number },
                    })
                    navigate('/dashboard')
                  }}
                >
                  在地球定位
                </Button>
              )}

            {carrierId != null && (
              <Button
                type="primary"
                block
                onClick={() => navigate(`/shipments?carrier_id=${carrierId}`)}
              >
                查看该承运商运单
              </Button>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}
