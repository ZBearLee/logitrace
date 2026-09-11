// 物流关系网络（V2.1 D3 力导向）：口岸↔口岸航线 + 承运商服务口岸，后端一次聚合，D3 手写布局。
// 让图「活起来」：点节点出右侧详情抽屉（准点率 / 依赖风险 / 合作方）；风险节点自动标红；
// 按运输方式筛选航线、搜索高亮节点、选中后聚焦其邻居（其余淡出）。
import { useEffect, useState } from 'react'
import { Button, Card, Checkbox, Drawer, Input, Space, Spin, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getNetworkGraph } from '@/api/network'
import type { NetworkGraph, NetworkNode } from '@/types/network'
import NetworkForce from './components/NetworkForce'

const { Title, Text, Paragraph } = Typography

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

  useEffect(() => {
    let alive = true
    getNetworkGraph()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        /* 静默失败：网络留空 */
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
    <div style={{ padding: 16 }}>
      <Title level={4} style={{ marginTop: 0 }}>
        物流关系网络
      </Title>
      <Text type="secondary">
        口岸与承运商的关系拓扑：航线按运输方式着色，节点大小随运单量变化。点节点看详情、拖拽节点、滚轮缩放。
      </Text>

      <Space wrap style={{ marginTop: 12 }}>
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
      </Space>

      <Spin spinning={loading}>
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
            <NetworkForce
              data={data ?? { nodes: [], edges: [] }}
              selectedId={selected?.id ?? null}
              onSelectNode={setSelected}
              modeFilter={modeFilter}
              search={search}
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
