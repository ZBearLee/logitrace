// 大圆航线插值（球面 slerp）—— 与后端 simulator/geo.py 的 interpolate_great_circle
// 同算法。前端用它把"未走过的虚线"也画在同一条大圆航线上，
// 这样已走过的实线（来自 position_points）和未走过的虚线是同一条路径、
// 按当前进度分色，而不是路径不同形状的"两条线"观感。

const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

export function interpolateGreatCircle(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  t: number,
): [number, number] {
  const phi1 = toRad(lat1)
  const lam1 = toRad(lng1)
  const phi2 = toRad(lat2)
  const lam2 = toRad(lng2)
  const delta =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((phi2 - phi1) / 2) ** 2 +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2,
      ),
    )
  if (delta === 0) return [lat1, lng1]
  const a = Math.sin((1 - t) * delta) / Math.sin(delta)
  const b = Math.sin(t * delta) / Math.sin(delta)
  const x = a * Math.cos(phi1) * Math.cos(lam1) + b * Math.cos(phi2) * Math.cos(lam2)
  const y = a * Math.cos(phi1) * Math.sin(lam1) + b * Math.cos(phi2) * Math.sin(lam2)
  const z = a * Math.sin(phi1) + b * Math.sin(phi2)
  const phi = Math.atan2(z, Math.sqrt(x * x + y * y))
  const lam = Math.atan2(y, x)
  return [toDeg(phi), toDeg(lam)]
}

/** 把一段 leg 从 origin 到 dest 在大圆航线上均匀插值 steps 段，返回 [lng, lat] 序列。 */
export function interpolateLegGreatCircle(
  oLat: number,
  oLng: number,
  dLat: number,
  dLng: number,
  steps = 24,
): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const [lat, lng] = interpolateGreatCircle(oLat, oLng, dLat, dLng, i / steps)
    out.push([lng, lat])
  }
  return out
}
