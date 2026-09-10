import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import type { MapOverview } from '@/types/shipments'

/** 初始视角：东经 105 / 北纬 20 上空 2400 万米，一屏俯瞰全球主要航线。 */
const HOME_LNG = 105
const HOME_LAT = 20
const HOME_HEIGHT = 24_000_000

/** 大屏配色：球底与页面背景同色，陆地略亮一档，靠同色系深浅分层形成轮廓。 */
const GLOBE_COLOR = '#0b1f33'
const LAND_FILL = '#1a3a5f'
const PORT_COLOR = '#8ab4dd'

/**
 * 数据层悬浮高度：航线/船位在地表上空 50km、地点在 5km。
 * 零高度的地物会和陆地多边形在同一深度打架，穿过陆地的线段会被遮掉
 * （看起来像「线被海洋切断」）；抬空后与陆地分层，近看也不陷球体，
 * 全球视角下这点高度完全不可见，近看反而有「浮在地图上方」的层次。
 */
const ROUTE_HEIGHT = 50_000
const PORT_HEIGHT = 5_000

/** 运单状态 → 航线与当前位置点的颜色。 */
const ROUTE_COLOR: Record<string, string> = {
  planned: '#6e7681',
  in_transit: '#2f81f7',
  delivered: '#2ea043',
  delayed: '#f0a020',
}

/** 实体 id 前缀：点击拾取时按前缀区分航线/当前位置/港口。 */
const ID_ROUTE = 'route:'
const ID_POS = 'pos:'
const ID_PORT = 'port:'

type Ring = number[][]
type Rings = Ring[]

/** 点击后弹出的信息卡内容。 */
interface InfoCard {
  kind: 'route' | 'port'
  title: string
  lines: string[]
  shipmentId?: number
}

/** GeoJSON 的 [lng, lat] 环 → Cesium 笛卡尔序列。 */
function ringToPositions(ring: Ring): Cesium.Cartesian3[] {
  // GeoJSON 用「首尾点是同一个点」表示环闭合；Cesium 的层级里这算重复顶点，
  // 会让几何构建直接崩（DeveloperError: All attribute lists must have the same
  // number of attributes），必须去掉尾点再喂。
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  const pts = closed ? ring.slice(0, -1) : ring
  return Cesium.Cartesian3.fromDegreesArray(pts.flat())
}

export default function CesiumMap({ data }: { data: MapOverview | null }) {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  // 与运单详情两个地图共用同一份世界矢量数据（world-atlas TopoJSON 转的 GeoJSON）
  const { geo } = useWorldGeo()

  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const routeDsRef = useRef<Cesium.CustomDataSource | null>(null)
  // 点击处理器里要读最新的地图数据，用 ref 桥接，避免 data 变化就重建 handler
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const [card, setCard] = useState<InfoCard | null>(null)
  // 默认只盯在途与延误（控制塔真正要看的），可切回全部运单看全球航线网
  const [viewMode, setViewMode] = useState<'active' | 'all'>('active')

  useEffect(() => {
    const container = containerRef.current
    if (container == null) return

    const viewer = new Cesium.Viewer(container, {
      // 不加载影像瓦片：境外瓦片源在目标网络下均不可用（官方影像要 token、
      // Carto 要 key、Esri 连接超时）。地表改为暗底球色 + 世界矢量国界，
      // 零外部依赖、离线可用。后续要影像细节时配好 token 换回影像图层即可。
      baseLayer: false,
      // 按设备物理分辨率渲染：高分屏/系统缩放下缺省值会发虚
      useBrowserRecommendedResolution: true,
      // 大屏不需要这些默认控件：搜索框/全屏/场景切换与业务无关；
      // 时间轴与动画控件等做轨迹回放时再开启。
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    })
    // 隐藏左下角 Cesium ion 标识：本方案不使用任何官方影像服务，无需其署名。
    // Cesium 把它声明成 Element（运行时实际是 div），取 style 需要断言成 HTMLElement
    ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
    // 关闭 FXAA 后处理：它会把整个画面软化发虚，暗色矢量场景尤其明显
    viewer.scene.postProcessStages.fxaa.enabled = false
    // 动态分辨率：静止时 2 倍超采样取锐利，拖动/缩放过程中回落到 1 保流畅。
    // 固定 2 倍等于 4 倍像素填充，一直开着在弱 GPU 上拖动会掉帧，所以只在静止时开。
    viewer.resolutionScale = 2
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const onCameraChanged = () => {
      viewer.resolutionScale = 1
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        viewer.resolutionScale = 2
      }, 300)
    }
    viewer.camera.changed.addEventListener(onCameraChanged)
    // 无影像时的地表底色
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(GLOBE_COLOR)

    // 国界必须同步构建实体，不能走 GeoJsonDataSource.load 异步加载：
    // 那个 promise 在 StrictMode/热更的「挂载→销毁→再挂载」循环里会和 viewer
    // 销毁竞态，表现为只有首次渲染有轮廓、切页回来就没了（附带 worker 残留报错）。
    // 同步添加的实体随 viewer 一并销毁，切多少次都稳定。
    if (geo) {
      const features = (
        geo as { features: Array<{ geometry: { type: string; coordinates: unknown } | null }> }
      ).features
      for (const f of features) {
        const g = f.geometry
        if (!g) continue
        const polygons: Rings[] =
          g.type === 'Polygon'
            ? [g.coordinates as Rings]
            : g.type === 'MultiPolygon'
              ? (g.coordinates as Rings[])
              : []
        for (const rings of polygons) {
          if (rings.length === 0 || rings[0].length < 3) continue
          viewer.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(
                ringToPositions(rings[0]),
                rings.slice(1).map((r) => new Cesium.PolygonHierarchy(ringToPositions(r))),
              ),
              material: Cesium.Color.fromCssColorString(LAND_FILL),
              // 指定 height:0 走普通多边形几何：贴地（ground）多边形要经过
              // 「长边分割」管线，跨经度的大国多边形在那里崩掉渲染循环。
              // 椭球无地形，height:0 与贴地视觉完全一致。
              height: 0,
              // 不能开 outline：贴地/零高度多边形的描边不受支持，同样会崩渲染循环，
              // 轮廓靠陆地填充色与球底色的深浅对比呈现。
            },
          })
        }
      }
    }

    // 航线/港口/当前位置单独放一个 DataSource：数据刷新时只清这一层，不动国界
    const routeDs = new Cesium.CustomDataSource('routes')
    viewer.dataSources.add(routeDs)
    viewerRef.current = viewer
    routeDsRef.current = routeDs

    // 点击拾取：按实体 id 前缀区分类型，弹对应信息卡；点空白处收起
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    // setInputAction 的 action 是多种回调的联合类型，TS 无法从联合推断回调参数，
    // 必须显式标注（LEFT_CLICK 走 PositionedEvent）
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position)
      const raw = picked?.id?.id
      if (typeof raw !== 'string') {
        setCard(null)
        return
      }
      const snapshot = dataRef.current
      if (!snapshot) return
      if (raw.startsWith(ID_ROUTE) || raw.startsWith(ID_POS)) {
        const shipmentId = Number(raw.split(':')[1])
        const route = snapshot.routes.find((r) => r.shipment_id === shipmentId)
        if (route) {
          setCard({
            kind: 'route',
            title: route.shipment_no,
            lines: [
              `状态 ${route.status}`,
              ...route.legs.map(
                (l) => `${l.origin_code ?? '?'} → ${l.dest_code ?? '?'} · ${l.mode}`,
              ),
            ],
            shipmentId: route.shipment_id,
          })
        }
      } else if (raw.startsWith(ID_PORT)) {
        const code = raw.slice(ID_PORT.length)
        const port = snapshot.ports.find((p) => p.code === code)
        if (port) setCard({ kind: 'port', title: port.code, lines: [port.name] })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_LNG, HOME_LAT, HOME_HEIGHT),
    })

    return () => {
      handler.destroy()
      if (idleTimer) clearTimeout(idleTimer)
      viewer.camera.changed.removeEventListener(onCameraChanged)
      viewerRef.current = null
      routeDsRef.current = null
      // 必须销毁：StrictMode 下 effect 会挂载两次，不销毁会残留 WebGL 上下文，
      // 浏览器上下文数量有上限，反复切换页面后会白屏。
      viewer.destroy()
    }
  }, [geo])

  useEffect(() => {
    const ds = routeDsRef.current
    if (ds == null) return
    ds.entities.removeAll()
    if (data == null) return
    const routes =
      viewMode === 'all'
        ? data.routes
        : data.routes.filter((r) => r.status === 'in_transit' || r.status === 'delayed')

    // 航线：每段一条弧线，颜色随运单状态；polyline 默认 arcType 即 GEODESIC，
    // 两点自动沿大圆弧插值，天然就是「大圆航线」
    for (const route of routes) {
      const color = Cesium.Color.fromCssColorString(ROUTE_COLOR[route.status] ?? '#6e7681')
      for (const leg of route.legs) {
        const oLat = leg.origin_lat
        const oLng = leg.origin_lng
        const dLat = leg.dest_lat
        const dLng = leg.dest_lng
        if (oLat == null || oLng == null || dLat == null || dLng == null) continue
        ds.entities.add({
          // id 必须带段序号：一条运单有多段，重复 id 会让 EntityCollection 直接抛 DeveloperError
          id: `${ID_ROUTE}${route.shipment_id}:${leg.seq}`,
          polyline: {
            // 两端同高 → 大圆插值全线同高：悬浮在陆地块上方，不再被遮挡
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([
              oLng,
              oLat,
              ROUTE_HEIGHT,
              dLng,
              dLat,
              ROUTE_HEIGHT,
            ]),
            width: 1.5,
            material: color.withAlpha(0.7),
          },
        })
      }
      // 船位亮点只给在途/延误画：已送达运单的 latest 停在终点，画出来会被误认成船位
      if (
        (route.status === 'in_transit' || route.status === 'delayed') &&
        route.latest_lat != null &&
        route.latest_lng != null
      ) {
        ds.entities.add({
          id: `${ID_POS}${route.shipment_id}`,
          position: Cesium.Cartesian3.fromDegrees(route.latest_lng, route.latest_lat, ROUTE_HEIGHT),
          point: {
            pixelSize: 6,
            color,
            outlineWidth: 1,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
          },
        })
      }
    }

    // 地点标注：小点 + code 文字
    for (const port of data.ports) {
      ds.entities.add({
        id: `${ID_PORT}${port.code}`,
        position: Cesium.Cartesian3.fromDegrees(port.lng, port.lat, PORT_HEIGHT),
        point: { pixelSize: 4, color: Cesium.Color.fromCssColorString(PORT_COLOR) },
        label: {
          text: port.code,
          font: '11px sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#c9d7e8'),
          pixelOffset: new Cesium.Cartesian2(0, -10),
          // 文字只在拉近后显示：全球视角下几十个 code 全渲染会挤成一团
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12_000_000),
        },
      })
    }
  }, [data, viewMode])

  /** 回到初始全球视角：拖动/缩放迷失方向后一键复位。 */
  const resetView = () => {
    viewerRef.current?.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_LNG, HOME_LAT, HOME_HEIGHT),
    })
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8 }}>
        <select
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as 'active' | 'all')}
          style={{
            cursor: 'pointer',
            background: 'rgba(13,30,51,0.85)',
            border: '1px solid #274a6e',
            borderRadius: 6,
            padding: '6px 8px',
            color: '#c9d7e8',
            fontSize: 12,
          }}
        >
          <option value="active">在途 + 延误</option>
          <option value="all">全部运单</option>
        </select>
        <button
          style={{
            cursor: 'pointer',
            background: 'rgba(13,30,51,0.85)',
            border: '1px solid #274a6e',
            borderRadius: 6,
            padding: '6px 12px',
            color: '#c9d7e8',
            fontSize: 12,
          }}
          onClick={resetView}
        >
          复位视角
        </button>
      </div>
      {/* 点击拾取到的信息卡：固定在右上角，不遮挡球面主体 */}
      {card != null && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 260,
            padding: '12px 14px',
            background: 'rgba(13,30,51,0.92)',
            border: '1px solid #274a6e',
            borderRadius: 8,
            color: '#dbe7f5',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 13 }}>{card.title}</strong>
            <span
              style={{ cursor: 'pointer', color: '#8aa4c0', padding: '0 4px' }}
              onClick={() => setCard(null)}
            >
              ×
            </span>
          </div>
          <div style={{ marginTop: 8, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
            {card.lines.join('\n')}
          </div>
          {card.shipmentId != null && (
            <button
              style={{
                marginTop: 10,
                width: '100%',
                cursor: 'pointer',
                background: '#1f4e8c',
                border: 'none',
                borderRadius: 4,
                padding: '6px 0',
                color: '#fff',
                fontSize: 12,
              }}
              onClick={() => navigate(`/shipments/${card.shipmentId}`)}
            >
              查看运单详情
            </button>
          )}
        </div>
      )}
    </div>
  )
}
