// 世界地图矢量数据：用 world-atlas 的 TopoJSON，运行时转 GeoJSON 后缓存。
// ECharts 方案（registerMap）与 Canvas 方案（投影描边）共用同一份数据，对比公平、可缩放。
import { useMemo } from 'react'
import { feature } from 'topojson-client'
import topo from 'world-atlas/countries-110m.json'

let cache: any = null

/**
 * 惰性转换并缓存。
 * 赋值放在模块级函数内：hook 里直接改模块级变量属于渲染期副作用，会被 React 规则拦下。
 */
function loadGeo() {
  if (cache) return cache
  try {
    cache = feature(topo as any, (topo as any).objects.countries)
  } catch {
    // 数据转换失败也不阻塞页面，地图区域会显示空白
    return null
  }
  return cache
}

export function useWorldGeo() {
  // 首次渲染即得出结果：不需要 effect，也就不会在 effect 里同步 setState
  const geo = useMemo<any>(() => loadGeo(), [])

  // loading 由结果派生，不再单独维护一份 state
  return { geo, loading: geo === null }
}
