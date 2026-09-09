"""实时位置 WebSocket：把 Redis 发布/订阅的 positions / events 流转发到前端。

模拟器把在途位置写进 Redis 频道，后端只做转发、不碰业务库；前端按需开
/ws/positions（位置流）或 /ws/events（里程碑 / 异常事件流）。

每个连接独占一条 Redis 订阅：Pub/Sub 连接无法被多个消费者复用，因此不能跨
WebSocket 共享，随连接断开一并释放。空闲时由服务端下发心跳保活。
"""

import json
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings

router = APIRouter(tags=["realtime"])

logger = logging.getLogger(__name__)

# 心跳载荷：与业务消息同为 JSON，前端按 type 区分后丢弃
PING_PAYLOAD = json.dumps({"type": "ping"})


async def _close_quietly(close_call) -> None:
    """释放连接资源：清理阶段的异常没有业务含义，也不应掩盖主异常。"""
    try:
        await close_call()
    except Exception:
        logger.debug("实时流资源释放失败", exc_info=True)


async def _relay(websocket: WebSocket, channel: str) -> None:
    """把指定 Redis 频道的业务消息转发到当前 WebSocket 连接，空闲时发心跳保活。"""
    await websocket.accept()
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(channel)
        while True:
            # 用 get_message 的超时代替独立心跳定时器：有业务消息就转发，超时未
            # 收到则发 ping 保活，并借这次发送探测客户端是否还活着（断开会抛错）。
            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=settings.ws_heartbeat_seconds,
            )
            if message and message.get("type") == "message":
                await websocket.send_text(message["data"])
            else:
                await websocket.send_text(PING_PAYLOAD)
    except WebSocketDisconnect:
        # 客户端主动断开属正常结束，静默退出
        pass
    except Exception:
        # 客户端可能在 disconnect 事件到达前就断了，或 Redis 侧异常。
        # 记录后退出，资源由 finally 释放，避免异常冒泡成噪声日志。
        logger.warning("实时流转发中断 channel=%s", channel, exc_info=True)
    finally:
        await _close_quietly(pubsub.close)
        await _close_quietly(client.aclose)


@router.websocket("/ws/positions")
async def ws_positions(websocket: WebSocket) -> None:
    await _relay(websocket, "ch:positions")


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket) -> None:
    await _relay(websocket, "ch:events")
