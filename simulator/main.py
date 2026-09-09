"""模拟器 v1：批量生成历史运单。

流程：
1. 从数据库读港口（locations.type='port'）、内陆仓（'warehouse'）和承运商（carriers）
2. 按航线生成运单（shipments）与**多段联运**的运输段（legs）：
   内陆仓 --公路--> 起运港 --干线(海/空/铁)--> 目的港 --公路--> 内陆仓
3. 用大圆插值生成各段轨迹点（position_points）
4. 生成里程碑事件（milestone_events）

表结构用 SQLAlchemy 反射（autoload_with），不重复定义 ORM 模型，
这样模拟器不依赖 backend 代码，符合"计算与 API 解耦"的架构决策。
"""

import argparse
import random
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

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

# 货主：订单的归属方。订单是运单的上游，运单靠 order_id 挂到订单上
CUSTOMERS: list[str] = [
    "华为技术有限公司",
    "比亚迪股份有限公司",
    "海尔智家股份有限公司",
    "宁德时代新能源科技",
    "美的集团股份有限公司",
    "立讯精密工业股份",
    "TCL 科技集团",
    "小米通讯技术有限公司",
    "格力电器股份有限公司",
    "歌尔股份有限公司",
]

DEFAULT_COUNT = 50

# 首末端（内陆仓 ↔ 港口）是公路短驳：固定 1 天、点数比干线少，
# 否则几十公里的接驳段点密度会盖过几千公里的干线
DRAYAGE_DAYS = 1
DRAYAGE_POINTS = 12

# 内陆仓 code 的派生规则，与 seed_data.INLAND 保持一致（港口 code 前加 W）
INLAND_PREFIX = "W"

# 拆单：一单可拆多票运单。SPLIT_RATE 是复用已有订单的概率，
# MAX_SHIPMENTS_PER_ORDER 限制单张订单最多挂几票，避免某张订单吃掉全部运单
SPLIT_RATE = 0.4
MAX_SHIPMENTS_PER_ORDER = 3


class Seg(NamedTuple):
    """一段运输计划：多段联运由 3 个 Seg 组成（短驳 → 干线 → 短驳）。"""

    seq: int
    mode: str
    origin_id: int
    dest_id: int
    o_lat: float
    o_lng: float
    d_lat: float
    d_lng: float
    start: datetime
    end: datetime
    points: int
    speed: float | None


def leg_progress(start: datetime, end: datetime, now: datetime) -> float:
    """某段按真实时间的完成度：未开始 0、已结束 1、进行中按时间比例。

    不用随机 progress：在途运单"走到哪了"应由出发时间和航程推出来，
    否则地图上会出现"出发 3 天却已走完全程 80%"这种自相矛盾的数据。
    """
    if now >= end:
        return 1.0
    if now <= start:
        return 0.0
    total = (end - start).total_seconds()
    if total <= 0:
        return 1.0
    return (now - start).total_seconds() / total


def build_points(seg: Seg, leg_id: int, progress: float, now: datetime) -> list[dict]:
    """沿大圆航线按时间均匀插值出一段的轨迹点，只生成到 progress 处。"""
    days = (seg.end - seg.start).total_seconds() / 86400
    heading = bearing_deg(seg.o_lat, seg.o_lng, seg.d_lat, seg.d_lng)
    points: list[dict] = []
    for k in range(seg.points):
        t = k / (seg.points - 1)
        if t > progress:
            break
        lat, lng = interpolate_great_circle(seg.o_lat, seg.o_lng, seg.d_lat, seg.d_lng, t)
        points.append(
            {
                "leg_id": leg_id,
                "lat": lat,
                "lng": lng,
                "speed": seg.speed,
                "heading": heading,
                "recorded_at": seg.start + timedelta(days=days * t),
                "created_at": now,
            }
        )
    return points


def generate(count: int) -> dict[str, int]:
    """批量生成历史运单，返回各类数据的写入条数。"""
    engine = create_engine(settings.mysql_dsn_sync, future=True)
    metadata = MetaData()
    locations_t = Table("locations", metadata, autoload_with=engine)
    carriers_t = Table("carriers", metadata, autoload_with=engine)
    orders_t = Table("orders", metadata, autoload_with=engine)
    shipments_t = Table("shipments", metadata, autoload_with=engine)
    legs_t = Table("legs", metadata, autoload_with=engine)
    points_t = Table("position_points", metadata, autoload_with=engine)
    events_t = Table("milestone_events", metadata, autoload_with=engine)

    stats = {"orders": 0, "shipments": 0, "legs": 0, "positions": 0, "events": 0}

    with engine.begin() as conn:
        # 港口与内陆仓分开建索引：多段联运要用 type 区分干线与短驳的起终点
        ports = {
            row.code: (row.id, row.lat, row.lng)
            for row in conn.execute(select(locations_t).where(locations_t.c.type == "port"))
        }
        inland = {
            row.code: (row.id, row.lat, row.lng)
            for row in conn.execute(select(locations_t).where(locations_t.c.type == "warehouse"))
        }
        carriers_by_mode: dict[str, list[tuple[int, float | None]]] = {}
        for row in conn.execute(select(carriers_t)):
            carriers_by_mode.setdefault(row.mode, []).append((row.id, row.avg_speed))

        # MySQL 的 DateTime 列不带时区，统一存 UTC 的 naive datetime
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        # 订单数少于运单数（拆单时多票共用一张），所以订单序号单独累加，不复用运单下标
        # order_pool 每项为 [order_id, 已挂运单数]，用于挑还能挂票的订单
        order_seq = 0
        order_pool: list[list[int]] = []

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
            road_speed = carriers_by_mode.get("road", [(0, 55.0)])[0][1]

            # 历史运单：过去 90 天内随机出发；已完成或在途
            departure = now - timedelta(days=random.randint(5, 90))

            # 门到门需要首尾内陆仓；缺了就退化成单段干线，保证脚本仍能跑
            o_inland = inland.get(f"{INLAND_PREFIX}{origin_code}")
            d_inland = inland.get(f"{INLAND_PREFIX}{dest_code}")
            multimodal = o_inland is not None and d_inland is not None

            if multimodal:
                o_inland_id, oi_lat, oi_lng = o_inland
                d_inland_id, di_lat, di_lng = d_inland
                seg1_start = departure
                seg1_end = seg1_start + timedelta(days=DRAYAGE_DAYS)
                seg2_start = seg1_end
                seg2_end = seg2_start + timedelta(days=voyage_days)
                seg3_start = seg2_end
                seg3_end = seg3_start + timedelta(days=DRAYAGE_DAYS)
                segs: list[Seg] = [
                    Seg(1, "road", o_inland_id, origin_id, oi_lat, oi_lng, o_lat, o_lng,
                        seg1_start, seg1_end, DRAYAGE_POINTS, road_speed),
                    Seg(2, mode, origin_id, dest_id, o_lat, o_lng, d_lat, d_lng,
                        seg2_start, seg2_end, point_count, avg_speed),
                    Seg(3, "road", dest_id, d_inland_id, d_lat, d_lng, di_lat, di_lng,
                        seg3_start, seg3_end, DRAYAGE_POINTS, road_speed),
                ]
                arrival = seg3_end
            else:
                segs = [
                    Seg(1, mode, origin_id, dest_id, o_lat, o_lng, d_lat, d_lng,
                        departure, departure + timedelta(days=voyage_days), point_count, avg_speed)
                ]
                arrival = segs[0].end

            finished = arrival < now
            status = "delivered" if finished else "in_transit"
            if not finished and random.random() < 0.15:
                status = "delayed"

            distance_km = haversine_km(o_lat, o_lng, d_lat, d_lng)

            # 订单是运单的上游：先把 order_id 挂上，否则域模型「订单 → 运单」这层就断了。
            # 按 SPLIT_RATE 复用还能挂票的订单，让部分订单拆成多票运单
            reusable = [o for o in order_pool if o[1] < MAX_SHIPMENTS_PER_ORDER]
            if reusable and random.random() < SPLIT_RATE:
                slot = random.choice(reusable)
                slot[1] += 1
                order_id = slot[0]
            else:
                order_seq += 1
                order_result = conn.execute(
                    insert(orders_t).values(
                        order_no=f"ORD-{departure.strftime('%Y%m%d')}-{order_seq:05d}",
                        customer_name=random.choice(CUSTOMERS),
                        status="created",
                        created_at=now,
                    )
                )
                order_id = order_result.inserted_primary_key[0]
                order_pool.append([order_id, 1])
                stats["orders"] += 1

            result = conn.execute(
                insert(shipments_t).values(
                    shipment_no=f"SHP-{departure.strftime('%Y%m%d')}-{i + 1:05d}",
                    status=status,
                    order_id=order_id,
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

            all_points: list[dict] = []
            leg_ids: list[int] = []
            for seg in segs:
                seg_status = "completed" if now >= seg.end else ("active" if now >= seg.start else "planned")
                leg_result = conn.execute(
                    insert(legs_t).values(
                        shipment_id=shipment_id,
                        seq=seg.seq,
                        mode=seg.mode,
                        origin_id=seg.origin_id,
                        dest_id=seg.dest_id,
                        planned_start=seg.start,
                        planned_end=seg.end,
                        status=seg_status,
                    )
                )
                leg_id = leg_result.inserted_primary_key[0]
                leg_ids.append(leg_id)
                stats["legs"] += 1

                progress = 1.0 if finished else leg_progress(seg.start, seg.end, now)
                all_points.extend(build_points(seg, leg_id, progress, now))

            if all_points:
                conn.execute(insert(points_t), all_points)
                stats["positions"] += len(all_points)

                # 冗余最新位置回写 shipments（列表页免 JOIN 轨迹表）
                last = all_points[-1]
                conn.execute(
                    shipments_t.update()
                    .where(shipments_t.c.id == shipment_id)
                    .values(
                        latest_lat=last["lat"],
                        latest_lng=last["lng"],
                        latest_ts=last["recorded_at"],
                    )
                )

            # 里程碑：提货（短驳开始）→ 离港（干线开始）→（延误）→ 到港 → 签收
            main = segs[1] if multimodal else segs[0]
            main_leg_id = leg_ids[1] if multimodal else leg_ids[0]
            events: list[dict] = []
            if multimodal:
                events.append(
                    {
                        "shipment_id": shipment_id,
                        "leg_id": leg_ids[0],
                        "event_type": "picked_up",
                        "occurred_at": departure,
                        "payload_json": None,
                        "created_at": now,
                    }
                )
            events.append(
                {
                    "shipment_id": shipment_id,
                    "leg_id": main_leg_id,
                    "event_type": "departed",
                    "occurred_at": main.start,
                    "payload_json": None,
                    "created_at": now,
                }
            )
            if status == "delayed":
                events.append(
                    {
                        "shipment_id": shipment_id,
                        "leg_id": main_leg_id,
                        "event_type": "delayed",
                        "occurred_at": main.start + (main.end - main.start) / 2,
                        "payload_json": f'{{"distance_km": {distance_km:.1f}}}',
                        "created_at": now,
                    }
                )
            if finished:
                events.append(
                    {
                        "shipment_id": shipment_id,
                        "leg_id": main_leg_id,
                        "event_type": "arrived",
                        "occurred_at": main.end,
                        "payload_json": None,
                        "created_at": now,
                    }
                )
                events.append(
                    {
                        "shipment_id": shipment_id,
                        "leg_id": leg_ids[-1],
                        "event_type": "delivered",
                        "occurred_at": arrival,
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
