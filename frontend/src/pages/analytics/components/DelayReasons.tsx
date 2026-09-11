// 延误原因条形图：手写 D3 竖向柱状。按异常类型（delay/stalled/route_deviation）统计命中次数，
// 点击柱体下钻到异常中心（按类型筛选）。纯 SVG，不引图表库。
import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { scaleBand, scaleLinear } from 'd3-scale'
import { max } from 'd3-array'
import { axisBottom, axisLeft } from 'd3-axis'
import type { DelayReason } from '@/types/analytics'

interface Props {
  reasons: DelayReason[]
  onSelect?: (type: string) => void
  width?: number
  height?: number
}

const TYPE_LABEL: Record<string, string> = {
  delay: '延误',
  stalled: '滞留',
  route_deviation: '偏航',
}
const TYPE_COLOR: Record<string, string> = {
  delay: '#f0a020',
  stalled: '#cf1322',
  route_deviation: '#722ed1',
}
const AXIS_COLOR = '#5b6b7d'

export default function DelayReasons({ reasons, onSelect, width = 460, height = 260 }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = select(ref.current)
    svg.selectAll('*').remove()

    const margin = { top: 16, right: 12, bottom: 30, left: 36 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    if (reasons.length === 0 || reasons.every((r) => r.count === 0)) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', AXIS_COLOR)
        .attr('font-size', 13)
        .text('暂无异常记录')
      return
    }

    const x = scaleBand<string>()
      .domain(reasons.map((r) => r.type))
      .range([0, innerW])
      .padding(0.35)
    const y = scaleLinear()
      .domain([0, max(reasons, (r) => r.count) ?? 1])
      .nice()
      .range([innerH, 0])

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.selectAll('rect')
      .data(reasons)
      .join('rect')
      .attr('x', (d) => x(d.type) ?? 0)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerH - y(d.count))
      .attr('fill', (d) => TYPE_COLOR[d.type] ?? '#888')
      .attr('rx', 3)
      .style('cursor', onSelect ? 'pointer' : 'default')
      .on('click', (_e, d) => onSelect?.(d.type))
      .append('title')
      .text((d) => `${TYPE_LABEL[d.type] ?? d.type}：${d.count} 条（点击查看异常）`)

    g.selectAll('text.value')
      .data(reasons)
      .join('text')
      .attr('class', 'value')
      .attr('x', (d) => (x(d.type) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.count) - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', '#1f2d3d')
      .attr('font-size', 11)
      .text((d) => d.count)

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(x).tickSize(0).tickPadding(8))
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 11)
      .text((d) => TYPE_LABEL[d as string] ?? d)

    g.append('g')
      .call(axisLeft(y).ticks(4).tickSize(0).tickPadding(6))
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 10)
  }, [reasons, onSelect, width, height])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="延误原因条形图" />
}
