// 方案 B：Canvas 铺世界地图底图（用 world-atlas 矢量数据投影描边）+ polyline 画轨迹。
// 等距圆柱投影：经度[-180,180]→x，纬度[90,-90]→y。跨 180° 经线时断开线段。
import { useEffect, useRef } from 'react'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import type { PositionPointOut } from '@/types/shipments'

function project(lng: number, lat: number, w: number, h: number): [number, number] {
  return [((lng + 180) / 360) * w, ((90 - lat) / 180) * h]
}

function drawCoast(ctx: CanvasRenderingContext2D, geo: any, w: number, h: number) {
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
          const [x, y] = project(lng, lat, w, h)
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
  w: number,
  h: number,
  startLabel: string,
  endLabel: string,
) {
  ctx.strokeStyle = '#ffd666'
  ctx.lineWidth = 2
  ctx.beginPath()
  let started = false
  let prevLng: number | null = null
  for (const p of points) {
    // 相邻点经度差 > 180 视为跨越 180° 经线，断开线段避免横贯地图
    if (prevLng !== null && Math.abs(p.lng - prevLng) > 180) started = false
    const [x, y] = project(p.lng, p.lat, w, h)
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
    const [sx, sy] = project(points[0].lng, points[0].lat, w, h)
    const [ex, ey] = project(points[points.length - 1].lng, points[points.length - 1].lat, w, h)
    ctx.fillStyle = '#52c41a'
    ctx.beginPath()
    ctx.arc(sx, sy, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff4d4f'
    ctx.beginPath()
    ctx.arc(ex, ey, 4, 0, Math.PI * 2)
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
    if (geo) drawCoast(ctx, geo, w, h)
    drawTrack(
      ctx,
      points,
      w,
      h,
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
