// 方案 A：ECharts 地理散点图。registerMap 注册世界地图，geo + lines(轨迹) + scatter(点)。
// 视野按轨迹范围自适应（center/zoom），免去手动 roam 才能看清短途运单。
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import { Spin } from 'antd'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import type { PositionPointOut } from '@/types/shipments'

export default function EchartsMap({
  points,
  originCode,
  destCode,
}: {
  points: PositionPointOut[]
  originCode?: string | null
  destCode?: string | null
}) {
  const { geo, loading } = useWorldGeo()
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

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
    // 空轨迹（或坐标缺失）直接跳过：lines/polyline 收到空 coords 时，echarts
    // 内部会越界读取而抛出未捕获异常，拖垮整个详情页。Canvas/高德方案已各自判空。
    if (!chart || points.length === 0) return
    const coords = points.map((p) => [p.lng, p.lat])
    // 按轨迹经纬度范围算 geo center/zoom：实时推进时点范围几乎不变，所以
    // zoom/center 不会跳；切到不同区域时重新 fit。
    let mnLng = Infinity
    let mxLng = -Infinity
    let mnLat = Infinity
    let mxLat = -Infinity
    for (const p of points) {
      if (p.lng < mnLng) mnLng = p.lng
      if (p.lng > mxLng) mxLng = p.lng
      if (p.lat < mnLat) mnLat = p.lat
      if (p.lat > mxLat) mxLat = p.lat
    }
    const spanLng = Math.max(mxLng - mnLng, 0.05)
    const geoCenter: [number, number] = [(mnLng + mxLng) / 2, (mnLat + mxLat) / 2]
    const geoZoom = Math.max(2, Math.min(14, Math.log2(360 / spanLng) * 1.1))
    chart.setOption({
      backgroundColor: '#0b1f33',
      geo: {
        map: 'world',
        center: geoCenter,
        zoom: geoZoom,
        roam: true,
        itemStyle: { areaColor: '#1b3a5b', borderColor: '#2f5d8a' },
        emphasis: { disabled: true },
        silent: true,
      },
      series: [
        // 单点轨迹（如刚出发、段程长导致进度极小）没有线段可画，lines 系列收到
        // 单点 coords 会让 echarts 内部越界（读 coords[1]），拖垮整个详情页；
        // 单点时只画散点，由下方 scatter/effectScatter 呈现当前位置。
        ...(coords.length >= 2
          ? [
              {
                type: 'lines',
                coordinateSystem: 'geo',
                polyline: true,
                data: [{ coords }],
                lineStyle: { color: '#ffd666', width: 3 },
                effect: { show: true, trailLength: 1, symbol: 'arrow', color: '#fff', size: 4 },
              },
            ]
          : []),
        {
          type: 'scatter',
          coordinateSystem: 'geo',
          data: coords,
          symbolSize: 4,
          itemStyle: { color: '#ff4d4f' },
        },
        ...(coords.length
          ? [
              {
                type: 'effectScatter' as const,
                coordinateSystem: 'geo' as const,
                data: [coords[0]],
                symbolSize: 14,
                itemStyle: { color: '#52c41a' },
                label: {
                  show: true,
                  formatter: originCode ? `起 ${originCode}` : '起',
                  position: 'right' as const,
                  color: '#52c41a',
                },
                zlevel: 2,
              },
              {
                type: 'effectScatter' as const,
                coordinateSystem: 'geo' as const,
                data: [coords[coords.length - 1]],
                symbolSize: 14,
                itemStyle: { color: '#ff4d4f' },
                label: {
                  show: true,
                  formatter: destCode ? `终 ${destCode}` : '终',
                  position: 'right' as const,
                  color: '#ff4d4f',
                },
                zlevel: 2,
              },
            ]
          : []),
      ],
    } as any)
  }, [points, geo, originCode, destCode])

  if (loading || !geo) return <Spin tip="加载世界地图…" />
  return <div ref={ref} style={{ width: '100%', height: 480 }} />
}