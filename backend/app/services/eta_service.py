"""ETA 服务化：对在途运单批量推理并写入 eta_predictions。

APScheduler 每小时调一次 refresh_eta_predictions；每次推理都新写一行
（带 model_version），消费方按 created_at 取最新——保留历史才能做「模型迭代对比」。
"""

from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.db.models.ai import EtaPrediction
from app.db.models.reference import Carrier, Location
from app.db.models.shipment import Shipment
from app.ml import eta

# 在途口径：运输中 + 已延误（都还在路上，都有 ETA 预测价值）
IN_FLIGHT_STATUSES = ("in_transit", "delayed")


async def refresh_eta_predictions(session) -> dict:
    """批量推理在途运单并写预测记录。返回统计（模型缺失时返回 skipped 原因）。"""
    artifact = eta.load()
    if artifact is None:
        return {"skipped": "model-not-trained"}

    origin = aliased(Location, name="origin")
    dest = aliased(Location, name="dest")
    rows = (
        await session.execute(
            select(
                Shipment,
                origin.lat,
                origin.lng,
                dest.lat,
                dest.lng,
                Carrier.mode,
                Carrier.avg_speed,
            )
            .join(origin, Shipment.origin_id == origin.id)
            .join(dest, Shipment.dest_id == dest.id)
            .join(Carrier, Shipment.carrier_id == Carrier.id)
            .where(Shipment.status.in_(IN_FLIGHT_STATUSES))
        )
    ).all()

    written = 0
    for s, o_lat, o_lng, d_lat, d_lng, mode, avg_speed in rows:
        if None in (o_lat, o_lng, d_lat, d_lng, s.planned_arrival, s.planned_departure):
            continue  # 缺坐标或缺计划时间无法构造特征，跳过
        duration_h = (s.planned_arrival - s.planned_departure).total_seconds() / 3600
        features = eta.build_features(
            distance_km=eta.haversine_km(o_lat, o_lng, d_lat, d_lng),
            planned_duration_h=duration_h,
            planned_arrival=s.planned_arrival,
            mode=mode,
            carrier_avg_speed=avg_speed,
        )
        delay_h = eta.predict_delay_hours(artifact, features)
        session.add(
            EtaPrediction(
                shipment_id=s.id,
                predicted_arrival=s.planned_arrival + timedelta(hours=delay_h),
                confidence=eta.confidence_for(artifact, mode),
                model_version=artifact["version"],
                features_json=json.dumps(
                    dict(zip(eta.FEATURE_NAMES, [round(f, 2) for f in features])),
                    ensure_ascii=False,
                ),
            )
        )
        written += 1

    await session.commit()
    return {"written": written, "version": artifact["version"]}
