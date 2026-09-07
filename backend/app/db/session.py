"""异步数据库会话：FastAPI 依赖注入用。

应用运行时走 aiomysql 异步驱动；Alembic 迁移和 seed 脚本走同步 pymysql。
两条路径的连接串都由 app.core.config 提供，配置只有一个来源。
"""

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.mysql_dsn, pool_pre_ping=True, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """请求级会话：每个请求一个会话，请求结束自动关闭。"""
    async with SessionLocal() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
