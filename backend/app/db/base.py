"""声明式基类：所有 ORM 模型的公共祖先。

供 Alembic 的 target_metadata 使用，让 autogenerate 有比对目标；
后续业务表都继承这个 Base。
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 写法（不再用旧的 declarative_base()）。"""
