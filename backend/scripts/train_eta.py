"""训练 ETA 基线模型并落盘。

用法（backend 目录下）：
    .venv/Scripts/python scripts/train_eta.py

数据来源：已评分运单（delivered/delayed 且计划/实际到达齐全），
join 起止港经纬度算距离、join 承运商拿方式与均速。
产物：app/ml/artifacts/eta_model.joblib（模型 + 基线 + 指标 + 版本号）。
"""

import sys
from datetime import datetime
from pathlib import Path

# 保证从任意目录调起都能 import 到 app 包
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session, aliased  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.models.reference import Carrier, Location  # noqa: E402
from app.db.models.shipment import Shipment  # noqa: E402
from app.ml import eta  # noqa: E402


def main() -> None:
    engine = create_engine(settings.mysql_dsn_sync)
    origin = aliased(Location, name="origin")
    dest = aliased(Location, name="dest")

    with Session(engine) as session:
        rows = (
            session.execute(
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
                .where(Shipment.status.in_(["delivered", "delayed"]))
            )
            .all()
        )

    dataset = []
    for s, o_lat, o_lng, d_lat, d_lng, mode, avg_speed in rows:
        if s.planned_arrival is None or s.actual_arrival is None:
            continue
        if s.planned_departure is None or o_lat is None or d_lat is None:
            continue
        delay_h = (s.actual_arrival - s.planned_arrival).total_seconds() / 3600
        duration_h = (s.planned_arrival - s.planned_departure).total_seconds() / 3600
        dataset.append(
            {
                "features": eta.build_features(
                    distance_km=eta.haversine_km(o_lat, o_lng, d_lat, d_lng),
                    planned_duration_h=duration_h,
                    planned_arrival=s.planned_arrival,
                    mode=mode,
                    carrier_avg_speed=avg_speed,
                ),
                "delay_hours": delay_h,
                "mode": mode,
            }
        )

    artifact = eta.train(dataset)
    version = f"gbr-{datetime.now().strftime('%Y%m%d')}-n{artifact['n_samples']}"
    eta.save(artifact, version)

    print(f"样本数: {artifact['n_samples']}")
    print(f"基线 MAE: {artifact['mae_baseline_h']} h（逐方式中位数）")
    print(f"模型 MAE: {artifact['mae_model_h']} h（GradientBoosting）")
    print(f"基线延误中位数: {artifact['baseline']}")
    print(f"各方式样本量: {artifact['counts']}")
    print(f"版本: {version}")
    print(f"产物: {eta.ARTIFACT_PATH}")


if __name__ == "__main__":
    main()
