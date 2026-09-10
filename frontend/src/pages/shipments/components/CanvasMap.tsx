// 方案 B：Canvas 铺世界地图底图（用 world-atlas 矢量数据投影描边）+ polyline 画轨迹。
// 视野按轨迹点的经纬度范围自适应：短途运单（如几十公里的公路段）若按整个世界
// 投影，在画布上不足一个像素，根本看不见，所以必须先算出轨迹范围再投影。
import { useEffect, useRef } from 'react'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import type { LegOut, PositionPointOut } from '@/types/shipments'
import { buildPlanSegments, groupPointsByLeg, computeBounds, TRACK_COLORS } from '@/utils/track'

/** 按轨迹范围生成等距圆柱投影，让轨迹填满画布并留出边距 */
function makeProjector(points: PositionPointOut[], w: number, h: number, pad = 48) {
  // 单点或所有点重合时兜一个最小跨度，避免除零；无点时退回世界范围
  const b = computeBounds(points.map((p) => [p.lng, p.lat] as [number, number]))
  const minLng = b?.minLng ?? -180
  const maxLng = b?.maxLng ?? 180
  const minLat = b?.minLat ?? -90
  const maxLat = b?.maxLat ?? 90
  const spanLng = Math.max(maxLng - minLng, 0.05)
  const spanLat = Math.max(maxLat - minLat, 0.05)
  // 取较小的缩放比，保证等比不拉伸变形
  const scale = Math.min((w - pad * 2) / spanLng, (h - pad * 2) / spanLat)
  const cx = (minLng + maxLng) / 2
  const cy = (minLat + maxLat) / 2
  return (lng: number, lat: number): [number, number] => [
    w / 2 + (lng - cx) * scale,
    h / 2 - (lat - cy) * scale,
  ]
}

function drawCoast(
  ctx: CanvasRenderingContext2D,
  geo: any,
  project: (lng: number, lat: number) => [number, number],
) {
  ctx.strokeStyle = '#2f5d8a'
  ctx.lineWidth = 0.5
  ctx.fillStyle = '#14304d'
  for (const f of geo.features as any[]) {
    const geom = f.geometry
    if (!geom) continue
    const polys =
      geom.type === 'Polygon'
        ? [geom.coordinates]
        : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : []
    for (const poly of polys as any[]) {
      for (const ring of poly) {
        ctx.beginPath()
        ring.forEach(([lng, lat]: [number, number], i: number) => {
          const [x, y] = project(lng, lat)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }
  }
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  points: PositionPointOut[],
  project: (lng: number, lat: number) => [number, number],
) {
  if (!points.length) return

  // 按 leg_id 分组，防止多式联运时跨段连线导致乱麻；分组顺序即段顺序。
  const groupedLegs = groupPointsByLeg(points)

  // 每段独立绘制轨迹：把实时点也画进线里，避免落库滞后导致线停在实时点之前"断开"；
  // 实时点本身在下方用单独的绿圈叠加显示。
  groupedLegs.forEach((leg, idx) => {
    if (leg.length === 0) return

    ctx.strokeStyle = TRACK_COLORS[idx % TRACK_COLORS.length]
    ctx.lineWidth = 3
    ctx.beginPath()
    let started = false
    let prevLng: number | null = null
    for (const p of leg) {
      if (prevLng !== null && Math.abs(p.lng - prevLng) > 180) started = false
      const [x, y] = project(p.lng, p.lat)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
      prevLng = p.lng
    }
    ctx.stroke()
  })

  // 起点 / 终点 marker 改由 useEffect 在 drawTrack 之后用后端总起 / 总止经纬度
  // 统一绘制，drawTrack 只画轨迹本身。

  // 实时位置点：每个在途 leg 末尾画一个绿色高亮圈
  groupedLegs.forEach((leg) => {
    if (leg.length > 0 && leg[leg.length - 1].id < 0) {
      const live = leg[leg.length - 1]
      const [lx, ly] = project(live.lng, live.lat)
      ctx.fillStyle = '#52c41a'
      ctx.beginPath()
      ctx.arc(lx, ly, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  })
}

export default function CanvasMap({
  points,
  originCode,
  destCode,
  originLat,
  originLng,
  destLat,
  destLng,
  legs,
}: {
  points: PositionPointOut[]
  originCode?: string | null
  destCode?: string | null
  originLat?: number | null
  originLng?: number | null
  destLat?: number | null
  destLng?: number | null
  legs?: LegOut[]
}) {
  const { geo } = useWorldGeo()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#0b1f33'
    ctx.fillRect(0, 0, w, h)
    // 视野自适应要把总起/总止纳入范围，否则规划路径端点会被裁掉
    // 必须拷贝：下面 push 起/终点是为了算视野，直接改入参会污染 points 本身，
    // 让 drawTrack 把这俩伪点当成实时点（id<0）多画两个绿圈，且数组会逐帧增长。
    const allForView: PositionPointOut[] = [...points]
    if (originLat != null && originLng != null) {
      allForView.push({
        id: -1,
        leg_id: -1,
        lat: originLat,
        lng: originLng,
        speed: null,
        heading: null,
        recorded_at: '',
      })
    }
    if (destLat != null && destLng != null) {
      allForView.push({
        id: -2,
        leg_id: -2,
        lat: destLat,
        lng: destLng,
        speed: null,
        heading: null,
        recorded_at: '',
      })
    }
    if (!allForView.length) return
    const project = makeProjector(allForView, w, h)
    if (geo) drawCoast(ctx, geo, project)

    // 规划路径基线（淡色虚线）：每段 origin → dest 沿大圆插值，已走过部分由
    // drawTrack 中的鲜艳色轨迹覆盖，形成"一条线、走过 vs 未走过分色"。
    // 已完成段整条已走过，不再画规划虚线，只保留实线历史轨迹。
    const planSegments = buildPlanSegments(legs?.filter((l) => l.status !== 'completed'))
    if (planSegments.length) {
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = '#9aa4ad'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.6
      for (const seg of planSegments) {
        if (seg.length < 2) continue
        ctx.beginPath()
        for (let i = 0; i < seg.length; i++) {
          const [x, y] = project(seg[i][0], seg[i][1])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    drawTrack(ctx, points, project)

    // 起点 marker（绿色）：总起点位置（后端 origin_lat/lng）
    if (originLat != null && originLng != null) {
      const [sx, sy] = project(originLng, originLat)
      ctx.fillStyle = '#52c41a'
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '12px sans-serif'
      ctx.fillText(originCode ? `起 ${originCode}` : '起', sx + 8, sy - 8)
    }

    // 终点 marker（红色）：总终点位置（后端 dest_lat/lng），始终可见，
    // 不再受"最后一段是否还在途中"影响——这是真实目的地坐标。
    if (destLat != null && destLng != null) {
      const [ex, ey] = project(destLng, destLat)
      ctx.fillStyle = '#ff4d4f'
      ctx.beginPath()
      ctx.arc(ex, ey, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '12px sans-serif'
      ctx.fillText(destCode ? `终 ${destCode}` : '终', ex + 8, ey - 8)
    }
  }, [geo, points, originCode, destCode, originLat, originLng, destLat, destLng, legs])

  return (
    <canvas
      ref={ref}
      width={960}
      height={480}
      style={{ width: '100%', height: 480, background: '#0b1f33', display: 'block' }}
    />
  )
}
