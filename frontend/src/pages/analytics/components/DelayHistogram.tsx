// 延误分布直方图：手写 D3（d3-scale 的 band/linear + d3-axis），按延误时长分箱显示运单数。
// 纯 SVG，柱子带数值标签；x 轴区间标签在底部居中。
import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { scaleBand, scaleLinear } from 'd3-scale'
import { max } from 'd3-array'
import { axisBottom, axisLeft } from 'd3-axis'
import type { DelayBucket } from '@/types/analytics'

interface Props {
  buckets: DelayBucket[]
  width?: number
  height?: number
}

const BAR_COLOR = '#f0a020'
const AXIS_COLOR = '#5b6b7d'

export default function DelayHistogram({ buckets, width = 360, height = 260 }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = select(ref.current)
    svg.selectAll('*').remove()

    const margin = { top: 16, right: 12, bottom: 36, left: 36 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    if (buckets.length === 0 || buckets.every((b) => b.count === 0)) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', AXIS_COLOR)
        .attr('font-size', 13)
        .text('暂无延误数据')
      return
    }

    const x = scaleBand<string>()
      .domain(buckets.map((b) => b.label))
      .range([0, innerW])
      .padding(0.25)
    const y = scaleLinear()
      .domain([0, max(buckets, (b) => b.count) ?? 1])
      .nice()
      .range([innerH, 0])

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.selectAll('rect')
      .data(buckets)
      .join('rect')
      .attr('x', (d) => x(d.label) ?? 0)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerH - y(d.count))
      .attr('fill', BAR_COLOR)
      .attr('rx', 3)

    g.selectAll('text.value')
      .data(buckets)
      .join('text')
      .attr('class', 'value')
      .attr('x', (d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
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

    g.append('g')
      .call(axisLeft(y).ticks(4).tickSize(0).tickPadding(6))
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 10)
  }, [buckets, width, height])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="延误分布直方图" />
}
