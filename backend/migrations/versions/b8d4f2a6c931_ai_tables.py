"""ai tables

Revision ID: b8d4f2a6c931
Revises: c4f1a9d2b7e0
Create Date: 2026-09-12

ETA 预测记录 / AI 查询日志 / 异常日报 三张表，供 AI 模块使用。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d4f2a6c931'
down_revision: Union[str, None] = 'c4f1a9d2b7e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'eta_predictions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('shipment_id', sa.Integer(), nullable=False),
        sa.Column('predicted_arrival', sa.DateTime(), nullable=False),
        sa.Column('confidence', sa.Double(), nullable=False),
        sa.Column('model_version', sa.String(length=64), nullable=False),
        sa.Column('features_json', sa.String(length=2048), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['shipment_id'], ['shipments.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_eta_shipment_time', 'eta_predictions', ['shipment_id', 'created_at'], unique=False
    )

    op.create_table(
        'ai_query_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question', sa.String(length=512), nullable=False),
        sa.Column('parsed_params_json', sa.String(length=1024), nullable=True),
        sa.Column('result_count', sa.Integer(), nullable=False),
        sa.Column('latency_ms', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'daily_reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('report_date', sa.String(length=10), nullable=False),
        sa.Column('summary', sa.String(length=2048), nullable=False),
        sa.Column('stats_json', sa.String(length=2048), nullable=True),
        sa.Column(
            'source',
            sa.Enum('llm', 'template', name='daily_report_source'),
            server_default='template',
            nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('report_date'),
    )


def downgrade() -> None:
    op.drop_table('daily_reports')
    op.drop_table('ai_query_logs')
    op.drop_index('idx_eta_shipment_time', table_name='eta_predictions')
    op.drop_table('eta_predictions')
