"""健康检查：Docker healthcheck 与后续 K8s 探针的依赖点。"""

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name}
