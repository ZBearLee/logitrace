// 方案 C：高德真实地图。动态加载高德 JS API（不引 npm 包），key 从 .env 读，无 key 降级提示。
// 注意：高德/天地图用 GCJ-02 坐标，后端轨迹是 WGS-84，真实地图会有几十~几百米偏移；
// 演示看不出，要准得做 WGS-84→GCJ-02 偏移转换（后续可加）。
// 上线前约束：高德 key 为公开可见（JS API 必现于前端），需在高德控制台为该 key 配域名白名单，
// 填线上域名（不含协议与端口），不要填 localhost 或服务器 IP；未加白的来源请求会被拒。
// dev / prod 建议用两个 key，dev key 不设或宽松白名单，prod key 绑死线上域名。
import { useEffect, useRef, useState } from 'react'
import { Alert } from 'antd'
import type { LegOut, PositionPointOut } from '@/types/shipments'
import { buildPlanSegments, groupPointsByLeg, buildTrackSegments } from '@/utils/track'

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
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const pointsRef = useRef(points)
  pointsRef.current = points
  const overlayRef = useRef<{
    polylines: any[]
    planPolylines: any[]
    start: any
    end: any
    current: any | null
  } | null>(null)
  const fittedRef = useRef(false)
  const fitTimerRef = useRef<number | undefined>(undefined)
  // 首屏自适应完成（瓦片加载好）后置位：仅当它已为 true 时切运单才立即重 fit，
  // 避免首屏瓦片未就绪时的无效 setFitView 抢在 complete 兜底之前。
  const mapReadyRef = useRef(false)
  // 已自适应过的运单标识（首点 leg_id）：变化时说明切了运单，需重新 fit 视野。
  const fitKeyRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const drawAll = () => {
    const map = mapRef.current
    const AMap = (window as any).AMap
    if (!map || !AMap) return
    if (!pointsRef.current.length) return

    // 切运单检测：首点 leg_id 随运单变化，而实时推送每秒更新 points 时首点不变，
    // 因此用它作标识不会在实时推进中误触发。切单后重置一次性自适应标志并立即重 fit。
    const fitKey = pointsRef.current[0]?.leg_id ?? -1
    if (fitKey !== fitKeyRef.current) {
      fitKeyRef.current = fitKey
      fittedRef.current = false
      if (mapReadyRef.current) {
        map.setFitView(null, true)
        fittedRef.current = true
      }
    }

    // 按 leg_id 分组，防止多式联运时跨段连线导致乱麻；分组顺序即段顺序。
    const grouped = groupPointsByLeg(pointsRef.current)

    // 起点 / 终点 marker 直接用后端总起 / 总止经纬度（origin_lat/lng、dest_lat/lng），
    // 与规划路径虚线两端对齐；不再基于 points[0] / lastLeg 推算。
    const lastLeg = grouped[grouped.length - 1]
    const livePoint =
      lastLeg && lastLeg.length > 0 && lastLeg[lastLeg.length - 1].id < 0
        ? lastLeg[lastLeg.length - 1]
        : null

    // 每段独立 polyline：把实时点也纳入路径，让线连续到当前位置不断开；
    // 实时点本身用下方独立 marker 显示。跨 180° 经线处由 buildTrackSegments 拆段。
    const polylinesData = buildTrackSegments(pointsRef.current)

    // 复用：leg 数量未变则 setPath/setPosition，否则 clearMap 重建
    if (overlayRef.current && overlayRef.current.polylines.length === polylinesData.length) {
      overlayRef.current.polylines.forEach((pl, i) => pl.setPath(polylinesData[i]))
      // 起点 / 终点用后端总起 / 总止经纬度（与规划路径虚线两端对齐）
      if (originLat != null && originLng != null) {
        overlayRef.current.start.setPosition([originLng, originLat])
      }
      if (destLat != null && destLng != null && overlayRef.current.end) {
        overlayRef.current.end.setPosition([destLng, destLat])
      }
      if (livePoint) {
        if (!overlayRef.current.current) {
          overlayRef.current.current = new AMap.Marker({
            position: [livePoint.lng, livePoint.lat],
            map,
            title: '当前位置',
          })
        } else {
          overlayRef.current.current.setPosition([livePoint.lng, livePoint.lat])
        }
      }
      return
    }

    map.clearMap()
    // 规划路径基线（淡色虚线）：每段 origin → dest 沿大圆插值，已走过部分由
    // 下方 polylines 覆盖，形成"走过 vs 未走过"分色效果。
    // 已完成段整条已走过，不再画规划虚线，只保留实线历史轨迹。
    const planSegments = buildPlanSegments(legs?.filter((l) => l.status !== 'completed'))
    const planPolylines = planSegments.map(
      (path) =>
        new AMap.Polyline({
          path,
          strokeColor: '#9aa4ad',
          strokeWeight: 2,
          strokeOpacity: 0.6,
          strokeStyle: 'dashed',
          map,
        }),
    )
    const polylines = polylinesData.map(
      (path) =>
        new AMap.Polyline({
          path,
          strokeColor: '#1677ff',
          strokeWeight: 5,
          map,
        }),
    )
    // 起点 marker 用总起点经纬度（后端 origin_lat/lng），始终创建
    const startMarker =
      originLat != null && originLng != null
        ? new AMap.Marker({
            position: [originLng, originLat],
            map,
            title: originCode ? `起 ${originCode}` : '起点',
          })
        : null
    // 终点 marker 用总终点经纬度（后端 dest_lat/lng），始终创建——这是真实目的地坐标
    const endMarker =
      destLat != null && destLng != null
        ? new AMap.Marker({
            position: [destLng, destLat],
            map,
            title: destCode ? `终 ${destCode}` : '终点',
          })
        : null
    let currentMarker: any = null
    if (livePoint) {
      currentMarker = new AMap.Marker({
        position: [livePoint.lng, livePoint.lat],
        map,
        title: '当前位置',
      })
    }
    overlayRef.current = {
      polylines,
      planPolylines,
      start: startMarker,
      end: endMarker,
      current: currentMarker,
    }
  }

  useEffect(() => {
    if (!ref.current) return
    let alive = true
    loadAMap()
      .then((AMap) => {
        if (!alive || !ref.current) return
        const map = new AMap.Map(ref.current, { viewMode: '2D', zoom: 2, center: [150, 40] })
        mapRef.current = map
        // 视野自适应只做一次：实时点推进时反复 fit 会让地图不停缩放跳动。
        // new AMap.Map 后立即 setFitView 会被忽略，所以要挂 complete；但 complete
        // 依赖瓦片加载，瓦片慢或被拒时可能迟迟不触发，再加超时兜底，避免视野
        // 永远停在初始的世界级（看不到街道，看起来就像地图坏了）。
        const fitOnce = () => {
          if (fittedRef.current) return
          // 第二参 immediately=true 关闭 setFitView 默认的平移/缩放过渡动画：
          // 首屏与切单直接落位到轨迹范围，避免“先移动再放大”的过渡效果。
          map.setFitView(null, true)
          fittedRef.current = true
          mapReadyRef.current = true
        }
        map.on('complete', fitOnce)
        fitTimerRef.current = window.setTimeout(fitOnce, 1000)
        drawAll()
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '加载失败')
      })
    return () => {
      alive = false
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current)
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    drawAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, originCode, destCode, originLat, originLng, destLat, destLng, legs])

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
