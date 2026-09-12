"""AI 接口：NL 查数、能力开关、异常日报、手动 ETA 刷新。

安全边界：LLM 只产出**结构化查询参数**，
本路由对参数做白名单校验（枚举/格式/范围）后才落到 SQLAlchemy 查询上——
全程没有任何一条 SQL 由模型生成。
"""

from __future__ import annotations

import json
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from app.api.deps import current_user
from app.api.schemas import (
    AiQueryIn,
    AiQueryOut,
    AiStatus,
    DailyReportOut,
    EtaOut,
    ShipmentBrief,
)
from app.core.config import settings
from app.core.llm import ai_enabled, chat_json
from app.db.models.ai import AiQueryLog, DailyReport, EtaPrediction
from app.db.models.reference import Carrier, Location
from app.db.models.shipment import Shipment
from app.db.session import SessionDep
from app.ml import eta
from app.services import report_service
from app.services.eta_service import refresh_eta_predictions

router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(current_user)])

# 起止港别名：与运单列表接口同一套写法
Origin = aliased(Location, name="origin")
Dest = aliased(Location, name="dest")

# 白名单：LLM 产出的参数只允许落在这个集合里，之外的一律丢弃
_ALLOWED_MODES = {"sea", "road", "air", "rail"}
_ALLOWED_STATUS = {"planned", "in_transit", "delivered", "delayed"}

_PARSE_SYSTEM = (
    "你是物流运单查询参数解析器。把用户的自然语言解析成查询参数，只输出 JSON，"
    '格式：{"mode": "sea|road|air|rail 之一或 null", '
    '"status": "planned|in_transit|delivered|delayed 之一或 null", '
    '"date_from": "YYYY-MM-DD 或 null", "date_to": "YYYY-MM-DD 或 null", '
    '"delay_over_hours": 数字或 null}。'
    "用户没提到的字段一律为 null，不要编造；延误类说法（如超48小时）映射到 delay_over_hours。"
)


@router.get("/status", response_model=AiStatus)
async def ai_status() -> AiStatus:
    """能力开关：前端据此渲染/隐藏 AI 入口（无 Key 全降级）。"""
    return AiStatus(
        enabled=ai_enabled(),
        model=settings.ai_model or None,
        eta_ready=eta.load() is not None,
    )


@router.post("/query", response_model=AiQueryOut)
async def ai_query(body: AiQueryIn, session: SessionDep) -> AiQueryOut:
    """自然语言查运单：LLM 解析参数 → 白名单校验 → 落到既有查询。"""
    start = time.perf_counter()
    raw = await chat_json(_PARSE_SYSTEM, body.question)
    raw = raw or {}

    # ---- 白名单校验：枚举之外、格式不对的一律置 None ----
    params: dict = {}
    if raw.get("mode") in _ALLOWED_MODES:
        params["mode"] = raw["mode"]
    if raw.get("status") in _ALLOWED_STATUS:
        params["status"] = raw["status"]
    for key in ("date_from", "date_to"):
        value = raw.get(key)
        if isinstance(value, str):
            try:
                params[key] = datetime.fromisoformat(value).date().isoformat()
            except ValueError:
                pass
    try:
        hours = float(raw.get("delay_over_hours"))
        if hours >= 0:
            params["delay_over_hours"] = hours
    except (TypeError, ValueError):
        pass

    # ---- 落查询：字段与列表页接口同源，不发明新口径 ----
    conditions = []
    if "status" in params:
        conditions.append(Shipment.status == params["status"])
    if "mode" in params:
        conditions.append(Carrier.mode == params["mode"])
    if "date_from" in params:
        conditions.append(Shipment.planned_arrival >= datetime.fromisoformat(params["date_from"]))
    if "date_to" in params:
        # 含当天：用当日末尾做闭区间
        day_end = datetime.fromisoformat(params["date_to"]).replace(hour=23, minute=59, second=59)
        conditions.append(Shipment.planned_arrival <= day_end)

    stmt = (
        select(
            Shipment,
            Origin.code,
            Dest.code,
            Carrier.name,
            Origin.lat,
            Origin.lng,
            Dest.lat,
            Dest.lng,
        )
        .outerjoin(Origin, Shipment.origin_id == Origin.id)
        .outerjoin(Dest, Shipment.dest_id == Dest.id)
        .outerjoin(Carrier, Shipment.carrier_id == Carrier.id)
        .where(*conditions)
        .order_by(Shipment.id.desc())
        .limit(200)
    )
    rows = (await session.execute(stmt)).all()

    items = []
    for s, o_code, d_code, carrier_name, o_lat, o_lng, d_lat, d_lng in rows:
        if "delay_over_hours" in params:
            # 延误时长要 actual/planned 齐全才能算，Python 侧过滤（演示数据量小）
            if s.actual_arrival is None or s.planned_arrival is None:
                continue
            delay_h = (s.actual_arrival - s.planned_arrival).total_seconds() / 3600
            if delay_h < params["delay_over_hours"]:
                continue
        items.append(
            ShipmentBrief(
                id=s.id,
                shipment_no=s.shipment_no,
                status=s.status,
                origin_code=o_code,
                dest_code=d_code,
                origin_lat=o_lat,
                origin_lng=o_lng,
                dest_lat=d_lat,
                dest_lng=d_lng,
                carrier_name=carrier_name,
                planned_departure=s.planned_departure,
                planned_arrival=s.planned_arrival,
                actual_departure=s.actual_departure,
                actual_arrival=s.actual_arrival,
                latest_lat=s.latest_lat,
                latest_lng=s.latest_lng,
                latest_ts=s.latest_ts,
            )
        )
    items = items[:20]

    latency_ms = int((time.perf_counter() - start) * 1000)
    session.add(
        AiQueryLog(
            question=body.question[:500],
            parsed_params_json=json.dumps(params, ensure_ascii=False),
            result_count=len(items),
            latency_ms=latency_ms,
        )
    )
    await session.commit()

    return AiQueryOut(params=params, total=len(items), items=items, latency_ms=latency_ms)


@router.get("/daily-report", response_model=DailyReportOut)
async def get_daily_report(
    session: SessionDep,
    date: str | None = Query(None, description="YYYY-MM-DD，默认当天；缺记录时现算"),
) -> DailyReportOut:
    """日报查询：优先读表，缺当天记录时按需生成（演示不等调度）。"""
    today = datetime.now().date().isoformat()
    report_date = date or today
    report = (
        await session.execute(select(DailyReport).where(DailyReport.report_date == report_date))
    ).scalar_one_or_none()
    # 当天日报仍在累积，早上生成的缓存到下午就过期了：当天始终按当前数据重算
    # （generate_daily_report 内部统计未变时会直接沿用已有摘要，不会重复调用 LLM）
    if report is None or report_date == today:
        try:
            report = await report_service.generate_daily_report(session, report_date)
        except IntegrityError:
            # 并发竞争：启动定时任务与首个请求同时生成同一天日报，唯一键冲突；
            # 回滚后对方必然已写入，回读即可
            await session.rollback()
            report = (
                await session.execute(
                    select(DailyReport).where(DailyReport.report_date == report_date)
                )
            ).scalar_one_or_none()
        if report is None:
            raise HTTPException(status_code=500, detail="日报生成失败")
    return DailyReportOut(
        report_date=report.report_date,
        summary=report.summary,
        stats=json.loads(report.stats_json) if report.stats_json else {},
        source=report.source,
        created_at=report.created_at,
    )


@router.post("/eta/refresh", response_model=dict)
async def eta_refresh(session: SessionDep) -> dict:
    """手动触发一次 ETA 批量推理（演示用；调度器每小时也会自动跑）。"""
    return await refresh_eta_predictions(session)


@router.get("/eta/{shipment_id}", response_model=EtaOut)
async def get_eta(shipment_id: int, session: SessionDep) -> EtaOut:
    """单票 ETA：取最新一条预测，并算相对计划到达的偏差（驱动详情页延误预警）。"""
    pred = (
        await session.execute(
            select(EtaPrediction)
            .where(EtaPrediction.shipment_id == shipment_id)
            .order_by(EtaPrediction.created_at.desc())
        )
    ).scalars().first()
    if pred is None:
        raise HTTPException(
            status_code=404, detail="暂无 ETA 预测（模型未训练或该运单不在途）"
        )
    ship = (
        await session.execute(select(Shipment).where(Shipment.id == shipment_id))
    ).scalar_one_or_none()
    deviation_hours = None
    if ship is not None and ship.planned_arrival is not None:
        deviation_hours = (pred.predicted_arrival - ship.planned_arrival).total_seconds() / 3600
    return EtaOut(
        shipment_id=pred.shipment_id,
        predicted_arrival=pred.predicted_arrival,
        confidence=pred.confidence,
        model_version=pred.model_version,
        features_json=pred.features_json,
        deviation_hours=deviation_hours,
        created_at=pred.created_at,
    )
