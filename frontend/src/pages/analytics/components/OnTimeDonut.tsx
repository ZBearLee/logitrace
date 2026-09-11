// 准点率环图：手写 D3（d3-shape 的 pie + arc），中心显示整体准点率百分比。
// 纯 SVG 渲染，不依赖任何开箱图表库；数据只含准时/延误两段。
import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { arc, pie, type PieArcDatum } from 'd3-shape'

interface Props {
  onTime: number
  delayed: number
  width?: number
  height?: number
}

const ON_TIME_COLOR = '#2ea043'
const DELAYED_COLOR = '#f0a020'

interface Slice {
  label: string
  value: number
  color: string
}

export default function OnTimeDonut({ onTime, delayed, width = 240, height = 240 }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = select(ref.current)
    svg.selectAll('*').remove()

    const data: Slice[] = [
      { label: '准时', value: onTime, color: ON_TIME_COLOR },
      { label: '延误', value: delayed, color: DELAYED_COLOR },
    ].filter((d) => d.value > 0)
    const radius = Math.min(width, height) / 2
    const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`)

    if (data.length === 0) {
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('fill', '#5b6b7d')
        .attr('font-size', 13)
        .text('暂无送达数据')
      return
    }

    const pieGen = pie<Slice>()
      .value((d) => d.value)
      .sort(null)
    const arcGen = arc<PieArcDatum<Slice>>()
      .innerRadius(radius * 0.62)
      .outerRadius(radius * 0.95)
      .cornerRadius(3)

    g.selectAll('path')
      .data(pieGen(data))
      .join('path')
      .attr('d', arcGen)
      .attr('fill', (d) => d.data.color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)

    const rate = onTime + delayed > 0 ? Math.round((onTime / (onTime + delayed)) * 100) : 0
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.1em')
      .attr('fill', '#1f2d3d')
      .attr('font-size', 30)
      .attr('font-weight', 700)
      .text(`${rate}%`)
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.5em')
      .attr('fill', '#5b6b7d')
      .attr('font-size', 12)
      .text('整体准点率')
  }, [onTime, delayed, width, height])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="准点率环图" />
}
