// 轨迹 / 规划路径的纯几何计算：把三个地图组件里重复的分组、跨 180° 拆段、
// 大圆插值基线提取到这里，地图组件只负责把结果画出来，避免三套近似实现漂移。
import type { LegOut, PositionPointOut } from '@/types/shipments'
import { interpolateLegGreatCircle } from './geo'

/** 多段运单的轨迹颜色，按段顺序循环取用。 */
export const TRACK_COLORS = ['#ffd666', '#ff9c6e', '#69c0ff', '#b37feb', '#95de64']

/** 按 leg_id 分组并保持输入顺序：displayPositions 已按 leg.seq 排好，故分组顺序即段顺序。 */
export function groupPointsByLeg(points: PositionPointOut[]): PositionPointOut[][] {
  const byLeg = new Map<number, PositionPointOut[]>()
  for (const p of points) {
    if (!byLeg.has(p.leg_id)) byLeg.set(p.leg_id, [])
    byLeg.get(p.leg_id)!.push(p)
  }
  return Array.from(byLeg.values())
}

/** 跨 180° 经线处拆段：相邻点经度差 > 180 视为跨越国际日期变更线，否则会连成横贯地图的误线。 */
export function segmentByAntimeridian(coords: [number, number][]): [number, number][][] {
  const segs: [number, number][][] = []
  let seg: [number, number][] = []
  let prevLng: number | null = null
  for (const [lng, lat] of coords) {
    if (prevLng !== null && Math.abs(lng - prevLng) > 180) {
      if (seg.length >= 2) segs.push(seg)
      seg = []
    }
    seg.push([lng, lat])
    prevLng = lng
  }
  if (seg.length >= 2) segs.push(seg)
  return segs
}

/** 规划路径基线：每段 leg 沿大圆航线插值（与后端 position_points 同算法），再跨 180 拆段。 */
export function buildPlanSegments(legs: LegOut[] | undefined): [number, number][][] {
  const out: [number, number][][] = []
  if (!legs) return out
  for (const leg of legs) {
    if (
      leg.origin_lat == null ||
      leg.origin_lng == null ||
      leg.dest_lat == null ||
      leg.dest_lng == null
    )
      continue
    const coords = interpolateLegGreatCircle(
      leg.origin_lat,
      leg.origin_lng,
      leg.dest_lat,
      leg.dest_lng,
    )
    for (const s of segmentByAntimeridian(coords)) out.push(s)
  }
  return out
}

/** 历史轨迹线段：按 leg 分组后每段跨 180 拆段，返回可直接连线的 [lng,lat] 段序列。 */
export function buildTrackSegments(points: PositionPointOut[]): [number, number][][] {
  const out: [number, number][][] = []
  for (const leg of groupPointsByLeg(points)) {
    const coords = leg.map((p) => [p.lng, p.lat] as [number, number])
    for (const s of segmentByAntimeridian(coords)) out.push(s)
  }
  return out
}

export interface LngLatBounds {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

/** 计算一组经纬度的范围；空输入返回 null，便于调用方决定兜底。 */
export function computeBounds(coords: [number, number][]): LngLatBounds | null {
  if (!coords.length) return null
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLng, maxLng, minLat, maxLat }
}
