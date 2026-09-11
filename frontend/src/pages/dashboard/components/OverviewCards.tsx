// 大屏概览 KPI 卡片：在途 / 延误 / 已计划 / 已送达 + 今日事件，右边缘垂直悬浮。
// 数据来自后端 /map/stats 一次聚合；状态分布每 15s 轮询刷新，今日事件额外接
// WS 事件流实时 +1（实时事件即「今天」），不用等下一轮轮询也能看到数字跳。
import { useEffect, useState } from 'react'
import { connectEvents } from '@/api/ws'
import { getMapStats } from '@/api/shipments'
import { statusLabel } from '@/constants/shipments'
import type { MapStats } from '@/types/shipments'

// 与 CesiumMap 的 ROUTE_COLOR 保持一致的状态配色，两套视图读起来是同套语义
const STATUS_HEX: Record<string, string> = {
  in_transit: '#2f81f7',
  delayed: '#f0a020',
  delivered: '#2ea043',
  planned: '#6e7681',
}
const STATUS_ORDER = ['in_transit', 'delayed', 'delivered', 'planned']

const REFRESH_MS = 15_000

function useOverviewStats() {
  const [stats, setStats] = useState<MapStats | null>(null)

  // 状态分布轮询：控制塔数字要一直新鲜，但不必每条消息都打接口
  useEffect(() => {
    let alive = true
    const load = () => {
      getMapStats()
        .then((s) => {
          if (alive) setStats(s)
        })
        .catch(() => {
          /* 静默失败：卡片先不显示，地图照常转 */
        })
    }
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  // 实时事件流：每来一条里程碑就给今日事件 +1（实时事件即「今天」）
  useEffect(() => {
    const stop = connectEvents(() => {
      setStats((prev) => (prev ? { ...prev, today_events: prev.today_events + 1 } : prev))
    })
    return stop
  }, [])

  return stats
}

/** 右侧垂直 KPI 条：总运单 + 四态分布 + 今日事件。 */
export default function OverviewCards() {
  const stats = useOverviewStats()
  if (stats == null) return null

  const cards = [
    { label: '总运单', value: stats.total, color: '#c9d7e8' },
    ...STATUS_ORDER.map((s) => ({
      label: statusLabel(s),
      value: stats.by_status[s] ?? 0,
      color: STATUS_HEX[s],
    })),
    { label: '今日事件', value: stats.today_events, color: '#2f81f7' },
  ]

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            minWidth: 80,
            background: 'rgba(13,30,51,0.82)',
            border: '1px solid #274a6e',
            borderRight: `2px solid ${c.color}`,
            borderRadius: 8,
            padding: '6px 10px',
            textAlign: 'right',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: c.color, lineHeight: 1.1 }}>
            {c.value}
          </div>
          <div style={{ fontSize: 10, color: '#9fb4cc', marginTop: 2 }}>{c.label}</div>
        </div>
      ))}
    </div>
  )
}
