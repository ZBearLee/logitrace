// 方案 C：高德真实地图。动态加载高德 JS API（不引 npm 包），key 从 .env 读，无 key 降级提示。
// 注意：高德/天地图用 GCJ-02 坐标，后端轨迹是 WGS-84，真实地图会有几十~几百米偏移；
// 演示看不出，要准得做 WGS-84→GCJ-02 偏移转换（后续可加）。
// 上线前约束：高德 key 为公开可见（JS API 必现于前端），需在高德控制台为该 key 配域名白名单，
// 填线上域名（不含协议与端口），不要填 localhost 或服务器 IP；未加白的来源请求会被拒。
// dev / prod 建议用两个 key，dev key 不设或宽松白名单，prod key 绑死线上域名。
import { useEffect, useRef, useState } from 'react'
import { Alert } from 'antd'
import type { PositionPointOut } from '@/types/shipments'

const KEY = (import.meta.env as any).VITE_AMAP_KEY as string | undefined
const SECURITY = (import.meta.env as any).VITE_AMAP_SECURITY as string | undefined

let amapPromise: Promise<any> | null = null
function loadAMap(): Promise<any> {
  if (amapPromise) return amapPromise
  amapPromise = new Promise((resolve, reject) => {
    if (!KEY) {
      reject(new Error('未配置 VITE_AMAP_KEY'))
      return
    }
    if (SECURITY) {
      ;(window as any)._AMapSecurityConfig = { securityJsCode: SECURITY }
    }
    const script = document.createElement('script')
    // 走 Vite 代理（见 vite.config.ts 的 /amap），也可直接填 https://webapi.amap.com/maps
    script.src = `/amap/maps?v=2.0&key=${KEY}`
    script.onload = () => resolve((window as any).AMap)
    script.onerror = () => reject(new Error('高德 JS API 加载失败'))
    document.head.appendChild(script)
  })
  return amapPromise
}

export default function AMapMap({
  points,
  originCode,
  destCode,
}: {
  points: PositionPointOut[]
  originCode?: string | null
  destCode?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const pointsRef = useRef(points)
  pointsRef.current = points
  const [error, setError] = useState<string | null>(null)

  const drawAll = () => {
    const map = mapRef.current
    const AMap = (window as any).AMap
    if (!map || !AMap) return
    map.clearMap()
    const path = pointsRef.current.map((p) => [p.lng, p.lat])
    if (!path.length) return
    map.add(new AMap.Polyline({ path, strokeColor: '#ffd666', strokeWeight: 3 }))
    new AMap.Marker({ position: path[0], map, title: originCode ? `起 ${originCode}` : '起点' })
    new AMap.Marker({
      position: path[path.length - 1],
      map,
      title: destCode ? `终 ${destCode}` : '终点',
    })
    map.setFitView()
  }

  useEffect(() => {
    if (!ref.current) return
    let alive = true
    loadAMap()
      .then((AMap) => {
        if (!alive || !ref.current) return
        const map = new AMap.Map(ref.current, { viewMode: '2D', zoom: 2, center: [150, 40] })
        mapRef.current = map
        drawAll()
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '加载失败')
      })
    return () => {
      alive = false
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    drawAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, originCode, destCode])

  if (!KEY) {
    return (
      <Alert
        type="warning"
        message="未配置高德 Key"
        description="在 frontend/.env 配置 VITE_AMAP_KEY 与 VITE_AMAP_SECURITY 后即可显示真实地图"
      />
    )
  }
  if (error) {
    return <Alert type="error" message="高德地图加载失败" description={error} />
  }
  return <div ref={ref} style={{ width: '100%', height: 480 }} />
}
