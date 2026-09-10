import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'

/** 初始视角：东经 105 / 北纬 20 上空 2400 万米，一屏俯瞰全球主要航线。 */
const HOME_LNG = 105
const HOME_LAT = 20
const HOME_HEIGHT = 24_000_000

/** 大屏配色：球底与页面背景同色，陆地略亮一档，靠同色系深浅分层形成轮廓。 */
const GLOBE_COLOR = '#0b1f33'
const LAND_FILL = '#1a3a5f'

type Ring = number[][]
type Rings = Ring[]

/** GeoJSON 的 [lng, lat] 环 → Cesium 笛卡尔序列。 */
function ringToPositions(ring: Ring): Cesium.Cartesian3[] {
  // GeoJSON 用「首尾点是同一个点」表示环闭合；Cesium 的层级里这算重复顶点，
  // 会让几何构建直接崩（DeveloperError: All attribute lists must have the same
  // number of attributes），必须去掉尾点再喂。
  const closed =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  const pts = closed ? ring.slice(0, -1) : ring
  return Cesium.Cartesian3.fromDegreesArray(pts.flat())
}

export default function CesiumMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  // 与运单详情两个地图共用同一份世界矢量数据（world-atlas TopoJSON 转的 GeoJSON）
  const { geo } = useWorldGeo()

  useEffect(() => {
    const container = containerRef.current
    if (container == null) return

    const viewer = new Cesium.Viewer(container, {
      // 不加载影像瓦片：境外瓦片源在目标网络下均不可用（官方影像要 token、
      // Carto 要 key、Esri 连接超时）。地表改为暗底球色 + 世界矢量国界，
      // 零外部依赖、离线可用。后续要影像细节时配好 token 换回影像图层即可。
      baseLayer: false,
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
    // 隐藏左下角 Cesium ion 标识：本方案不使用任何官方影像服务，无需其署名
    viewer.cesiumWidget.creditContainer.style.display = 'none'
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
                rings.slice(1).map((r) => new Cesium.PolygonHierarchy(ringToPositions(r)))
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

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_LNG, HOME_LAT, HOME_HEIGHT),
    })

    return () => {
      // 必须销毁：StrictMode 下 effect 会挂载两次，不销毁会残留 WebGL 上下文，
      // 浏览器上下文数量有上限，反复切换页面后会白屏。
      viewer.destroy()
    }
  }, [geo])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
