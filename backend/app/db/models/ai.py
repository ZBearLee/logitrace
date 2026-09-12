"""AI 赋能：ETA 预测记录、AI 查询日志、异常日报。

eta_predictions 带 model_version：便于做「基线 vs 特征工程」的迭代对比（25 步的评估诉求）。
ai_query_logs 是可观测性：每次 NL 查数记录解析参数与延迟，主动展示 AI 链路可被审计。
"""

from datetime import datetime

from sqlalchemy import DateTime, Double, Enum, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EtaPrediction(Base):
    """ETA 预测记录：模型对在途运单的到达时间预测。

    同一运单会有多条（每次批量推理各写一条），消费方按 created_at 取最新；
    model_version 区分模型迭代，方便对比不同版本的预测质量。
    """

    __tablename__ = "eta_predictions"
    __table_args__ = (Index("idx_eta_shipment_time", "shipment_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id"), nullable=False)
    predicted_arrival: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # 置信度 0~1：样本越充足的航线/承运商组合越高，样本不足时给保守值
    confidence: Mapped[float] = mapped_column(Double, nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    features_json: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class AiQueryLog(Base):
    """AI 查询日志：NL 查数的可观测性（问了什么、解析成什么参数、命中多少、多快）。"""

    __tablename__ = "ai_query_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(String(512), nullable=False)
    parsed_params_json: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    result_count: Mapped[int] = mapped_column(nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class DailyReport(Base):
    """异常日报：每天一份，按日期唯一（重复生成时覆盖）。"""

    __tablename__ = "daily_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_date: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)  # YYYY-MM-DD
    summary: Mapped[str] = mapped_column(String(2048), nullable=False)
    # 结构化统计（各类型异常数、Top 延误运单等），前端卡片可自行渲染数字
    stats_json: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    # 'llm'（模型生成）/ 'template'（无 Key 时的模板降级）
    source: Mapped[str] = mapped_column(
        Enum("llm", "template", name="daily_report_source"), nullable=False, server_default="template"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
