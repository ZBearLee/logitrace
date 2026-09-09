"""实时位置 WebSocket：把 Redis 发布/订阅的 positions / events 流转发到前端。

模拟器把在途位置写进 Redis 频道，后端只做转发、不碰业务库；前端按需开
/ws/positions（位置流）或 /ws/events（里程碑 / 异常事件流）。
"""

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings

router = APIRouter(tags=["realtime"])


async def _relay(websocket: WebSocket, channel: str) -> None:
    await websocket.accept()
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = client.pubsub()
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message and message.get("type") == "message":
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await client.aclose()


@router.websocket("/ws/positions")
async def ws_positions(websocket: WebSocket) -> None:
    await _relay(websocket, "ch:positions")


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket) -> None:
    await _relay(websocket, "ch:events")
