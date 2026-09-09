// 方案 B：Canvas 铺世界地图底图（用 world-atlas 矢量数据投影描边）+ polyline 画轨迹。
// 视野按轨迹点的经纬度范围自适应：短途运单（如几十公里的公路段）若按整个世界
// 投影，在画布上不足一个像素，根本看不见，所以必须先算出轨迹范围再投影。
import { useEffect, useRef } from 'react'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import type { PositionPointOut } from '@/types/shipments'

/** 按轨迹范围生成等距圆柱投影，让轨迹填满画布并留出边距 */
function makeProjector(points: PositionPointOut[], w: number, h: number, pad = 48) {
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  // 单点或所有点重合时兜一个最小跨度，避免除零
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
  startLabel: string,
  endLabel: string,
) {
  ctx.strokeStyle = '#ffd666'
  ctx.lineWidth = 3
  ctx.beginPath()
  let started = false
  let prevLng: number | null = null
  for (const p of points) {
    // 相邻点经度差 > 180 视为跨越 180° 经线，断开线段避免横贯地图
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

  if (points.length) {
    const [sx, sy] = project(points[0].lng, points[0].lat)
    const [ex, ey] = project(points[points.length - 1].lng, points[points.length - 1].lat)
    ctx.fillStyle = '#52c41a'
    ctx.beginPath()
    ctx.arc(sx, sy, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff4d4f'
    ctx.beginPath()
    ctx.arc(ex, ey, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '12px sans-serif'
    ctx.fillStyle = '#52c41a'
    ctx.fillText(startLabel, sx + 8, sy - 8)
    ctx.fillStyle = '#ff4d4f'
    ctx.fillText(endLabel, ex + 8, ey - 8)
  }
}

export default function CanvasMap({
  points,
  originCode,
  destCode,
}: {
  points: PositionPointOut[]
  originCode?: string | null
  destCode?: string | null
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
    if (!points.length) return
    const project = makeProjector(points, w, h)
    if (geo) drawCoast(ctx, geo, project)
    drawTrack(
      ctx,
      points,
      project,
      originCode ? `起 ${originCode}` : '起',
      destCode ? `终 ${destCode}` : '终',
    )
  }, [geo, points, originCode, destCode])

  return (
    <canvas
      ref={ref}
      width={960}
      height={480}
      style={{ width: '100%', height: 480, background: '#0b1f33', display: 'block' }}
    />
  )
}
