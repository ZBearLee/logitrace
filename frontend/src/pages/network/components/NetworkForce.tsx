// 物流关系网络：手写 D3 力导向图（d3-force + d3-drag + d3-zoom），纯 SVG。
// 节点 = 口岸(location) / 承运商(carrier)；边 = 航线(lane，按运输方式上色) + 承运商服务口岸(serve，虚线)。
// 不引开箱图库：布局、拖拽、缩放全部手写，契合「手写力导向」的底层定位。
import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { drag } from 'd3-drag'
import { zoom } from 'd3-zoom'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { NetworkGraph } from '@/types/network'

interface Props {
  data: NetworkGraph
  width?: number
  height?: number
}

interface SimNode extends SimulationNodeDatum {
  id: string
  label: string
  type: string
  volume: number
  location_type?: string | null
  country?: string | null
  carrier_mode?: string | null
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  type: string
  weight: number
  mode?: string | null
}

const MODE_COLOR: Record<string, string> = {
  sea: '#2f81f7',
  road: '#f0a020',
  air: '#e3529c',
  rail: '#3fb950',
}
const SERVE_COLOR = '#9aa7b5'
const LOC_COLOR = '#1677ff'
const CAR_COLOR = '#f0a020'

function nodeRadius(n: SimNode) {
  return n.type === 'carrier' ? 9 + Math.sqrt(n.volume) * 1.6 : 6 + Math.sqrt(n.volume) * 2
}

export default function NetworkForce({ data, width = 760, height = 540 }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = select(ref.current!)
    svg.selectAll('*').remove()

    if (data.nodes.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#5b6b7d')
        .attr('font-size', 13)
        .text('暂无网络数据')
      return
    }

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }))
    const links: SimLink[] = data.edges.map((e) => ({ ...e, source: e.source, target: e.target }))

    const container = svg.append('g')

    const linkSel = container
      .append('g')
      .attr('stroke-opacity', 0.55)
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) =>
        d.type === 'lane' ? (d.mode ? (MODE_COLOR[d.mode] ?? '#9fb4cc') : '#9fb4cc') : SERVE_COLOR,
      )
      .attr('stroke-width', (d) =>
        d.type === 'lane' ? Math.max(1, Math.min(5, Math.sqrt(d.weight))) : 0.7,
      )
      .attr('stroke-dasharray', (d) => (d.type === 'serve' ? '2,2' : null))

    const nodeG = container
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'grab')

    nodeG
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => (d.type === 'carrier' ? CAR_COLOR : LOC_COLOR))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)

    nodeG
      .append('text')
      .text((d) => d.label)
      .attr('x', (d) => nodeRadius(d) + 4)
      .attr('y', 4)
      .attr('fill', '#1f2d3d')
      .attr('font-size', 10)

    let sim: Simulation<SimNode, SimLink>
    const dragBehavior = drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0)
        d.fx = null
        d.fy = null
      })
    nodeG.call(dragBehavior)

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => container.attr('transform', event.transform.toString()))
    svg.call(zoomBehavior)

    sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => (l.type === 'lane' ? 110 : 70))
          .strength(0.25),
      )
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => nodeRadius(d) + 6),
      )

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      nodeG.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      sim.stop()
    }
  }, [data, width, height])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="物流关系网络" />
}
