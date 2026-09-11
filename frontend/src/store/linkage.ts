// 跨页联动通道：关系网络（D3）点节点 / 框选口岸 → 大屏 Cesium 飞行定位与高亮。
// 网络页与大屏是不同路由，靠这个模块级单例把「一次联动请求」从网络页带到大屏挂载时消费，
// 不引入状态库、不依赖路由参数，模块级单例在切页后依然存活。

/** 单个定位点：口岸经纬度。 */
export interface LinkPoint {
  lat: number
  lng: number
}

/** 联动请求：飞行定位到单个口岸，或框选多个口岸后飞到其包围盒并高亮。 */
export type LinkageRequest =
  | { kind: 'flyToPort'; code: string; label: string; point: LinkPoint }
  | { kind: 'flyToBounds'; codes: string[]; points: LinkPoint[] }

type Listener = () => void

// 仅保留最近一次请求：联动是「一次性」的，消费后即清空，避免重进大屏反复飞行。
let pending: LinkageRequest | null = null
const listeners = new Set<Listener>()

export const linkage = {
  /** 发出联动请求：写入 pending 并通知订阅者（大屏已挂载时立即响应）。 */
  request(r: LinkageRequest) {
    pending = r
    listeners.forEach((l) => l())
  },
  /** 取出并清空最近一次请求；大屏挂载时调用一次即可消费。 */
  consume(): LinkageRequest | null {
    const r = pending
    pending = null
    return r
  },
  /** 订阅联动请求；返回取消订阅函数（返回 void，便于直接作为 effect 清理函数）。 */
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}
