// 实时位置 WebSocket 客户端：订阅后端 /ws/positions，把消息回调给调用方。
// 默认走相对路径（由网关转发）；开发期可用 VITE_WS_BASE 直连后端便于联调。

export interface PositionStreamMessage {
  leg_id: number
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  ts: string
}

/** 后端空闲时下发的心跳，仅用于保活，不下发给业务。 */
const PING_TYPE = 'ping'

/** 判定连接已死的阈值：需显著大于后端 ws_heartbeat_seconds（默认 30s），留足抖动余量。 */
const STALE_TIMEOUT_MS = 60_000

/** 存活检查周期 */
const WATCHDOG_INTERVAL_MS = 10_000

/** 断线重连间隔 */
const RETRY_INTERVAL_MS = 2_000

export function connectPositions(onMessage: (msg: PositionStreamMessage) => void): () => void {
  const base = import.meta.env.VITE_WS_BASE as string | undefined
  const url = base
    ? `${base.replace(/\/$/, '')}/ws/positions`
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/positions`
  let ws: WebSocket | null = null
  let closed = false
  let retryTimer: number | undefined
  let watchdogTimer: number | undefined
  let lastAliveAt = Date.now()

  const clearTimer = (timer: number | undefined) => {
    if (timer) window.clearTimeout(timer)
  }

  // 半开连接兜底：一段时间没收到任何消息（含心跳）就判定连接已死，主动关闭以
  // 触发重连。仅靠 onclose 感知不到被中间层静默掐断、本地仍处于 OPEN 的连接。
  const watchdog = () => {
    if (closed) return
    if (Date.now() - lastAliveAt > STALE_TIMEOUT_MS) {
      ws?.close()
      return
    }
    watchdogTimer = window.setTimeout(watchdog, WATCHDOG_INTERVAL_MS)
  }

  const open = () => {
    if (closed) return
    ws = new WebSocket(url)
    ws.onmessage = (ev) => {
      lastAliveAt = Date.now()
      try {
        const data = JSON.parse(ev.data) as PositionStreamMessage & { type?: string }
        if (data.type === PING_TYPE) return
        onMessage(data)
      } catch {
        // 单条脏数据不影响整体流
      }
    }
    ws.onopen = () => {
      lastAliveAt = Date.now()
      clearTimer(watchdogTimer)
      watchdogTimer = window.setTimeout(watchdog, WATCHDOG_INTERVAL_MS)
    }
    ws.onclose = () => {
      clearTimer(watchdogTimer)
      watchdogTimer = undefined
      if (closed) return
      retryTimer = window.setTimeout(open, RETRY_INTERVAL_MS)
    }
  }
  open()

  return () => {
    closed = true
    clearTimer(retryTimer)
    clearTimer(watchdogTimer)
    const socket = ws
    if (!socket) return
    // StrictMode 在开发模式下会把 effect 跑两遍：首次挂载的 socket 往往还处于
    // CONNECTING 就被卸载，此时直接 close() 会让浏览器报 "closed before the
    // connection is established"。等它真正 OPEN 后再关，可避免这条开发期告警。
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.addEventListener('open', () => socket.close(), { once: true })
    } else {
      socket.close()
    }
  }
}
