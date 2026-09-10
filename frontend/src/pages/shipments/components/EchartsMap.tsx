// 方案 A：ECharts 地理散点图。registerMap 注册世界地图，geo + lines(轨迹) + scatter(点)。
// 视野按轨迹范围自适应（center/zoom），免去手动 roam 才能看清短途运单。
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import { Spin } from 'antd'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import type { LegOut, PositionPointOut } from '@/types/shipments'
import {
  buildPlanSegments,
  groupPointsByLeg,
  segmentByAntimeridian,
  computeBounds,
  TRACK_COLORS,
} from '@/utils/track'

export default function EchartsMap({
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
  const { geo, loading } = useWorldGeo()
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  // 是否已为当前数据集自适应过视野：实时点每秒推送会触发 points 引用变化，
  // 若每次都重设 geo.zoom/center，会把用户的滚轮缩放/拖拽状态重置掉。
  const fittedRef = useRef(false)

  // 只负责注册底图与初始化图表，不读轨迹点：避免点变化就重建图表
  useEffect(() => {
    if (!ref.current || !geo) return
    echarts.registerMap('world', geo)
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    chart.setOption({
      backgroundColor: '#0b1f33',
      geo: {
        map: 'world',
        // 让 geo 占满容器 95% 并居中，避免画布上下大片空白；zoom 仍按轨迹自适应。
        layoutCenter: ['50%', '50%'],
        layoutSize: '95%',
        roam: true,
        itemStyle: { areaColor: '#1b3a5b', borderColor: '#2f5d8a' },
        emphasis: { disabled: true },
        silent: true,
      },
    } as any)
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [geo])

  // 轨迹点或底图变化：只更新 series 与自适应视野，不重建图表
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || points.length === 0) return

    const series: any[] = []
    const liveScatterData: any[] = []

    // 轨迹点按 leg 分组（displayPositions 已按 leg.seq 排好顺序）；规划基线沿大圆
    // 航线插值，二者都跨 180° 经线拆段，避免跨太平洋航线被画成横贯地图的直线。
    const grouped = groupPointsByLeg(points)
    // 已完成段整条都是"已走过"，不再画规划虚线，只保留实线历史轨迹。
    const planSegments = buildPlanSegments(legs?.filter((l) => l.status !== 'completed'))

    // 按轨迹范围算 geo center/zoom：实时推进时点范围几乎不变，所以 zoom/center 不会跳；
    // 切到不同区域时重新 fit。
    const bounds = computeBounds(points.map((p) => [p.lng, p.lat] as [number, number]))
    let geoCenter: [number, number] = [0, 0]
    let geoZoom = 1
    if (bounds) {
      const spanLng = Math.max(bounds.maxLng - bounds.minLng, 0.05)
      geoCenter = [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2]
      geoZoom = Math.max(1, Math.min(14, Math.log2(360 / spanLng) * 1.1))
    }

    // 规划路径基线（淡色虚线）：未走部分呈淡色，已走部分由下方鲜艳色轨迹覆盖，
    // 形成"一条线、走过 vs 未走过分色"。
    if (planSegments.length) {
      series.push({
        type: 'lines',
        coordinateSystem: 'geo',
        polyline: true,
        data: planSegments.map((coords) => ({ coords })),
        lineStyle: { color: '#9aa4ad', width: 2, opacity: 0.6, type: 'dashed' },
        zlevel: 0,
      })
    }

    grouped.forEach((leg, idx) => {
      const color = TRACK_COLORS[idx % TRACK_COLORS.length]
      // 实时点由 stream 写入 liveByLeg，在 displayPositions 里被塞进对应 leg 末尾，id 为负。
      // 把实时点也纳入轨迹线：数据库落库点比 stream 推送的实时点滞后一段距离，
      // 原来把 live 排除在 lines 之外会让线停在实时点之前、看起来"断开"；
      // 纳入后线连续到当前位置，实时点用下方 effectScatter 闪烁区分即可。
      const hasLive = leg.length > 0 && leg[leg.length - 1].id < 0
      const segments = segmentByAntimeridian(leg.map((p) => [p.lng, p.lat] as [number, number]))

      if (segments.length) {
        series.push({
          type: 'lines',
          coordinateSystem: 'geo',
          polyline: true,
          data: segments.map((coords) => ({ coords })),
          lineStyle: { color, width: 3 },
          // 不在线段上挂 effect：每秒 setOption 重建 series 时，动画 trail 会
          // 残留叠加成扇形乱线。实时移动感交给下方的 effectScatter 闪烁即可。
          zlevel: 1,
        })
      }
      // 整段不足 2 点（仅单点）时画散点，避免轨迹完全不显示
      if (segments.length === 0 && leg.length >= 1) {
        series.push({
          type: 'scatter',
          coordinateSystem: 'geo',
          data: leg.map((p) => [p.lng, p.lat]),
          symbolSize: 5,
          itemStyle: { color },
        })
      }

      if (hasLive) {
        const live = leg[leg.length - 1]
        liveScatterData.push({
          name: '当前位置',
          value: [live.lng, live.lat],
          itemStyle: { color: '#52c41a' },
        })
      }
    })

    if (liveScatterData.length) {
      series.push({
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: liveScatterData,
        symbolSize: 16,
        rippleEffect: { brushType: 'stroke', scale: 3 },
        itemStyle: { color: '#52c41a', shadowBlur: 10, shadowColor: '#52c41a' },
        zlevel: 3,
      })
    }

    if (originLat != null && originLng != null) {
      series.push({
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: [[originLng, originLat]],
        symbolSize: 14,
        itemStyle: { color: '#52c41a' },
        label: {
          show: true,
          formatter: originCode ? `起 ${originCode}` : '起',
          position: 'right',
          color: '#52c41a',
        },
        zlevel: 2,
      })
    }

    if (destLat != null && destLng != null) {
      series.push({
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: [[destLng, destLat]],
        symbolSize: 14,
        itemStyle: { color: '#ff4d4f' },
        label: {
          show: true,
          formatter: destCode ? `终 ${destCode}` : '终',
          position: 'right',
          color: '#ff4d4f',
        },
        zlevel: 2,
      })
    }

    // notMerge=true：leg 数量会随数据变化，避免旧 series 残留。
    if (!fittedRef.current) {
      // 首次为当前 points 自适应视野（zoom/center），之后由用户自由 roam。
      chart.setOption(
        {
          backgroundColor: '#0b1f33',
          geo: {
            map: 'world',
            layoutCenter: ['50%', '50%'],
            layoutSize: '95%',
            center: geoCenter,
            zoom: geoZoom,
            roam: true,
            itemStyle: { areaColor: '#1b3a5b', borderColor: '#2f5d8a' },
            emphasis: { disabled: true },
            silent: true,
          },
          series,
        },
        true,
      )
      fittedRef.current = true
    } else {
      // 实时点推进时只更新 series，不动 geo；否则会把用户缩放/拖拽的视野重置。
      chart.setOption({ series }, { replaceMerge: ['series'] })
    }
  }, [points, geo, originCode, destCode, originLat, originLng, destLat, destLng, legs])

  if (loading || !geo) return <Spin tip="加载世界地图…" />
  return <div ref={ref} style={{ width: '100%', height: 480 }} />
}
