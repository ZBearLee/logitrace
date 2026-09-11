// 准点率趋势折线图：手写 D3。x 轴按计划到达日期，绿线为准点率、浅蓝面积为当日运量，
// 橙色虚线为 95% 目标线。点自带原生 tooltip 显示当日准点率与运量。纯 SVG，不引图表库。
import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { scaleLinear, scaleTime } from 'd3-scale'
import { extent, max } from 'd3-array'
import { axisBottom, axisLeft, axisRight } from 'd3-axis'
import { area, curveMonotoneX, line } from 'd3-shape'
import type { TrendPoint } from '@/types/analytics'

interface Props {
  trend: TrendPoint[]
  width?: number
  height?: number
}

const RATE_COLOR = '#2ea043'
const VOL_COLOR = '#91caff'
const TARGET = 0.95
const AXIS_COLOR = '#5b6b7d'

export default function TrendLine({ trend, width = 880, height = 300 }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = select(ref.current)
    svg.selectAll('*').remove()

    if (trend.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', AXIS_COLOR)
        .attr('font-size', 13)
        .text('暂无趋势数据')
      return
    }

    const margin = { top: 16, right: 48, bottom: 30, left: 44 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom
    const parse = (s: string) => new Date(s)

    const x = scaleTime()
      .domain((extent(trend, (d) => parse(d.date)) as [Date, Date]) ?? [new Date(), new Date()])
      .range([margin.left, margin.left + innerW])
    const yRate = scaleLinear()
      .domain([0, 1])
      .range([margin.top + innerH, margin.top])
    const yVol = scaleLinear()
      .domain([0, max(trend, (d) => d.total) ?? 1])
      .nice()
      .range([margin.top + innerH, margin.top])

    const g = svg.append('g')

    const areaGen = area<TrendPoint>()
      .x((d) => x(parse(d.date)))
      .y0(yVol(0))
      .y1((d) => yVol(d.total))
      .curve(curveMonotoneX)
    g.append('path').datum(trend).attr('fill', VOL_COLOR).attr('opacity', 0.35).attr('d', areaGen)

    const lineGen = line<TrendPoint>()
      .x((d) => x(parse(d.date)))
      .y((d) => yRate(d.on_time_rate))
      .curve(curveMonotoneX)
    g.append('path')
      .datum(trend)
      .attr('fill', 'none')
      .attr('stroke', RATE_COLOR)
      .attr('stroke-width', 2)
      .attr('d', lineGen)

    // 目标线：准点率应达到的基准，低于它就是恶化信号
    g.append('line')
      .attr('x1', margin.left)
      .attr('x2', margin.left + innerW)
      .attr('y1', yRate(TARGET))
      .attr('y2', yRate(TARGET))
      .attr('stroke', '#f0a020')
      .attr('stroke-dasharray', '4,4')
      .attr('stroke-width', 1)
    g.append('text')
      .attr('x', margin.left + innerW)
      .attr('y', yRate(TARGET) - 4)
      .attr('text-anchor', 'end')
      .attr('fill', '#f0a020')
      .attr('font-size', 10)
      .text('目标 95%')

    g.selectAll('circle.pt')
      .data(trend)
      .join('circle')
      .attr('class', 'pt')
      .attr('cx', (d) => x(parse(d.date)))
      .attr('cy', (d) => yRate(d.on_time_rate))
      .attr('r', 3)
      .attr('fill', RATE_COLOR)
      .append('title')
      .text((d) => `${d.date}\n准点率 ${Math.round(d.on_time_rate * 100)}%\n运单 ${d.total} 票`)

    svg
      .append('g')
      .attr('transform', `translate(0,${margin.top + innerH})`)
      .call(
        axisBottom(x)
          .ticks(7)
          .tickSize(0)
          .tickPadding(8)
          .tickFormat((d) => {
            const dt = d as Date
            return `${dt.getMonth() + 1}/${dt.getDate()}`
          }),
      )
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 10)

    svg
      .append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(
        axisLeft(yRate)
          .ticks(5)
          .tickSize(0)
          .tickPadding(6)
          .tickFormat((v) => `${Math.round((v as number) * 100)}%`),
      )
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 10)

    svg
      .append('g')
      .attr('transform', `translate(${margin.left + innerW},0)`)
      .call(axisRight(yVol).ticks(5).tickSize(0).tickPadding(6))
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 10)
  }, [trend, width, height])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="准点率趋势折线图" />
}
