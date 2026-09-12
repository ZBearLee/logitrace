import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import { connectPositions } from '@/api/ws'
import { statusLabel } from '@/constants/shipments'
import type { MapOverview } from '@/types/shipments'
import { linkage, type LinkageRequest } from '@/store/linkage'

/** 初始视角：东经 105 / 北纬 20 上空 2400 万米，一屏俯瞰全球主要航线。 */
const HOME_LNG = 105
const HOME_LAT = 20
const HOME_HEIGHT = 24_000_000

/** 大屏配色：球底与页面背景同色，陆地略亮一档，靠同色系深浅分层形成轮廓。 */
const GLOBE_COLOR = '#0b1f33'
const LAND_FILL = '#1a3a5f'
const PORT_COLOR = '#8ab4dd'
/** 仓库地点色：与 Three.js 场景的作业色同系，暗示「这里能进 3D 场景」 */
const WAREHOUSE_COLOR = '#3fd0c9'

/**
 * 数据层悬浮高度：航线/船位只需抬离地表一点点。
 * 抬空的目的是避开与陆地多边形同深度的 z-fight（零高度时穿过陆地的线会被陆地遮掉，
 * 看着像「线被海洋切断」）；但抬得越高，斜视角下与地表的视差越大——转动/缩放时线会
 * 明显「飘」离港口。取 2km 既分层又几乎不产生可见视差。
 */
const ROUTE_HEIGHT = 2_000
const PORT_HEIGHT = 500
// 实际轨迹只比计划线高 20m：够避免同高 z-fight 让实线压在虚线之上，
// 又不会因高度差在斜视角下与虚线错开一截（高 1km 时会明显错位）。
const TRAIL_HEIGHT = ROUTE_HEIGHT + 20

/** 运单状态 → 航线与当前位置点的颜色。 */
const ROUTE_COLOR: Record<string, string> = {
  planned: '#6e7681',
  in_transit: '#2f81f7',
  delivered: '#2ea043',
  delayed: '#f0a020',
}

/** 状态筛选按钮的顺序：控制塔最关心的排前面。 */
const STATUS_ORDER: string[] = ['in_transit', 'delayed', 'delivered', 'planned']

/** 实体 id 前缀：点击拾取时按前缀区分航线/尾迹/当前位置/港口。 */
const ID_ROUTE = 'route:'
const ID_TRAIL = 'trail:'
const ID_POS = 'pos:'
const ID_PORT = 'port:'

/**
 * 大屏统一规则里的「实际轨迹」色（亮青）：已走过 / 已送达画青色实线，计划 / 未走画虚线。
 * 详情页按段用 TRACK_COLORS 多色区分单票的多段；大屏一屏几十票，用单一青色表达
 * 「实际轨迹」才不花——两者语义一致、配色不同。
 * 实际轨迹从段原点开始，避免后端只返回最近点时看起来从中间冒出来。
 */
const ACTUAL_COLOR = '#3fd0c9'

/** 单条尾迹保留的点数上限：超出只裁中间点、保留段原点，避免数组无限增长。 */
const TRAIL_MAX_POINTS = 240

/** 与上一点距离小于该值（米）的位置点丢弃：模拟器高频上报，过滤零位移抖动。 */
const MIN_TRAIL_STEP = 10

/**
 * 回放倍速档位：multiplier = 1 个真实秒推进多少回放秒。
 * 历史窗口约 6 小时，60× 约 6 分钟播完、1800× 约 12 秒，覆盖「细看」到「快览」。
 */
const REPLAY_SPEEDS = [
  { label: '1×', value: 1 },
  { label: '60×', value: 60 },
  { label: '300×', value: 300 },
  { label: '1800×', value: 1800 },
] as const

type Ring = number[][]
type Rings = Ring[]

/** 点击后弹出的信息卡内容。 */
interface InfoCard {
  kind: 'route' | 'port'
  title: string
  lines: string[]
  shipmentId?: number
  /** 地点 id 与类型：仓库（warehouse）可点击进入 3D 仓库场景 */
  portId?: number
  portType?: string
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
  // 状态筛选：独立多选，默认只盯在途（控制塔最关心的实时位置）
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set(['in_transit']))
  // 聚焦运单：选中后地图只画这一票并飞镜头过去。
  // 多票跑在同一条航线上时线会完全重叠，聚焦是唯一能把它们分开看的手段。
  const [focusId, setFocusId] = useState<number | null>(null)
  const [shipQuery, setShipQuery] = useState('')
  // 跨页联动高亮：网络页框选/点选的口岸 code 集合，命中则在地球上用金色大点强调。
  const [highlightCodes, setHighlightCodes] = useState<Set<string>>(() => new Set())
  // 最近一次联动请求：viewer 可能晚于请求到达，先存这里，等 viewer 建好再飞行。
  const pendingLinkRef = useRef<LinkageRequest | null>(null)

  // 实时 / 历史回放两种模式：回放由 Cesium Clock 驱动，实时走 WS 增量。
  const [mode, setMode] = useState<'live' | 'replay'>('live')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(60)
  // WS 回调（命令式代码，脱离 React 渲染）要读最新模式，用 ref 桥接
  const modeRef = useRef<'live' | 'replay'>('live')
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  /**
   * 联动飞行：把镜头飞到网络页指定的口岸（单点）或框选口岸的包围盒（多点）。
   * 失败兜底：viewer 未就绪时直接返回，调用方会在 viewer 建好后重放 pendingLinkRef。
   */
  const flyTo = (r: LinkageRequest) => {
    const viewer = viewerRef.current
    if (viewer == null) return
    if (r.kind === 'flyToPort') {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(r.point.lng, r.point.lat, 900_000),
        duration: 1.2,
      })
    } else {
      const pts = r.points.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat))
      if (pts.length === 0) return
      const sphere = Cesium.BoundingSphere.fromPoints(pts)
      // 视高按包围球半径放大，但设上限：框选到地理上很远的口岸（如东亚+欧洲）时，
      // 不设上限会一路退到全球视角，金色高亮点小到看不见，联动就失去了意义。
      const range = Math.min(Math.max(sphere.radius * 4, 200_000), 12_000_000)
      viewer.camera.flyToBoundingSphere(sphere, {
        offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, range),
        duration: 1.2,
      })
    }
  }

  // 跨页联动：网络页发出的「飞行定位/高亮」请求在此消费。模块级单例在切页后存活，
  // 大屏挂载时取一次即可；若请求先于 viewer 就绪到达，先存 pendingLinkRef，等 viewer 建好再飞。
  useEffect(() => {
    const take = () => {
      const r = linkage.consume()
      if (r == null) return
      pendingLinkRef.current = r
      setHighlightCodes(new Set(r.kind === 'flyToPort' ? [r.code] : r.codes))
      flyTo(r)
    }
    take()
    return linkage.subscribe(take)
  }, [])

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
        if (port) {
          setCard({
            kind: 'port',
            title: port.code,
            // 仓库标注额外提示可进 3D 场景，避免用户不知道这里能点进去
            lines: port.type === 'warehouse' ? [port.name, '仓库（可进入 3D 场景）'] : [port.name],
            portId: port.id,
            portType: port.type,
          })
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_LNG, HOME_LAT, HOME_HEIGHT),
    })

    // 跨页联动：网络页的飞行请求可能在 viewer 就绪前就到达，放在 setView 之后补放。
    // 顺序很关键——setView 是瞬移，写在它之前会被初始视角立刻覆盖、飞行动画被打断。
    if (pendingLinkRef.current) flyTo(pendingLinkRef.current)

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
    // 聚焦优先：选中某票时只画它（多票同路会完全重叠）；否则按勾选的状态过滤。
    const routes =
      focusId != null
        ? data.routes.filter((r) => r.shipment_id === focusId)
        : data.routes.filter((r) => statusFilter.has(r.status))

    // 位置流只给 leg_id，先把映射建好。只登记「当前可见」的段：
    // 被筛掉的段不再收位置增量，否则实时回调会把已隐藏的尾迹又画回来。
    // 尾迹数据本身留在 ref 里：重拉 overview 或切筛选都不清空已走过的轨迹。
    const legToShipment = new Map<number, number>()
    for (const route of routes) {
      for (const leg of route.legs) legToShipment.set(leg.leg_id, route.shipment_id)
    }
    legToShipmentRef.current = legToShipment

    // 航线：一条清晰规则——**虚线 = 计划航段（未走），青色实线 = 实际轨迹（已走过）**。
    // - 已完成 / 已送达段：整段都走过 → 青色实线
    // - 活动 / 计划 / 跳过段：整段计划虚线（状态色）做底；活动段的已走部分由青色尾迹
    //   压在虚线之上，形成「一条线、走过 vs 未走分色」。
    // 整段虚线做底（而非只画剩余段），保证没有轨迹数据时也有线、不断线，
    // 且虚线起点始终是段原点，不随实时位置漂移（回放时也不再锚死在实时 latest）。
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
        legOriginRef.current.set(
          leg.leg_id,
          Cesium.Cartesian3.fromDegrees(oLng, oLat, TRAIL_HEIGHT),
        )

        if (isDelivered || leg.status === 'completed') {
          // 已完成/已送达：整段都是实际轨迹 → 青色实线（与图例一致）
          ds.entities.add({
            id: `${ID_ROUTE}${route.shipment_id}:${leg.seq}`,
            polyline: {
              positions: [origin, dest],
              width: 2,
              material: Cesium.Color.fromCssColorString(ACTUAL_COLOR).withAlpha(0.95),
            },
          })
        } else {
          // 未完成（活动/计划/跳过）：整段计划虚线做底，状态色区分运单；
          // 活动段的已走部分由青色尾迹压在虚线之上
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

      if (mode === 'replay') {
        // 历史回放：船位由 SampledPositionProperty 随时间插值，尾迹按当前时刻切片。
        // track 已按时间升序（后端按 rn desc 取，即旧→新）。
        for (const leg of route.legs) {
          if (leg.track.length === 0) continue
          const samples = leg.track.map(
            ([lng, lat, ts]) =>
              [ts, Cesium.Cartesian3.fromDegrees(lng, lat, TRAIL_HEIGHT)] as const,
          )
          const prop = new Cesium.SampledPositionProperty()
          for (const [ts, pos] of samples) {
            prop.addSample(Cesium.JulianDate.fromDate(new Date(ts)), pos)
          }
          prop.setInterpolationOptions({
            interpolationDegree: 1,
            interpolationAlgorithm: Cesium.LinearApproximation,
          })
          // 端点外保持不动：多段运单各段样本区间不同，避免时钟越过区间时船位点闪没
          prop.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD
          prop.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD
          ds.entities.add({
            id: `${ID_POS}${route.shipment_id}`,
            position: prop,
            point: {
              pixelSize: 6,
              color,
              outlineWidth: 1,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
            },
          })
          // 已走过（实线）：从段原点起笔，只画 ts <= 当前回放时刻的点，
          // 随时间生长；计划虚线在底层不动，两者衔接自然。
          // 回调每帧重算，但只做切片（笛卡尔已预计算），成本与点数成正比、与帧数无关。
          if (samples.length >= 2) {
            const originPt = legOriginRef.current.get(leg.leg_id)
            ds.entities.add({
              id: `${ID_TRAIL}${leg.leg_id}`,
              polyline: {
                positions: new Cesium.CallbackProperty(() => {
                  const out: Cesium.Cartesian3[] = []
                  // 段原点始终在首位：后端只给最近点，缺了它实线会从中间冒出来
                  if (originPt != null) out.push(originPt)
                  const viewer = viewerRef.current
                  if (viewer == null) {
                    out.push(...samples.map(([, p]) => p))
                    return out
                  }
                  const now = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime()
                  for (const [ts, p] of samples) {
                    if (ts <= now) out.push(p)
                    else break
                  }
                  return out.length >= 2 ? out : []
                }, false),
                width: 3,
                material: Cesium.Color.fromCssColorString(ACTUAL_COLOR).withAlpha(0.95),
              },
            })
          }
        }
      } else if (
        // 实时模式：船位亮点只给在途/延误画：已送达运单的 latest 停在终点，
        // 画出来会被误认成船位
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

    // 地点标注：小点 + code 文字；被网络页联动选中的口岸用金色大点强调
    for (const port of data.ports) {
      const hot = highlightCodes.has(port.code)
      // 仓库用青色区别于普通港口：它是「可进入 3D 场景」的入口，视觉上要能认出来
      const base = port.type === 'warehouse' ? WAREHOUSE_COLOR : PORT_COLOR
      ds.entities.add({
        id: `${ID_PORT}${port.code}`,
        position: Cesium.Cartesian3.fromDegrees(port.lng, port.lat, PORT_HEIGHT),
        point: {
          pixelSize: hot ? 8 : port.type === 'warehouse' ? 6 : 4,
          color: hot
            ? Cesium.Color.fromCssColorString('#ffd666')
            : Cesium.Color.fromCssColorString(base),
          outlineWidth: hot ? 2 : 0,
          outlineColor: hot ? Cesium.Color.fromCssColorString('#fff3c4') : undefined,
        },
        label: {
          text: port.code,
          font: '11px sans-serif',
          fillColor: Cesium.Color.fromCssColorString(hot ? '#ffe7a0' : '#c9d7e8'),
          pixelOffset: new Cesium.Cartesian2(0, -10),
          // 文字只在拉近后显示：全球视角下几十个 code 全渲染会挤成一团
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12_000_000),
        },
      })
    }

    // 回放模式下配置 Clock：时间窗取自所有样本的 [最早, 最晚]。
    // 只在这里设范围与当前时刻，multiplier/shouldAnimate 交给下面的专用 effect，
    // 避免「暂停/调倍速」触发本 effect 重建全部实体。
    if (mode === 'replay') {
      let tMin = Number.POSITIVE_INFINITY
      let tMax = Number.NEGATIVE_INFINITY
      for (const route of routes) {
        for (const leg of route.legs) {
          for (const [, , ts] of leg.track) {
            if (ts < tMin) tMin = ts
            if (ts > tMax) tMax = ts
          }
        }
      }
      const viewer = viewerRef.current
      if (viewer != null && Number.isFinite(tMin) && tMax > tMin) {
        const start = Cesium.JulianDate.fromDate(new Date(tMin))
        const stop = Cesium.JulianDate.fromDate(new Date(tMax))
        const clock = viewer.clock
        clock.startTime = start.clone()
        clock.stopTime = stop.clone()
        clock.clockRange = Cesium.ClockRange.LOOP_STOP
        // 当前时刻越界（首次进入回放时通常已是实时「现在」）才回到起点；
        // 数据刷新时若仍在窗内则保持，不打断正在进行的回放
        if (
          Cesium.JulianDate.lessThan(clock.currentTime, start) ||
          Cesium.JulianDate.greaterThan(clock.currentTime, stop)
        ) {
          clock.currentTime = start.clone()
        }
      }
    }
  }, [data, statusFilter, focusId, mode, highlightCodes])

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
      // 回放模式下画面由 Clock 驱动，忽略实时增量，避免两套逻辑互相打架
      if (modeRef.current !== 'live') return
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
      // 超出上限只裁中间点、保留 pts[0] 的段原点：起点一旦被裁掉，
      // 「已走过」实线就会缩成悬在计划虚线中间的一段（两头只剩虚线）。
      while (pts.length > TRAIL_MAX_POINTS) pts.splice(1, 1)

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

  /**
   * 回放时钟：只管「走不走」和「走多快」，不重建实体。
   * 与数据 effect 分离，使暂停/调倍速只改 Clock 两个字段，零几何开销。
   */
  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer == null) return
    if (mode !== 'replay') {
      // 离开回放：停表，避免时钟继续空转
      viewer.clock.shouldAnimate = false
      return
    }
    viewer.clock.multiplier = speed
    viewer.clock.shouldAnimate = playing
  }, [mode, playing, speed])

  /** 回到初始全球视角：拖动/缩放迷失方向后一键复位。 */
  const resetView = () => {
    // 复位同时清掉网络页联动留下的口岸高亮，避免残留金色大点误导
    setHighlightCodes(new Set())
    pendingLinkRef.current = null
    viewerRef.current?.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_LNG, HOME_LAT, HOME_HEIGHT),
    })
  }

  /** 放大 / 缩小：按当前视高比例推进，给滚轮之外一个可控入口。 */
  const zoomBy = (factor: number) => {
    const viewer = viewerRef.current
    if (viewer == null) return
    viewer.camera.zoomIn(viewer.camera.positionCartographic.height * factor)
  }

  /**
   * 聚焦某票：只画这一票，并把镜头飞到它所有段（含轨迹点）的包围球。
   * 多票跑在同一条航线上时线会完全重叠，聚焦是唯一能把它们分开看的手段。
   */
  const focusShipment = (shipmentId: number) => {
    setFocusId(shipmentId)
    setShipQuery('')
    const viewer = viewerRef.current
    const snapshot = dataRef.current
    if (viewer == null || snapshot == null) return
    const route = snapshot.routes.find((r) => r.shipment_id === shipmentId)
    if (route == null) return
    const pts: Cesium.Cartesian3[] = []
    for (const leg of route.legs) {
      if (leg.origin_lat != null && leg.origin_lng != null) {
        pts.push(Cesium.Cartesian3.fromDegrees(leg.origin_lng, leg.origin_lat))
      }
      if (leg.dest_lat != null && leg.dest_lng != null) {
        pts.push(Cesium.Cartesian3.fromDegrees(leg.dest_lng, leg.dest_lat))
      }
      for (const [lng, lat] of leg.track) pts.push(Cesium.Cartesian3.fromDegrees(lng, lat))
    }
    if (pts.length === 0) return
    const sphere = Cesium.BoundingSphere.fromPoints(pts)
    viewer.camera.flyToBoundingSphere(sphere, {
      // 俯视 + 留 5 倍半径余量，保证整条线（含两端）都在视野内
      offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, Math.max(sphere.radius * 5, 100_000)),
      duration: 1.2,
    })
  }

  // 搜索下拉的匹配项：按运单号模糊匹配，最多 20 条；已聚焦时不显示
  const matches =
    data == null || focusId != null || shipQuery.trim() === ''
      ? []
      : data.routes
          .filter((r) => r.shipment_no.toLowerCase().includes(shipQuery.trim().toLowerCase()))
          .slice(0, 20)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8 }}>
        {/* 状态筛选：独立多选，可任意组合（默认在途），不再用「全部运单」这种粗档 */}
        {STATUS_ORDER.map((s) => {
          const on = statusFilter.has(s)
          return (
            <button
              key={s}
              onClick={() =>
                setStatusFilter((prev) => {
                  const next = new Set(prev)
                  if (next.has(s)) next.delete(s)
                  else next.add(s)
                  return next
                })
              }
              style={{
                cursor: 'pointer',
                background: on ? `${ROUTE_COLOR[s]}33` : 'rgba(13,30,51,0.85)',
                border: `1px solid ${on ? ROUTE_COLOR[s] : '#274a6e'}`,
                borderRadius: 6,
                padding: '6px 10px',
                color: on ? '#e6f0fb' : '#8aa4c0',
                fontSize: 12,
              }}
            >
              {statusLabel(s)}
            </button>
          )
        })}
        {/* 运单搜索：输单号选中即聚焦该票，地图只画它并飞过去，不用再去图上点 */}
        <div style={{ position: 'relative' }}>
          <input
            value={shipQuery}
            onChange={(e) => setShipQuery(e.target.value)}
            placeholder="搜索运单号"
            style={{
              width: 180,
              background: 'rgba(13,30,51,0.85)',
              border: '1px solid #274a6e',
              borderRadius: 6,
              padding: '6px 10px',
              color: '#c9d7e8',
              fontSize: 12,
              outline: 'none',
            }}
          />
          {matches.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '110%',
                left: 0,
                width: 260,
                maxHeight: 240,
                overflowY: 'auto',
                background: 'rgba(13,30,51,0.96)',
                border: '1px solid #274a6e',
                borderRadius: 6,
                zIndex: 10,
              }}
            >
              {matches.map((r) => (
                <div
                  key={r.shipment_id}
                  onClick={() => focusShipment(r.shipment_id)}
                  style={{
                    cursor: 'pointer',
                    padding: '6px 10px',
                    fontSize: 12,
                    color: '#c9d7e8',
                    borderBottom: '1px solid rgba(39,74,110,0.4)',
                  }}
                >
                  {r.shipment_no} · {statusLabel(r.status)}
                </div>
              ))}
            </div>
          )}
        </div>
        {focusId != null && (
          <button
            onClick={() => {
              setFocusId(null)
              resetView()
            }}
            style={{
              cursor: 'pointer',
              background: '#1f4e8c',
              border: '1px solid #2f81f7',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#fff',
              fontSize: 12,
            }}
          >
            取消聚焦
          </button>
        )}
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
        {/* 缩放按钮：滚轮之外多一个可控入口（触控板 / 远程桌面下滚轮手感不稳） */}
        <button
          title="放大"
          style={{
            cursor: 'pointer',
            background: 'rgba(13,30,51,0.85)',
            border: '1px solid #274a6e',
            borderRadius: 6,
            padding: '6px 12px',
            color: '#c9d7e8',
            fontSize: 12,
          }}
          onClick={() => zoomBy(0.4)}
        >
          ＋
        </button>
        <button
          title="缩小"
          style={{
            cursor: 'pointer',
            background: 'rgba(13,30,51,0.85)',
            border: '1px solid #274a6e',
            borderRadius: 6,
            padding: '6px 12px',
            color: '#c9d7e8',
            fontSize: 12,
          }}
          onClick={() => zoomBy(-0.6)}
        >
          －
        </button>
        <button
          style={{
            cursor: 'pointer',
            background: mode === 'replay' ? '#1f4e8c' : 'rgba(13,30,51,0.85)',
            border: '1px solid #274a6e',
            borderRadius: 6,
            padding: '6px 12px',
            color: '#c9d7e8',
            fontSize: 12,
          }}
          onClick={() => setMode((m) => (m === 'live' ? 'replay' : 'live'))}
        >
          {mode === 'replay' ? '返回实时' : '历史回放'}
        </button>
        {mode === 'replay' && (
          <>
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
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? '暂停' : '播放'}
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              title="回放倍速"
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
              {REPLAY_SPEEDS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        )}
        {/* 实时看链路心跳，回放看当前回放时刻 */}
        {mode === 'live' ? (
          <Heartbeat lastPosAtRef={lastPosAtRef} />
        ) : (
          <ReplayTime viewerRef={viewerRef} />
        )}
      </div>
      {/* 图例：线型表达「计划 vs 实际」（虚线=计划未走 / 青色实线=实际已走），
          颜色表达运单状态；大屏一屏多票，两套语义分开才读得懂 */}
      <div
        style={{
          position: 'absolute',
          top: 58,
          left: 16,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 14,
          maxWidth: 560,
          fontSize: 11,
          color: '#9fb4cc',
        }}
      >
        <span>
          <LegendLine color="#8aa4c0" dashed />
          计划航段 · 未走过
        </span>
        <span>
          <LegendLine color={ACTUAL_COLOR} />
          实际轨迹 · 已走过
        </span>
        <span>
          <LegendDot color={ROUTE_COLOR.in_transit} />
          运输中
        </span>
        <span>
          <LegendDot color={ROUTE_COLOR.delayed} />
          延误
        </span>
        <span>
          <LegendDot color={ROUTE_COLOR.delivered} />
          已送达
        </span>
        <span>
          <LegendDot color={ROUTE_COLOR.planned} />
          已计划
        </span>
      </div>
      {/* 回放时间轴：底部横条，拖动即定位到该时刻 */}
      {mode === 'replay' && (
        <div
          style={{
            position: 'absolute',
            left: 24,
            right: 24,
            bottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <ReplayScrubber viewerRef={viewerRef} />
        </div>
      )}
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
          {/* 地球点仓库标注 → 进 Three.js 仓库场景 */}
          {card.portType === 'warehouse' && card.portId != null && (
            <button
              style={{
                marginTop: 10,
                width: '100%',
                cursor: 'pointer',
                background: '#0e5a57',
                border: '1px solid #3fd0c9',
                borderRadius: 4,
                padding: '6px 0',
                color: '#d7fffd',
                fontSize: 12,
              }}
              onClick={() => navigate(`/warehouse/${card.portId}`)}
            >
              进入仓库 3D 场景
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

/** 图例里的状态色圆点示意。 */
function LegendDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        marginRight: 5,
        verticalAlign: 'middle',
      }}
    />
  )
}

/**
 * 位置流心跳：绿点 = 正在实时推送（5s 内有消息）；黄点 + 时长 = 推送疑似中断；
 * 灰色 = 一次都没收到（链路没通）。配合图例回答「这屏数据是不是活的」。
 */
function Heartbeat({ lastPosAtRef }: { lastPosAtRef: MutableRefObject<number | null> }) {
  const [color, setColor] = useState('#8aa4c0')
  const [text, setText] = useState('等待位置推送')
  // 在 effect 内读 ref 与 Date.now 写入 state，避免渲染期访问 ref / 调非纯函数
  useEffect(() => {
    const tick = () => {
      const last = lastPosAtRef.current
      const ageSec = last == null ? null : Math.floor((Date.now() - last) / 1000)
      const live = ageSec != null && ageSec <= 5
      setColor(ageSec == null ? '#8aa4c0' : live ? '#2ea043' : '#f0a020')
      setText(ageSec == null ? '等待位置推送' : live ? '实时' : `${ageSec}s 未更新`)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [lastPosAtRef])
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

/** 回放当前时刻（UTC）：半秒自刷新；在 effect 内读时钟写入 state，避免渲染期访问 ref。 */
function ReplayTime({ viewerRef }: { viewerRef: MutableRefObject<Cesium.Viewer | null> }) {
  const [text, setText] = useState('—')
  useEffect(() => {
    const render = () => {
      const clock = viewerRef.current?.clock
      setText(
        clock
          ? `${Cesium.JulianDate.toIso8601(clock.currentTime).slice(0, 19).replace('T', ' ')}Z`
          : '—',
      )
    }
    render()
    const id = window.setInterval(render, 500)
    return () => window.clearInterval(id)
  }, [viewerRef])
  return <span style={{ alignSelf: 'center', fontSize: 12, color: '#9fb4cc' }}>{text}</span>
}

/** 从 Clock 读回放时间窗（epoch 毫秒）：范围无效时返回 null。 */
function clockWindowMs(viewerRef: MutableRefObject<Cesium.Viewer | null>) {
  const clock = viewerRef.current?.clock
  if (clock == null) return null
  const start = Cesium.JulianDate.toDate(clock.startTime).getTime()
  const stop = Cesium.JulianDate.toDate(clock.stopTime).getTime()
  return stop > start ? { start, stop } : null
}

/** 当前回放时刻在时间窗中的百分比（0-100）：无有效范围时返回 null。 */
function clockPct(viewerRef: MutableRefObject<Cesium.Viewer | null>) {
  const win = clockWindowMs(viewerRef)
  const clock = viewerRef.current?.clock
  if (win == null || clock == null) return null
  const now = Cesium.JulianDate.toDate(clock.currentTime).getTime()
  return Math.max(0, Math.min(100, ((now - win.start) / (win.stop - win.start)) * 100))
}

/** 按进度百分比定位回放时刻。写 Clock 收敛到模块函数，保持组件内为纯调用。 */
function seekClock(viewerRef: MutableRefObject<Cesium.Viewer | null>, pct: number) {
  const win = clockWindowMs(viewerRef)
  const clock = viewerRef.current?.clock
  if (win == null || clock == null) return
  clock.currentTime = Cesium.JulianDate.fromDate(
    new Date(win.start + ((win.stop - win.start) * pct) / 100),
  )
}

/**
 * 回放进度条：每 250ms 读一次 Clock 刷新进度；拖动时暂停跟随并写回 currentTime。
 * 用 ref 标记拖动中，避免「跟随」把用户刚拖到的位置又冲掉。
 */
function ReplayScrubber({ viewerRef }: { viewerRef: MutableRefObject<Cesium.Viewer | null> }) {
  const [pct, setPct] = useState(0)
  const draggingRef = useRef(false)

  useEffect(() => {
    const id = window.setInterval(() => {
      if (draggingRef.current) return
      const p = clockPct(viewerRef)
      if (p != null) setPct(p)
    }, 250)
    return () => window.clearInterval(id)
  }, [viewerRef])

  const seek = (v: number) => {
    setPct(v)
    seekClock(viewerRef, v)
  }

  return (
    <input
      type="range"
      min={0}
      max={100}
      step={0.1}
      value={pct}
      onChange={(e) => seek(Number(e.target.value))}
      onMouseDown={() => {
        draggingRef.current = true
      }}
      onMouseUp={() => {
        draggingRef.current = false
      }}
      onTouchStart={() => {
        draggingRef.current = true
      }}
      onTouchEnd={() => {
        draggingRef.current = false
      }}
      style={{ width: '100%', cursor: 'pointer', accentColor: '#2f81f7' }}
    />
  )
}
