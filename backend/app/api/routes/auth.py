"""登录接口：校验演示账号并签发访问令牌。"""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.schemas import LoginIn, LoginOut
from app.core.security import create_access_token, verify_password
from app.db.models.reference import User
from app.db.session import SessionDep

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, session: SessionDep) -> LoginOut:
    """账号口令登录，成功返回令牌。"""
    user = (await session.scalars(select(User).where(User.username == body.username))).first()
    # 账号不存在与口令错误返回同一提示：分开提示等于把「哪些账号存在」泄露给未登录的人
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    return LoginOut(
        access_token=create_access_token(user.username, user.role),
        username=user.username,
        role=user.role,
    )
