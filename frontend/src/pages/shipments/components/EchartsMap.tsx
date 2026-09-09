// 方案 A：ECharts 地理散点图。registerMap 注册矢量世界地图后，用 geo + lines(轨迹) + scatter(点) 渲染。
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import { Spin } from 'antd'
import { useWorldGeo } from '@/pages/shipments/components/worldGeo'
import type { PositionPointOut } from '@/types/shipments'

export default function EchartsMap({ points }: { points: PositionPointOut[] }) {
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

  // 轨迹点或底图变化：只更新 series，不重建图表
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const coords = points.map((p) => [p.lng, p.lat])
    chart.setOption({
      series: [
        {
          type: 'lines',
          coordinateSystem: 'geo',
          polyline: true,
          data: [{ coords }],
          lineStyle: { color: '#ffd666', width: 2 },
          effect: { show: true, trailLength: 1, symbol: 'arrow', color: '#fff', size: 4 },
        },
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
                data: [coords[0], coords[coords.length - 1]],
                symbolSize: 12,
                itemStyle: { color: '#52c41a' },
                label: { show: true, formatter: '起·终', position: 'right' as const },
              },
            ]
          : []),
      ],
    } as any)
  }, [points, geo])

  if (loading || !geo) return <Spin tip="加载世界地图…" />
  return <div ref={ref} style={{ width: '100%', height: 480 }} />
}
