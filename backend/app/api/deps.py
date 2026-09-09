"""接口依赖：从 Authorization 头解析当前登录身份。

业务路由在 APIRouter 上声明 dependencies 即可整体受保护，
不必在每个视图函数里重复写一遍参数。
"""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.schemas import UserClaims
from app.core.security import decode_access_token

# auto_error=False：缺失令牌时自己抛 401，避免 FastAPI 返回默认的 403 Forbidden
bearer_scheme = HTTPBearer(auto_error=False)

UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UserClaims:
    """解析并校验访问令牌。"""
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录", headers=UNAUTHORIZED_HEADERS)

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=401, detail="登录已失效，请重新登录", headers=UNAUTHORIZED_HEADERS
        )

    return UserClaims(username=payload["sub"], role=payload.get("role", "viewer"))
