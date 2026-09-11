// 航线流量桑基图：手写 D3（d3-sankey 布局 + SVG path 连接）。
// 两列布局：左列=出发口岸、右列=到达口岸（同名口岸两侧各出现一次），link 粗细表运量、
// 颜色表运输方式，一眼看清「货从哪出发、往哪流」。数据由 /analytics/summary 的
// top_routes 一次性给（Top N OD 段），前端只负责布局不重算。
// 为什么不用「一个口岸一个节点」的单列布局：OD 数据普遍存在 A→B 与 B→A 双向对流，
// 单列下会构成环，d3-sankey 算节点深度时直接抛 circular link 异常炸掉整页；
// 固定两列后所有 link 都从左指右，天然无环。
import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import type { Selection } from 'd3-selection'
import { sankey, sankeyLinkHorizontal } from 'd3-sankey'
import type { RouteFlow } from '@/types/analytics'

interface Props {
  routes: RouteFlow[]
  width?: number
  height?: number
}

const MODE_COLOR: Record<string, string> = {
  sea: '#2f81f7',
  road: '#f0a020',
  air: '#e3529c',
  rail: '#3fb950',
  unknown: '#9fb4cc',
}
/** 运输方式配色：看板图例复用同一份，避免两处各写一套颜色 */
export const ROUTE_MODE_COLOR = MODE_COLOR
const AXIS_COLOR = '#5b6b7d'

/** 空态/布局失败时的兜底提示。 */
function drawFallback(
  svg: Selection<SVGSVGElement, unknown, null, undefined>,
  width: number,
  height: number,
  text: string,
) {
  svg
    .append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', AXIS_COLOR)
    .attr('font-size', 13)
    .text(text)
}

export default function RouteSankey({ routes, width = 880, height = 380 }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = select(ref.current!)
    svg.selectAll('*').remove()

    if (routes.length === 0) {
      drawFallback(svg, width, height, '暂无航线流量数据')
      return
    }

    // 左右两列各自去重：同一口岸既出发又到达时，两侧各占一个节点
    const left: string[] = []
    const right: string[] = []
    const leftIndex = new Map<string, number>()
    const rightIndex = new Map<string, number>()
    for (const r of routes) {
      if (!leftIndex.has(r.origin)) {
        leftIndex.set(r.origin, left.length)
        left.push(r.origin)
      }
      if (!rightIndex.has(r.dest)) {
        rightIndex.set(r.dest, right.length)
        right.push(r.dest)
      }
    }
    const nodes = [...left.map((name) => ({ name })), ...right.map((name) => ({ name }))]
    const links = routes.map((r) => ({
      source: leftIndex.get(r.origin)!,
      target: left.length + rightIndex.get(r.dest)!,
      value: r.count,
      mode: r.mode,
    }))

    const margin = { top: 14, right: 14, bottom: 14, left: 14 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom
    // 列内节点多时压缩间距，避免纵向溢出画布
    const maxCol = Math.max(left.length, right.length)
    const padding = maxCol > 18 ? 4 : maxCol > 12 ? 8 : 13

    const gen = sankey<{ name: string }, (typeof links)[number]>()
      .nodeWidth(14)
      .nodePadding(padding)
      .extent([
        [margin.left, margin.top],
        [margin.left + innerW, margin.top + innerH],
      ])

    let graph: ReturnType<typeof gen>
    try {
      graph = gen({ nodes, links } as never)
    } catch {
      // 布局失败（如极端数据形态）只降级为提示，不把整个看板页面炸掉
      drawFallback(svg, width, height, '航线流量暂无法布局')
      return
    }

    // link：横向贝塞尔连接，宽度按运量，颜色按运输方式
    svg
      .append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr(
        'stroke',
        (d) => MODE_COLOR[(d as { mode?: string }).mode ?? 'unknown'] ?? MODE_COLOR.unknown,
      )
      .attr('stroke-opacity', 0.42)
      .attr('stroke-width', (d) => Math.max(1, d.width ?? 1))
      .append('title')
      .text(
        (d) =>
          `${(d.source as { name: string }).name} → ${(d.target as { name: string }).name}\n${(d as { mode?: string }).mode ?? 'unknown'} · ${d.value} 票`,
      )

    // 节点：矩形 + 名称标签（左列标在右侧、右列标在左侧，避免文字出界）
    const nodeG = svg.append('g').selectAll('g').data(graph.nodes).join('g')
    nodeG
      .append('rect')
      .attr('x', (d) => d.x0 ?? 0)
      .attr('y', (d) => d.y0 ?? 0)
      .attr('width', (d) => (d.x1 ?? 0) - (d.x0 ?? 0))
      .attr('height', (d) => Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0)))
      .attr('fill', (d) => ((d.x0 ?? 0) < width / 2 ? '#1677ff' : '#0e5fd8'))
      .attr('rx', 2)
    nodeG.append('title').text((d) => `${d.name}（${d.value ?? 0} 票）`)
    nodeG
      .append('text')
      .attr('x', (d) => ((d.x0 ?? 0) < width / 2 ? (d.x1 ?? 0) + 6 : (d.x0 ?? 0) - 6))
      .attr('y', (d) => ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d) => ((d.x0 ?? 0) < width / 2 ? 'start' : 'end'))
      .attr('fill', '#1f2d3d')
      .attr('font-size', 11)
      .text((d) => d.name)
  }, [routes, width, height])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="航线流量桑基图" />
}
