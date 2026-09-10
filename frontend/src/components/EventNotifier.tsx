import { useEffect } from 'react'
import { notification } from 'antd'
import { useNavigate } from 'react-router-dom'
import { connectEvents, type EventStreamMessage } from '@/api/ws'
import { eventLabel } from '@/constants/shipments'

/** 事件类型 → 提示等级：里程碑视为进展，异常偏警告。 */
const EVENT_LEVEL: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
  picked_up: 'info',
  loaded: 'info',
  departed: 'success',
  arrived: 'success',
  delivered: 'success',
  delayed: 'warning',
  stalled: 'warning',
}

/**
 * 全局实时事件推送：订阅 /ws/events，对每条里程碑 / 异常事件弹通知。
 * 自身只渲染 null，连接与弹窗副作用都在 effect 内完成。
 */
export default function EventNotifier() {
  const navigate = useNavigate()

  useEffect(() => {
    const close = connectEvents((msg: EventStreamMessage) => {
      const label = eventLabel(msg.event_type)
      notification.open({
        type: EVENT_LEVEL[msg.event_type] ?? 'info',
        message: `实时事件 · ${label}`,
        description: `运单 #${msg.shipment_id} ${label}`,
        placement: 'topRight',
        duration: 4,
        onClick: () => navigate(`/shipments/${msg.shipment_id}`),
      })
    })
    return close
  }, [navigate])

  return null
}
