// 承运商对比堆叠条图：手写 D3，每个承运商一根柱，准时（绿）/延误（橙）上下堆叠。
// 纯 SVG；柱顶显示该承运商总数，x 轴为承运商名（过长截断避免重叠）。
import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { scaleBand, scaleLinear } from 'd3-scale'
import { max } from 'd3-array'
import { axisBottom, axisLeft } from 'd3-axis'
import { stack } from 'd3-shape'
import type { CarrierMetric } from '@/types/analytics'

interface Props {
  carriers: CarrierMetric[]
  /** 点击某承运商柱体下钻到运单列表（按该承运商筛选）；未知承运商（id 为 null）不可点。 */
  onSelectCarrier?: (carrierId: number) => void
  width?: number
  height?: number
}

const ON_TIME_COLOR = '#2ea043'
const DELAYED_COLOR = '#f0a020'
const AXIS_COLOR = '#5b6b7d'

export default function CarrierBar({
  carriers,
  onSelectCarrier,
  width = 460,
  height = 280,
}: Props) {
  const ref = useRef<SVGSVGElement | null>(null)
  // 回调只用于绑定点击事件，放进 ref 避免父组件重渲染时整张 SVG 重建
  const onSelectCarrierRef = useRef(onSelectCarrier)
  useEffect(() => {
    onSelectCarrierRef.current = onSelectCarrier
  }, [onSelectCarrier])

  useEffect(() => {
    const svg = select(ref.current)
    svg.selectAll('*').remove()

    const margin = { top: 20, right: 12, bottom: 54, left: 36 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    const rows = carriers.filter((c) => c.total > 0)
    if (rows.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', AXIS_COLOR)
        .attr('font-size', 13)
        .text('暂无承运商数据')
      return
    }

    const x = scaleBand<string>()
      .domain(rows.map((c) => c.name))
      .range([0, innerW])
      .padding(0.3)
    const y = scaleLinear()
      .domain([0, max(rows, (c) => c.total) ?? 1])
      .nice()
      .range([innerH, 0])

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const series = stack<CarrierMetric, 'on_time' | 'delayed'>()
      .keys(['on_time', 'delayed'])
      .value((d, key) => (key === 'on_time' ? d.on_time : d.delayed))

    g.selectAll('g.layer')
      .data(series(rows))
      .join('g')
      .attr('class', 'layer')
      .attr('fill', (d) => (d.key === 'on_time' ? ON_TIME_COLOR : DELAYED_COLOR))
      .selectAll('rect')
      .data((d) => d.map((seg) => ({ seg, key: d.key })))
      .join('rect')
      .attr('x', (d) => x(d.seg.data.name) ?? 0)
      .attr('y', (d) => y(d.seg[1]))
      .attr('width', x.bandwidth())
      .attr('height', (d) => y(d.seg[0]) - y(d.seg[1]))
      .attr('rx', 2)
      .style('cursor', onSelectCarrierRef.current ? 'pointer' : 'default')
      .on('click', (_e, d) => {
        const id = d.seg.data.carrier_id
        if (id != null) onSelectCarrierRef.current?.(id)
      })
      .append('title')
      .text(
        (d) =>
          `${d.seg.data.name}\n准点率 ${Math.round(d.seg.data.on_time_rate * 100)}% (${d.seg.data.on_time}/${d.seg.data.total})`,
      )

    g.selectAll('text.total')
      .data(rows)
      .join('text')
      .attr('class', 'total')
      .attr('x', (d) => (x(d.name) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.total) - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', '#1f2d3d')
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .text((d) => d.total)

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(x).tickSize(0).tickPadding(8))
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 11)
      .each(function (_, i) {
        // 承运商名可能较长，超出柱宽就截断加省略号，避免横轴标签互相压字
        const node = this as SVGTextElement
        const maxChars = Math.max(4, Math.floor(x.bandwidth() / 12))
        const full = rows[i].name
        if (full.length > maxChars) node.textContent = `${full.slice(0, maxChars)}…`
      })

    g.append('g')
      .call(axisLeft(y).ticks(4).tickSize(0).tickPadding(6))
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', AXIS_COLOR)
      .attr('font-size', 10)
  }, [carriers, width, height])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="承运商对比堆叠条图" />
}
