// 仓库数字孪生页：Three.js 库区场景 + 月台 + 作业动画，
// 点库位出右侧详情（所属运单 / SKU / 状态），可从大屏点仓库标注直接进。
import { useEffect, useState } from 'react'
import { Alert, Card, Col, Row, Space, Spin, Statistic, Tag, Typography } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { getWarehouseLayout } from '@/api/warehouse'
import type { WarehouseLayout, WarehouseSlot } from '@/types/warehouse'
import WarehouseScene from './components/WarehouseScene'

const { Title, Text } = Typography

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  occupied: { text: '有货', color: 'blue' },
  empty: { text: '空位', color: 'default' },
  reserved: { text: '预占', color: 'orange' },
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
      {Object.entries(STATUS_LABEL).map(([k, v]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: k === 'occupied' ? '#2f81f7' : k === 'empty' ? '#33465c' : '#f0a020',
            }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {v.text}
          </Text>
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ffd666' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          当前选中
        </Text>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: '#3fd0c9' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          作业中搬运
        </Text>
      </span>
    </div>
  )
}

export default function Warehouse() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // id 合法性在渲染期判定（不是 effect 里 setState）：非法直接不发起请求，
  // 避免「effect 内同步 setState 触发级联渲染」
  const locationId = Number(id)
  const invalidId = !Number.isFinite(locationId) || locationId <= 0
  const [data, setData] = useState<WarehouseLayout | null>(null)
  const [loading, setLoading] = useState(!invalidId)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<WarehouseSlot | null>(null)

  useEffect(() => {
    if (invalidId) return
    let alive = true
    getWarehouseLayout(locationId)
      .then((d) => {
        if (alive) {
          setData(d)
          setSelected(null)
          setError(null)
        }
      })
      .catch(() => {
        if (alive) setError('仓库数据加载失败，场景可能不是最新的')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [locationId, invalidId])

  const total = data?.slots.length ?? 0
  // 已用 = 有货(occupied) + 预占(reserved)：与 3D 场景里着色的库位一致，
  // 单独数 occupied 会让「无真实运单」的仓库统计为 0、视觉却满屏，对不上。
  const used = data?.slots.filter((s) => s.status === 'occupied' || s.status === 'reserved').length ?? 0

  return (
    <div style={{ padding: '12px 16px 16px', height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Title level={4} style={{ marginTop: 0, marginBottom: 0 }}>
          仓库数字孪生{data ? ` · ${data.name}` : ''}
        </Title>
        <Space>
          {data && <Tag color="blue">{data.code}</Tag>}
          <Text type="secondary" style={{ fontSize: 12 }}>
            左键拖拽旋转 / 滚轮缩放 / 点库位看详情
          </Text>
        </Space>
      </div>

      {invalidId ? (
        <Alert
          type="error"
          showIcon
          message="仓库 id 不合法，请从大屏点击仓库标注进入"
          style={{ marginTop: 12 }}
        />
      ) : (
        error != null && <Alert type="warning" showIcon message={error} style={{ marginTop: 12 }} />
      )}

      <Spin spinning={loading}>
        <Row gutter={[16, 8]} style={{ marginTop: 12 }}>
          <Col xs={24} md={8}>
            <Card bodyStyle={{ padding: '10px 16px' }}>
              <Statistic title="库位总数" value={total} suffix="个" />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card bodyStyle={{ padding: '10px 16px' }}>
              <Statistic
                title="已用库位"
                value={used}
                suffix="个"
                valueStyle={{ color: '#2f81f7' }}
              />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card bodyStyle={{ padding: '10px 16px' }}>
              <Statistic
                title="占用率"
                value={data ? Math.round(data.occupancy_rate * 100) : 0}
                suffix="%"
              />
            </Card>
          </Col>
        </Row>

        <Card style={{ marginTop: 12 }} bodyStyle={{ padding: 12 }}>
          <div style={{ position: 'relative', height: 'max(280px, calc(100vh - 450px))' }}>
            {data && (
              <WarehouseScene
                layout={data}
                selectedIndex={selected?.index ?? null}
                onSelectSlot={setSelected}
              />
            )}
            {selected && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 240,
                  padding: '12px 14px',
                  background: 'rgba(13,30,51,0.92)',
                  border: '1px solid #274a6e',
                  borderRadius: 8,
                  color: '#dbe7f5',
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <strong>
                    库位 #{selected.index}（{selected.row}排 {selected.col}列 {selected.level}层）
                  </strong>
                  <span
                    style={{ cursor: 'pointer', color: '#8aa4c0', padding: '0 4px' }}
                    onClick={() => setSelected(null)}
                  >
                    ×
                  </span>
                </div>
                <div style={{ marginTop: 8, lineHeight: 1.9 }}>
                  <div>
                    状态：
                    <Tag color={STATUS_LABEL[selected.status]?.color}>
                      {STATUS_LABEL[selected.status]?.text ?? selected.status}
                    </Tag>
                  </div>
                  <div>SKU：{selected.sku ?? '—'}</div>
                  <div>运单：{selected.shipment_no ?? '—'}</div>
                </div>
              </div>
            )}
          </div>
          <Legend />
        </Card>

        <Card title="月台" style={{ marginTop: 12 }} bodyStyle={{ padding: '12px 16px' }}>
          <Space wrap>
            {data?.docks.map((d) => (
              <Tag key={d.code} color={d.status === 'loading' ? 'green' : 'default'}>
                {d.code} · {d.status === 'loading' ? '装卸中' : '空闲'}
                {d.shipment_no ? ` · ${d.shipment_no}` : ''}
              </Tag>
            ))}
          </Space>
          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              青色方块为在库作业：运单从月台搬向目标库位（运单在库位间流转）。
            </Text>
          </div>
        </Card>

        <Card style={{ marginTop: 12 }} bodyStyle={{ padding: '12px 16px' }}>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              想看某个仓库？回大屏点仓库标注即可直达（Cesium↔Three 联动）。
            </Text>
            <a onClick={() => navigate('/dashboard')} style={{ fontSize: 12 }}>
              回到全球大屏
            </a>
          </Space>
        </Card>
      </Spin>
    </div>
  )
}
