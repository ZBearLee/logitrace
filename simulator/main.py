"""模拟器 v1：批量生成历史运单。

流程：
1. 从数据库读港口（locations）和承运商（carriers）—— 复用 seed 写入的基础数据
2. 按航线生成运单（shipments）与运输段（legs）
3. 用大圆插值生成轨迹点（position_points）
4. 生成里程碑事件（milestone_events）

表结构用 SQLAlchemy 反射（autoload_with），不重复定义 ORM 模型，
这样模拟器不依赖 backend 代码，符合"计算与 API 解耦"的架构决策。
"""

import argparse
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import MetaData, Table, create_engine, insert, select

from config import settings
from geo import bearing_deg, haversine_km, interpolate_great_circle

# 航线：起点港 code、终点港 code、运输方式（与 seed 的港口 code 对应）
ROUTES: list[tuple[str, str, str]] = [
    ("CNSHA", "NLRTM", "sea"),
    ("CNNGB", "USLAX", "sea"),
    ("CNSZX", "DEHAM", "sea"),
    ("SGSIN", "AEJEA", "sea"),
    ("KRPUS", "USLAX", "sea"),
    ("CNTJN", "USNYC", "sea"),
    ("HKHKG", "GBFXT", "sea"),
    ("CNSHA", "AUSYD", "sea"),
    ("CNTAO", "BRSSZ", "sea"),
    ("CNSZX", "VNSGN", "sea"),
    ("MYPKG", "ZADUR", "sea"),
    ("HKHKG", "NLRTM", "air"),
    ("CNTAO", "DEHAM", "rail"),
]

# 各运输方式的典型航程天数与轨迹点数量
MODE_PROFILE: dict[str, tuple[int, int]] = {
    "sea": (28, 80),    # 航程天数, 轨迹点数
    "air": (1, 24),
    "rail": (16, 60),
    "road": (3, 30),
}

DEFAULT_COUNT = 50


def generate(count: int) -> dict[str, int]:
    """批量生成历史运单，返回各类数据的写入条数。"""
    engine = create_engine(settings.mysql_dsn_sync, future=True)
    metadata = MetaData()
    locations_t = Table("locations", metadata, autoload_with=engine)
    carriers_t = Table("carriers", metadata, autoload_with=engine)
    shipments_t = Table("shipments", metadata, autoload_with=engine)
    legs_t = Table("legs", metadata, autoload_with=engine)
    points_t = Table("position_points", metadata, autoload_with=engine)
    events_t = Table("milestone_events", metadata, autoload_with=engine)

    stats = {"shipments": 0, "legs": 0, "positions": 0, "events": 0}

    with engine.begin() as conn:
        ports = {
            row.code: (row.id, row.lat, row.lng)
            for row in conn.execute(select(locations_t))
        }
        carriers_by_mode: dict[str, list[tuple[int, float | None]]] = {}
        for row in conn.execute(select(carriers_t)):
            carriers_by_mode.setdefault(row.mode, []).append((row.id, row.avg_speed))

        # MySQL 的 DateTime 列不带时区，统一存 UTC 的 naive datetime
    now = datetime.now(timezone.utc).replace(tzinfo=None)

        for i in range(count):
            origin_code, dest_code, mode = random.choice(ROUTES)
            if origin_code not in ports or dest_code not in ports:
                continue
            if mode not in carriers_by_mode:
                continue

            origin_id, o_lat, o_lng = ports[origin_code]
            dest_id, d_lat, d_lng = ports[dest_code]
            carrier_id, avg_speed = random.choice(carriers_by_mode[mode])
            voyage_days, point_count = MODE_PROFILE.get(mode, (10, 40))

            # 历史运单：过去 90 天内随机出发；已完成或在途
            departure = now - timedelta(days=random.randint(5, 90))
            arrival = departure + timedelta(days=voyage_days)
            finished = arrival < now
            status = "delivered" if finished else "in_transit"
            if not finished and random.random() < 0.15:
                status = "delayed"

            distance_km = haversine_km(o_lat, o_lng, d_lat, d_lng)

            result = conn.execute(
                insert(shipments_t).values(
                    shipment_no=f"SHP-{departure.strftime('%Y%m%d')}-{i + 1:05d}",
                    status=status,
                    origin_id=origin_id,
                    dest_id=dest_id,
                    carrier_id=carrier_id,
                    planned_departure=departure,
                    planned_arrival=arrival,
                    actual_departure=departure if finished or status == "in_transit" else None,
                    actual_arrival=arrival if finished else None,
                    created_at=now,
                )
            )
            shipment_id = result.inserted_primary_key[0]
            stats["shipments"] += 1

            leg_result = conn.execute(
                insert(legs_t).values(
                    shipment_id=shipment_id,
                    seq=1,
                    mode=mode,
                    origin_id=origin_id,
                    dest_id=dest_id,
                    planned_start=departure,
                    planned_end=arrival,
                    status="completed" if finished else "active",
                )
            )
            leg_id = leg_result.inserted_primary_key[0]
            stats["legs"] += 1

            # 轨迹点：沿大圆航线按时间均匀插值
            points = []
            progress = 1.0 if finished else random.uniform(0.15, 0.9)
            for k in range(point_count):
                t = k / (point_count - 1)
                if t > progress:
                    break
                lat, lng = interpolate_great_circle(o_lat, o_lng, d_lat, d_lng, t)
                recorded_at = departure + timedelta(days=voyage_days * t)
                points.append(
                    {
                        "leg_id": leg_id,
                        "lat": lat,
                        "lng": lng,
                        "speed": avg_speed,
                        "heading": bearing_deg(o_lat, o_lng, d_lat, d_lng),
                        "recorded_at": recorded_at,
                        "created_at": now,
                    }
                )
            if points:
                conn.execute(insert(points_t), points)
                stats["positions"] += len(points)

                # 冗余最新位置回写 shipments（列表页免 JOIN 轨迹表）
                last = points[-1]
                conn.execute(
                    shipments_t.update()
                    .where(shipments_t.c.id == shipment_id)
                    .values(
                        latest_lat=last["lat"],
                        latest_lng=last["lng"],
                        latest_ts=last["recorded_at"],
                    )
                )

            # 里程碑事件：离港 →（可选延误/滞留）→ 到港 →（完成则签收）
            events = [
                {
                    "shipment_id": shipment_id,
                    "leg_id": leg_id,
                    "event_type": "departed",
                    "occurred_at": departure,
                    "payload_json": None,
                    "created_at": now,
                }
            ]
            if status == "delayed":
                events.append(
                    {
                        "shipment_id": shipment_id,
                        "leg_id": leg_id,
                        "event_type": "delayed",
                        "occurred_at": departure + timedelta(days=voyage_days * 0.5),
                        "payload_json": f'{{"distance_km": {distance_km:.1f}}}',
                        "created_at": now,
                    }
                )
            if finished:
                events.append(
                    {
                        "shipment_id": shipment_id,
                        "leg_id": leg_id,
                        "event_type": "arrived",
                        "occurred_at": arrival,
                        "payload_json": None,
                        "created_at": now,
                    }
                )
                events.append(
                    {
                        "shipment_id": shipment_id,
                        "leg_id": leg_id,
                        "event_type": "delivered",
                        "occurred_at": arrival + timedelta(hours=6),
                        "payload_json": None,
                        "created_at": now,
                    }
                )
            conn.execute(insert(events_t), events)
            stats["events"] += len(events)

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="LogiTrace 模拟器 v1：批量生成历史运单")
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="生成运单数量")
    args = parser.parse_args()

    stats = generate(args.count)
    print("生成完成：")
    for key, value in stats.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
