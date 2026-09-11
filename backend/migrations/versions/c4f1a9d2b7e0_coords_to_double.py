"""坐标列 float -> double

MySQL 的 FLOAT 是 4 字节单精度，文本协议输出只有 6 位有效数字（FLT_DIG）。
经纬度整数部分不同，导致有效小数位不一致：
  纬度 30.x -> 4 位小数 ≈ 11m，经度 121.x -> 3 位小数 ≈ 96m
两点分辨率差约 9 倍，轨迹点被压到"横粗竖细"的网格上，连成线就是直角楼梯。
改为 DOUBLE（约 15 位有效数字），让经纬度获得一致的亚米级分辨率。

Revision ID: c4f1a9d2b7e0
Revises: 8420f0d71c49
Create Date: 2026-09-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4f1a9d2b7e0'
down_revision: Union[str, None] = '8420f0d71c49'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('position_points', 'lat', type_=sa.Double(), existing_nullable=False)
    op.alter_column('position_points', 'lng', type_=sa.Double(), existing_nullable=False)
    op.alter_column('locations', 'lat', type_=sa.Double(), existing_nullable=False)
    op.alter_column('locations', 'lng', type_=sa.Double(), existing_nullable=False)
    op.alter_column('shipments', 'latest_lat', type_=sa.Double(), existing_nullable=True)
    op.alter_column('shipments', 'latest_lng', type_=sa.Double(), existing_nullable=True)


def downgrade() -> None:
    op.alter_column('position_points', 'lat', type_=sa.Float(), existing_nullable=False)
    op.alter_column('position_points', 'lng', type_=sa.Float(), existing_nullable=False)
    op.alter_column('locations', 'lat', type_=sa.Float(), existing_nullable=False)
    op.alter_column('locations', 'lng', type_=sa.Float(), existing_nullable=False)
    op.alter_column('shipments', 'latest_lat', type_=sa.Float(), existing_nullable=True)
    op.alter_column('shipments', 'latest_lng', type_=sa.Float(), existing_nullable=True)
