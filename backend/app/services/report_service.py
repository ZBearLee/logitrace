"""异常日报：按日汇总异常 → LLM 摘要（无 Key 走模板）→ daily_reports。

按 report_date 唯一，重复生成时覆盖——调度每天 08:00 跑一次，
接口也可按需生成（缺当天记录时现算），保证随时有数据可看。
"""

from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core.llm import ai_enabled, chat_json
from app.db.models.ai import DailyReport
from app.db.models.reference import Location
from app.db.models.shipment import Shipment
from app.db.models.tracking import ExceptionRecord

Origin = aliased(Location, name="origin")
Dest = aliased(Location, name="dest")

_SUMMARY_SYSTEM = (
    "你是物流运营助理。根据给定的当日异常统计数据，写一份不超过 200 字的中文管理层日报摘要。"
    "要点：总体异常量与趋势、最主要的问题类型、最严重的运单、给运营的一句话建议。"
    '只输出 JSON：{"summary": "..."}'
)


def _template_summary(stats: dict) -> str:
    """无 Key 时的模板降级：数字齐全，只是没有"人话"润色。"""
    parts = [f"当日共记录异常 {stats['total']} 起"]
    if stats["by_type"]:
        top = max(stats["by_type"], key=stats["by_type"].get)
        parts.append(f"以 {top} 为主（{stats['by_type'][top]} 起）")
    else:
        parts.append("各类异常均为 0，运行平稳")
    if stats["top_delayed"]:
        worst = stats["top_delayed"][0]
        parts.append(
            f"延误最重：{worst['shipment_no']}（{worst['origin']}→{worst['dest']}，"
            f"超计划 {worst['delay_hours']:.0f} 小时）"
        )
    parts.append("建议：优先跟进 Top 延误运单并复核相关承运商时效。")
    return "；".join(parts) + "。"


async def generate_daily_report(session, report_date: str) -> DailyReport:
    """生成（或覆盖）某天的日报。report_date 为 YYYY-MM-DD（按检测时间聚合）。"""
    day_start = datetime.fromisoformat(report_date)
    day_end = day_start.replace(hour=23, minute=59, second=59)

    type_rows = (
        await session.execute(
            select(ExceptionRecord.type, func.count())
            .where(ExceptionRecord.detected_at >= day_start, ExceptionRecord.detected_at <= day_end)
            .group_by(ExceptionRecord.type)
        )
    ).all()
    level_rows = (
        await session.execute(
            select(ExceptionRecord.level, func.count())
            .where(ExceptionRecord.detected_at >= day_start, ExceptionRecord.detected_at <= day_end)
            .group_by(ExceptionRecord.level)
        )
    ).all()

    # 当日延误 Top：actual-planned 差值在 Python 侧排序（数据量小，不值得写 SQL 表达式）
    delay_rows = (
        await session.execute(
            select(Shipment, Origin.code, Dest.code)
            .join(Origin, Shipment.origin_id == Origin.id)
            .join(Dest, Shipment.dest_id == Dest.id)
            .where(
                Shipment.status == "delayed",
                Shipment.actual_arrival.is_not(None),
                Shipment.planned_arrival.is_not(None),
            )
            .limit(100)
        )
    ).all()
    delayed = sorted(
        (
            {
                "shipment_no": s.shipment_no,
                "origin": o or "?",
                "dest": d or "?",
                "delay_hours": (s.actual_arrival - s.planned_arrival).total_seconds() / 3600,
            }
            for s, o, d in delay_rows
        ),
        key=lambda r: r["delay_hours"],
        reverse=True,
    )[:5]

    stats = {
        "date": report_date,
        "total": sum(c for _, c in type_rows),
        "by_type": {t: c for t, c in type_rows},
        "by_level": {lv: c for lv, c in level_rows},
        "top_delayed": delayed,
    }
    serialized = json.dumps(stats, ensure_ascii=False)

    # 按 report_date 唯一：先查再插/更新，避免依赖 MySQL 的 ON DUPLICATE 语法
    existing = (
        await session.execute(select(DailyReport).where(DailyReport.report_date == report_date))
    ).scalar_one_or_none()
    # 统计未变且已有 LLM 摘要时沿用，避免重复调用；模板摘要足够便宜，每次都重算以跟随文案调整
    if existing is not None and existing.stats_json == serialized and existing.source == "llm":
        return existing

    source = "template"
    summary = _template_summary(stats)
    if ai_enabled():
        result = await chat_json(_SUMMARY_SYSTEM, serialized)
        if result and result.get("summary"):
            summary = str(result["summary"])[:2000]
            source = "llm"

    if existing is not None:
        existing.summary = summary
        existing.stats_json = serialized
        existing.source = source
        report = existing
    else:
        report = DailyReport(
            report_date=report_date,
            summary=summary,
            stats_json=serialized,
            source=source,
        )
        session.add(report)
    await session.commit()
    return report
