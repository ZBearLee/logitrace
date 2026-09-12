"""OpenAI 兼容协议客户端。

- 模型名 / Key / BaseURL 全部来自配置（.env），代码零厂商字眼，换供应商零改动；
- 无 Key 时 ai_enabled() 为 False，调用方据此降级（隐藏入口或走模板）；
- 所有失败静默返回 None，由调用方决定降级路径——AI 永远不能挡住主业务。
"""

from __future__ import annotations

import json

import httpx

from app.core.config import settings


def ai_enabled() -> bool:
    """三项配置齐全才算启用；任一缺失即降级。"""
    return bool(settings.ai_api_key and settings.ai_base_url and settings.ai_model)


async def chat_json(system: str, user: str, timeout: float = 20.0) -> dict | None:
    """对话补全并解析回复中的 JSON 对象；任何失败返回 None。

    温度取 0：我们做的是结构化解析/摘要，不要创造性。
    兼容模型把 JSON 包在 ```json 围栏里的情况，取首尾大括号之间的内容解析。
    """
    if not ai_enabled():
        return None
    payload = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{settings.ai_base_url.rstrip('/')}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {settings.ai_api_key}"},
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
        text = content.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        return json.loads(text[start : end + 1])
    except Exception:
        # 网络/鉴权/解析任何一环失败都降级：AI 是器官，不是主角
        return None
