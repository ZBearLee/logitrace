import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import { connectPositions } from '@/api/ws'
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
// 实际轨迹比计划航线高出一截：避免两条线在同一高度 z-fight，
// 让「已走过」的实线始终压在虚线上面，而不是被虚线盖住。
const TRAIL_HEIGHT = ROUTE_HEIGHT + 1_000

/** 运单状态 → 航线与当前位置点的颜色。 */
const ROUTE_COLOR: Record<string, string> = {
  planned: '#6e7681',
  in_transit: '#2f81f7',
  delivered: '#2ea043',
  delayed: '#f0a020',
}

/** 实体 id 前缀：点击拾取时按前缀区分航线/尾迹/当前位置/港口。 */
const ID_ROUTE = 'route:'
const ID_TRAIL = 'trail:'
const ID_POS = 'pos:'
const ID_PORT = 'port:'

/**
 * 已走过/已送达画实线（亮青），未经过画虚线（暗），和运单详情保持一致。
 * 实际轨迹从段原点开始，避免后端只返回最近点时看起来从中间冒出来。
 */
const ACTUAL_COLOR = '#3fd0c9'

/** 单条尾迹保留的点数上限：超出丢头部，避免长时间挂着让数组无限增长。 */
const TRAIL_MAX_POINTS = 240

/** 与上一点距离小于该值（米）的位置点丢弃：模拟器高频上报，过滤零位移抖动。 */
const MIN_TRAIL_STEP = 10

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

/** 把一段尾迹画到 ds：实体按需创建，positions 必须传新数组才会被认定变更。 */
function upsertTrail(ds: Cesium.CustomDataSource, legId: number, pts: Cesium.Cartesian3[]) {
  if (pts.length < 2) return
  let trail = ds.entities.getById(`${ID_TRAIL}${legId}`)
  if (trail == null) {
    trail = ds.entities.add({
      id: `${ID_TRAIL}${legId}`,
      polyline: {
        width: 3,
        material: Cesium.Color.fromCssColorString(ACTUAL_COLOR).withAlpha(0.95),
        positions: [],
      },
    })
  }
  const line = trail.polyline
  if (line != null) line.positions = new Cesium.ConstantProperty(pts.slice())
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

  // 实时尾迹：leg_id → 走过的点。放 ref 而不是 state——位置消息每秒数十条，
  // 走 state 会让整棵组件树跟着重渲染。
  const trailsRef = useRef<Map<number, Cesium.Cartesian3[]>>(new Map())
  // 位置流只上报 leg_id，需要映射回运单才能更新对应船位
  const legToShipmentRef = useRef<Map<number, number>>(new Map())
  // 实时尾迹需要从段原点开始画（已走过 = 实线），位置流里只有当前点，用 ref 记住每段原点
  const legOriginRef = useRef<Map<number, Cesium.Cartesian3>>(new Map())
  // 最近一次收到位置的时间：只进 ref，心跳组件自己每秒读一次并刷新，
  // 避免 parent 因每秒计时器整棵重渲染。
  const lastPosAtRef = useRef<number | null>(null)

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
    // 关掉地表大气散射：默认开启时远看整球被照成亮蓝、拉近又回归深底色，
    // 球面颜色随视角漂移；控制塔风格要的是任何缩放级别下都是稳定的深蓝
    viewer.scene.globe.showGroundAtmosphere = false

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
      // 尾迹也归到运单：trail id 存的是 leg_id，要经映射换回 shipment_id
      const shipmentId = raw.startsWith(ID_TRAIL)
        ? legToShipmentRef.current.get(Number(raw.split(':')[1]))
        : Number(raw.split(':')[1])
      if (
        (raw.startsWith(ID_ROUTE) || raw.startsWith(ID_POS) || raw.startsWith(ID_TRAIL)) &&
        shipmentId != null
      ) {
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

    // 位置流只给 leg_id，先把映射建好（覆盖全部运单，切换筛选不用重建）。
    // 尾迹数据本身留在 ref 里：重拉 overview 不该清空已经走过的轨迹。
    const legToShipment = new Map<number, number>()
    for (const route of data.routes) {
      for (const leg of route.legs) legToShipment.set(leg.leg_id, route.shipment_id)
    }
    legToShipmentRef.current = legToShipment

    // 航线：每段按「已走过 / 未经过 / 已完成」分样式，和运单详情保持一致：
    // - 已送达/已完成段：全实线
    // - 活动中段：已走过（实际轨迹）实线，未经过虚线
    // - 计划中/跳过段：全虚线
    for (const route of routes) {
      const color = Cesium.Color.fromCssColorString(ROUTE_COLOR[route.status] ?? '#6e7681')
      const isDelivered = route.status === 'delivered'

      for (const leg of route.legs) {
        const oLat = leg.origin_lat
        const oLng = leg.origin_lng
        const dLat = leg.dest_lat
        const dLng = leg.dest_lng
        if (oLat == null || oLng == null || dLat == null || dLng == null) continue

        const origin = Cesium.Cartesian3.fromDegrees(oLng, oLat, ROUTE_HEIGHT)
        const dest = Cesium.Cartesian3.fromDegrees(dLng, dLat, ROUTE_HEIGHT)
        // 记住每段原点：实时位置流只给当前点，尾迹需要从原点开始画。
        // 尾迹用 TRAIL_HEIGHT，比计划航线高一点，避免 z-fight 被虚线盖住。
        legOriginRef.current.set(leg.leg_id, Cesium.Cartesian3.fromDegrees(oLng, oLat, TRAIL_HEIGHT))

        const isCompletedLeg = leg.status === 'completed'
        const isActiveLeg = leg.status === 'active'

        if (isDelivered || isCompletedLeg) {
          // 已送达/已完成：全实线
          ds.entities.add({
            id: `${ID_ROUTE}${route.shipment_id}:${leg.seq}`,
            polyline: {
              positions: [origin, dest],
              width: 2,
              material: color.withAlpha(0.95),
            },
          })
        } else if (isActiveLeg) {
          // 活动中：未经过部分从当前位置画虚线到终点
          const track = leg.track
          const current =
            track.length > 0
              ? track[track.length - 1]
              : [route.latest_lng, route.latest_lat]
          const [curLng, curLat] = current
          if (curLng != null && curLat != null) {
            const currentPos = Cesium.Cartesian3.fromDegrees(curLng, curLat, ROUTE_HEIGHT)
            ds.entities.add({
              id: `${ID_ROUTE}${route.shipment_id}:${leg.seq}`,
              polyline: {
                positions: [currentPos, dest],
                width: 2,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: color.withAlpha(0.65),
                  dashLength: 16,
                }),
              },
            })
          }
        } else {
          // 计划中 / 跳过：全虚线
          ds.entities.add({
            id: `${ID_ROUTE}${route.shipment_id}:${leg.seq}`,
            polyline: {
              positions: [origin, dest],
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color: color.withAlpha(0.65),
                dashLength: 16,
              }),
            },
          })
        }
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
        // 尾迹：后端带的活动段历史轨迹点垫底，打开就有看得见的「实际轨迹」。
        // 只从连上那刻开始累积的话，船每秒才走十几米，几分钟内画不出可见长度
        for (const leg of route.legs) {
          if (!trailsRef.current.has(leg.leg_id) && leg.track.length > 0) {
            // 后端为了性能只返回最近 360 个点，这里把原点补到头部，
            // 让「已走过」的实线从起点开始，而不是从中间某处冒出来。
            const originPt = legOriginRef.current.get(leg.leg_id)
            const trackPts = leg.track.map(([lng, lat]) =>
              Cesium.Cartesian3.fromDegrees(lng, lat, TRAIL_HEIGHT),
            )
            trailsRef.current.set(leg.leg_id, originPt ? [originPt, ...trackPts] : trackPts)
          }
          const existing = trailsRef.current.get(leg.leg_id)
          if (existing != null) upsertTrail(ds, leg.leg_id, existing)
        }
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

  /**
   * 实时轨迹层：订阅位置流 → 累积尾迹 + 移动船位点。
   * 全程只操作 Cesium 实体、不进 React 状态：位置消息每秒数十条，
   * 走 state 会让整棵组件树按消息频率重渲染，地球必然卡死。
   */
  useEffect(() => {
    // 一帧内到达的多条消息合并成一次几何重建：逐条改实体会在高频推送下反复重建线几何
    const dirtyLegs = new Set<number>()
    let raf = 0

    const flush = () => {
      raf = 0
      const ds = routeDsRef.current
      if (ds == null) return
      for (const legId of dirtyLegs) {
        const pts = trailsRef.current.get(legId)
        if (pts != null) upsertTrail(ds, legId, pts)
      }
      dirtyLegs.clear()
    }

    const stop = connectPositions((msg) => {
      const shipmentId = legToShipmentRef.current.get(msg.leg_id)
      if (shipmentId == null) return
      const point = Cesium.Cartesian3.fromDegrees(msg.lng, msg.lat, TRAIL_HEIGHT)

      let pts = trailsRef.current.get(msg.leg_id)
      if (pts == null) {
        // 位置流里没有历史点，但尾迹必须从原点开始，否则「已走过」的实线会从中间断开
        const originPt = legOriginRef.current.get(msg.leg_id)
        pts = originPt ? [originPt] : []
        trailsRef.current.set(msg.leg_id, pts)
      }
      const last = pts[pts.length - 1]
      // 与上一个点几乎重合就丢掉：过滤高频上报的零位移抖动，否则尾迹点数暴涨
      if (last != null && Cesium.Cartesian3.distance(last, point) < MIN_TRAIL_STEP) return
      pts.push(point)
      if (pts.length > TRAIL_MAX_POINTS) pts.shift()

      const ds = routeDsRef.current
      if (ds != null) {
        const ship = ds.entities.getById(`${ID_POS}${shipmentId}`)
        if (ship != null) ship.position = new Cesium.ConstantPositionProperty(point)
      }

      // 只更新 ref：心跳组件内部有 1s 定时器，会自己读到最新时间
      lastPosAtRef.current = Date.now()
      dirtyLegs.add(msg.leg_id)
      if (raf === 0) raf = requestAnimationFrame(flush)
    })

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      stop()
    }
  }, [])

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
        <Heartbeat lastPosAtRef={lastPosAtRef} />
      </div>
      {/* 图例：与运单详情保持一致——已走过/已送达实线，未经过虚线 */}
      <div
        style={{
          position: 'absolute',
          top: 58,
          left: 16,
          display: 'flex',
          gap: 14,
          fontSize: 11,
          color: '#9fb4cc',
        }}
      >
        <span>
          <LegendLine color="#8aa4c0" dashed />
          未经过
        </span>
        <span>
          <LegendLine color={ACTUAL_COLOR} />
          已走过 / 已送达
        </span>
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

/** 图例里的小线段示意：虚线对应计划航段、实线对应实际轨迹。 */
function LegendLine({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 18,
        height: 0,
        marginRight: 5,
        verticalAlign: 'middle',
        borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
      }}
    />
  )
}

/**
 * 位置流心跳：绿点 = 正在实时推送（5s 内有消息）；黄点 + 时长 = 推送疑似中断；
 * 灰色 = 一次都没收到（链路没通）。配合图例回答「这屏数据是不是活的」。
 */
function Heartbeat({ lastPosAtRef }: { lastPosAtRef: MutableRefObject<number | null> }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const last = lastPosAtRef.current
  const ageSec = last == null ? null : Math.floor((Date.now() - last) / 1000)
  const live = ageSec != null && ageSec <= 5
  const color = ageSec == null ? '#8aa4c0' : live ? '#2ea043' : '#f0a020'
  const text = ageSec == null ? '等待位置推送' : live ? '实时' : `${ageSec}s 未更新`
  return (
    <span style={{ alignSelf: 'center', fontSize: 12, color }}>
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          marginRight: 5,
          verticalAlign: 'middle',
        }}
      />
      {text}
    </span>
  )
}
