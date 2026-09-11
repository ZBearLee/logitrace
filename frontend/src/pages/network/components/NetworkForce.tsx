// 物流关系网络：手写 D3 力导向图（d3-force + d3-drag + d3-zoom），纯 SVG。
// 节点 = 口岸(location) / 承运商(carrier)；边 = 航线(lane，按运输方式上色) + 承运商服务口岸(serve，虚线)。
// 让图「活起来」：点击节点选中并聚焦其邻居（其余淡出）、悬停看详情、风险节点标红、
// 按运输方式筛选航线、搜索高亮匹配节点。布局只在结构变化（数据/尺寸/筛选）时重算。
import { useEffect, useRef } from 'react'
import { select, type BaseType, type Selection } from 'd3-selection'
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
import type { NetworkGraph, NetworkNode } from '@/types/network'

interface Props {
  data: NetworkGraph
  /** 当前选中节点 id（loc-/car-），选中后只高亮其邻居。 */
  selectedId?: string | null
  /** 点击节点回调；点空白处(背景)传 null 取消选中。 */
  onSelectNode?: (node: NetworkNode | null) => void
  /** 显示的运输方式集合（lane 边按此过滤）；空集合表示全部。 */
  modeFilter?: string[]
  /** 搜索关键字，命中节点 label 的高亮，其余淡出。 */
  search?: string
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
  on_time_rate?: number | null
  risk?: string | null
  served_by?: number | null
  serves?: number | null
  partners?: string[]
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
const RISK_COLOR = '#cf1322'

function nodeRadius(n: SimNode) {
  return n.type === 'carrier' ? 9 + Math.sqrt(n.volume) * 1.6 : 6 + Math.sqrt(n.volume) * 2
}

function nodeTitle(n: SimNode) {
  const parts = [n.label, n.type === 'carrier' ? '承运商' : '口岸', `运量 ${n.volume} 票`]
  if (n.on_time_rate != null) parts.push(`准点率 ${Math.round(n.on_time_rate * 100)}%`)
  if (n.risk === 'single_carrier') parts.push('风险：只被 1 个承运商服务')
  if (n.risk === 'single_port') parts.push('风险：只服务 1 个口岸')
  if (n.partners && n.partners.length) parts.push(`合作方：${n.partners.slice(0, 3).join('、')}`)
  return parts.join('\n')
}

export default function NetworkForce({
  data,
  selectedId,
  onSelectNode,
  modeFilter = [],
  search = '',
  width = 760,
  height = 540,
}: Props) {
  const ref = useRef<SVGSVGElement | null>(null)
  // 缓存选择集与节点数组，供「仅视觉变化」的副 effect 复用，避免重排布局
  const linkSelRef = useRef<Selection<SVGGElement, unknown, BaseType, unknown> | null>(null)
  const nodeSelRef = useRef<Selection<SVGGElement, SimNode, BaseType, unknown> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const adjRef = useRef<Map<string, Set<string>>>(new Map())
  const onSelectRef = useRef(onSelectNode)
  onSelectRef.current = onSelectNode

  // 主 effect：结构变化（数据/尺寸/运输方式筛选）时重建布局
  useEffect(() => {
    const svg = select(ref.current!)
    svg.selectAll('*').remove()

    const container = svg.append('g')
    const linkSel = container.append('g')
    const nodeLayer = container.append('g')

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

    const nodeById = new Map(data.nodes.map((n) => [n.id, n]))
    const showMode = (m: string | null) =>
      modeFilter.length === 0 || (m != null && modeFilter.includes(m))
    // 航线按自身 mode 过滤；承运商→口岸的虚线按承运商的 mode 过滤（承运商只有一个 mode）。
    // 这样勾选某运输方式 = 只看该方式的网络，其余节点/连线隐藏，筛选才真正有意义。
    const visibleEdges = data.edges.filter((e) => {
      if (e.type === 'lane') return showMode(e.mode ?? null)
      const carrierMode = nodeById.get(e.source as string)?.carrier_mode ?? null
      return showMode(carrierMode)
    })
    // 没有可见连线的节点直接隐藏，避免图被无关节点撑着、看着像没变化
    const connected = new Set<string>()
    for (const e of visibleEdges) {
      connected.add(e.source as string)
      connected.add(e.target as string)
    }

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }))
    const links: SimLink[] = visibleEdges.map((e) => ({
      ...e,
      source: e.source,
      target: e.target,
    }))
    nodesRef.current = nodes

    const adj = new Map<string, Set<string>>()
    for (const l of links) {
      adj.set(l.source as string, adj.get(l.source as string) ?? new Set())
      adj.set(l.target as string, adj.get(l.target as string) ?? new Set())
      adj.get(l.source as string)!.add(l.target as string)
      adj.get(l.target as string)!.add(l.source as string)
    }
    adjRef.current = adj

    linkSel
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

    const nodeSel = nodeLayer
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .on('click', (_e, d) => {
        _e.stopPropagation()
        onSelectRef.current?.(d)
      })
      .each(function (d) {
        const g = select(this)
        g.append('circle')
          .attr('r', nodeRadius(d))
          .attr('fill', d.risk ? RISK_COLOR : d.type === 'carrier' ? CAR_COLOR : LOC_COLOR)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
        g.append('text')
          .text(d.label)
          .attr('x', nodeRadius(d) + 4)
          .attr('y', 4)
          .attr('fill', '#1f2d3d')
          .attr('font-size', 10)
        g.append('title').text(nodeTitle(d))
      })
      // 按运输方式筛选后，把失去全部连线的节点直接隐藏，让筛选结果看得见
      .style('display', (d) => (connected.has(d.id) ? null : 'none'))

    linkSelRef.current = linkSel
    nodeSelRef.current = nodeSel

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
    nodeSel.call(dragBehavior)

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform.toString())
      })
    svg.call(zoomBehavior)

    // 背景点击取消选中
    svg.on('click', () => onSelectRef.current?.(null))

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
        .selectAll<SVGLineElement, SimLink>('line')
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      sim.stop()
    }
    // selectedId / search 仅影响视觉，不进依赖，避免每次选中都重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height, modeFilter])

  // 副 effect：仅视觉（选中聚焦 / 搜索高亮）变化时更新样式，不重排布局
  useEffect(() => {
    const linkSel = linkSelRef.current
    const nodeSel = nodeSelRef.current
    const nodesArr = nodesRef.current
    if (!linkSel || !nodeSel || !nodesArr) return

    const sel = selectedId ?? ''
    const q = search.trim().toLowerCase()
    const adj = adjRef.current
    const isMatch = (n: SimNode) => q === '' || n.label.toLowerCase().includes(q)
    const focusNode = (n: SimNode) => (sel ? n.id === sel || adj.get(sel)?.has(n.id) : isMatch(n))

    nodeSel
      .attr('opacity', (d: SimNode) => (focusNode(d) ? 1 : 0.15))
      .select<SVGCircleElement>('circle')
      .attr('fill', (d: SimNode) =>
        d.risk ? RISK_COLOR : d.type === 'carrier' ? CAR_COLOR : LOC_COLOR,
      )
      .attr('stroke', (d: SimNode) => {
        if (sel && (d.id === sel || adj.get(sel)?.has(d.id))) return '#1f2d3d'
        if (q && isMatch(d)) return '#1677ff'
        return '#fff'
      })
      .attr('stroke-width', (d: SimNode) => ((sel && d.id === sel) || (q && isMatch(d)) ? 3 : 1.5))

    linkSel.selectAll<SVGLineElement, SimLink>('line').attr('stroke-opacity', (d: SimLink) => {
      const s = d.source as SimNode
      const t = d.target as SimNode
      if (sel) return s.id === sel || t.id === sel ? 0.9 : 0.06
      if (q) return isMatch(s) || isMatch(t) ? 0.9 : 0.06
      return d.type === 'lane' ? 0.55 : 0.5
    })
  }, [selectedId, search, data])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="物流关系网络" />
}
