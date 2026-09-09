"""模拟器 v2：持续生成在途运单位置流。

与 v1（批量造历史 main.py）解耦——v1 负责"造数据"，本模块负责"让在途运单动起来"。
长循环里对每个 active leg 按仿真时钟推进，沿大圆航线插值出当前位置，写入 Redis Hash
（最新位置）并发布 Pub/Sub（位置流 / 里程碑事件流），用 Sorted Set 做滞留滑动窗口。

配置走环境变量（见 config.py），默认每 1 真实秒推进 10 仿真分钟。
表结构用 SQLAlchemy 反射（autoload_with），不重复定义 ORM 模型，与 v1 一致。
"""

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import redis
from sqlalchemy import MetaData, Table, create_engine, insert, select, update

from config import settings
from geo import bearing_deg, haversine_km, interpolate_great_circle


def _utcnow() -> datetime:
    """MySQL 的 DateTime 不带时区，统一存 UTC 的 naive datetime。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _leg_progress(start: datetime, end: datetime, now: datetime) -> float:
    """某段按仿真时间的完成度：未开始 0、已结束 1、进行中按时间比例。

    复用 v1 的同名逻辑，保证"走到哪"和造历史时自洽、不突变。
    """
    if now >= end:
        return 1.0
    if now <= start:
        return 0.0
    total = (end - start).total_seconds()
    if total <= 0:
        return 1.0
    return (now - start).total_seconds() / total


def _load_active_legs(engine, metadata):
    """读 in_transit/delayed 运单下、未完成(active/planned)的运输段，连带起止坐标。"""
    shipments_t = Table("shipments", metadata, autoload_with=engine)
    legs_t = Table("legs", metadata, autoload_with=engine)
    locations_t = Table("locations", metadata, autoload_with=engine)
    origin = locations_t.alias("origin")
    dest = locations_t.alias("dest")

    stmt = (
        select(
            legs_t.c.id,
            legs_t.c.shipment_id,
            legs_t.c.seq,
            legs_t.c.mode,
            legs_t.c.status,
            legs_t.c.planned_start,
            legs_t.c.planned_end,
            origin.c.lat.label("o_lat"),
            origin.c.lng.label("o_lng"),
            dest.c.lat.label("d_lat"),
            dest.c.lng.label("d_lng"),
        )
        .select_from(legs_t.join(shipments_t, legs_t.c.shipment_id == shipments_t.c.id))
        .join(origin, legs_t.c.origin_id == origin.c.id)
        .join(dest, legs_t.c.dest_id == dest.c.id)
        .where(shipments_t.c.status.in_(["in_transit", "delayed"]))
        .where(legs_t.c.status != "completed")
    )
    with engine.connect() as conn:
        return conn.execute(stmt).mappings().all()


def _publish_event(r: redis.Redis, shipment_id: int, leg_id: int, event_type: str,
                   occurred_at: str, payload_json: Optional[str]) -> None:
    msg = json.dumps({
        "shipment_id": shipment_id,
        "leg_id": leg_id,
        "event_type": event_type,
        "occurred_at": occurred_at,
        "payload_json": payload_json,
    })
    r.publish("ch:events", msg)


def _check_stall(r: redis.Redis, db_ops: list, events_t: Table, leg_id: int,
                 shipment_id: int, speed: Optional[float], ts_iso: str,
                 stalled_legs: set) -> None:
    """Sorted Set 滑动窗口判滞留：窗口内速度持续低于阈值则写异常记录并推事件。"""
    if speed is None:
        return
    score = time.time()
    member = f"{score:.3f}:{speed:.3f}"
    r.zadd(f"speed:{leg_id}", {member: score})
    r.zremrangebyrank(f"speed:{leg_id}", 0, -1 - settings.stall_window)
    if leg_id in stalled_legs:
        return
    items = r.zrange(f"speed:{leg_id}", 0, -1)
    if len(items) < settings.stall_window:
        return
    speeds = [float(m.decode().split(":")[1]) for m in items]
    if all(s < settings.stall_speed for s in speeds):
        stalled_legs.add(leg_id)
        payload = json.dumps({"speed": round(speed, 2)})
        db_ops.append(
            insert(events_t).values(
                shipment_id=shipment_id,
                leg_id=leg_id,
                event_type="stalled",
                occurred_at=ts_iso,
                payload_json=payload,
                created_at=_utcnow(),
            )
        )
        _publish_event(r, shipment_id, leg_id, "stalled", ts_iso, payload)


def run() -> None:
    engine = create_engine(settings.mysql_dsn_sync, future=True)
    metadata = MetaData()
    points_t = Table("position_points", metadata, autoload_with=engine)
    legs_t = Table("legs", metadata, autoload_with=engine)
    shipments_t = Table("shipments", metadata, autoload_with=engine)
    events_t = Table("milestone_events", metadata, autoload_with=engine)

    r = redis.Redis.from_url(settings.redis_url)

    # 仿真时钟：从真实现在开始累加，保证与 v1 造数据时同一套进度基准
    sim_now = _utcnow()
    prev_pos: dict[int, tuple[float, float]] = {}   # leg_id -> 上一 tick 位置，用于算速度
    stalled_legs: set[int] = set()                   # 已判定滞留的 leg，避免重复插异常
    completed: dict[int, set[int]] = {}              # shipment_id -> 已完成 leg 集合
    persist_acc: dict[int, int] = {}                 # leg_id -> 已累计未落库的仿真分钟数
    ship_legs: dict[int, set[int]] = {}              # shipment_id -> 该运单所有段（判全完成）

    print(
        f"[stream] 启动，仿真起点 {sim_now.isoformat()}Z，"
        f"每 {settings.tick_seconds}s 推进 {settings.advance_minutes} 仿真分钟"
    )
    try:
        while True:
            sim_now += timedelta(minutes=settings.advance_minutes)
            ts_iso = sim_now.isoformat()

            legs = _load_active_legs(engine, metadata)
            for leg in legs:
                ship_legs.setdefault(leg["shipment_id"], set()).add(leg["id"])

            db_ops: list = []
            with r.pipeline() as pipe:
                for leg in legs:
                    lid = leg["id"]
                    sid = leg["shipment_id"]
                    progress = _leg_progress(leg["planned_start"], leg["planned_end"], sim_now)

                    # 段刚开始（planned -> active）：发 departed 里程碑
                    if leg["status"] == "planned" and progress > 0:
                        db_ops.append(
                            update(legs_t).where(legs_t.c.id == lid).values(status="active")
                        )
                        _publish_event(r, sid, lid, "departed", ts_iso, None)

                    if progress >= 1.0:
                        # 段完成：标记完成 + 发里程碑；最后一个段完成触发 delivered
                        completed.setdefault(sid, set()).add(lid)
                        db_ops.append(
                            update(legs_t).where(legs_t.c.id == lid).values(status="completed")
                        )
                        if leg["mode"] != "road":
                            _publish_event(r, sid, lid, "arrived", ts_iso, None)
                        if completed[sid] >= ship_legs.get(sid, set()):
                            _publish_event(r, sid, lid, "delivered", ts_iso, None)
                            db_ops.append(
                                update(shipments_t)
                                .where(shipments_t.c.id == sid)
                                .values(status="delivered")
                            )
                        continue

                    if progress <= 0.0:
                        continue  # 还没出发

                    lat, lng = interpolate_great_circle(
                        leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"], progress
                    )
                    heading = bearing_deg(leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"])

                    # 速度：相邻 tick 大圆距离 / 时间差；首个 tick 无前值，先留空
                    speed: Optional[float] = None
                    if lid in prev_pos:
                        d_km = haversine_km(prev_pos[lid][0], prev_pos[lid][1], lat, lng)
                        speed = d_km / (settings.advance_minutes / 60.0)
                    prev_pos[lid] = (lat, lng)

                    pos_msg = json.dumps({
                        "leg_id": lid,
                        "lat": round(lat, 6),
                        "lng": round(lng, 6),
                        "speed": round(speed, 2) if speed is not None else None,
                        "heading": round(heading, 2),
                        "ts": ts_iso,
                    })
                    pipe.hset(
                        f"pos:{lid}",
                        mapping={
                            "lat": lat,
                            "lng": lng,
                            "speed": speed if speed is not None else "",
                            "heading": heading,
                            "ts": ts_iso,
                        },
                    )
                    pipe.publish("ch:positions", pos_msg)

                    _check_stall(r, db_ops, events_t, lid, sid, speed, ts_iso, stalled_legs)

                    # 周期性落库，让历史轨迹随时间增长（V1.0 的历史查询才有活数据）
                    persist_acc[lid] = persist_acc.get(lid, 0) + settings.advance_minutes
                    if persist_acc[lid] >= settings.persist_minutes and speed is not None:
                        persist_acc[lid] = 0
                        db_ops.append(
                            insert(points_t).values(
                                leg_id=lid,
                                lat=lat,
                                lng=lng,
                                speed=speed,
                                heading=heading,
                                recorded_at=sim_now,
                                created_at=_utcnow(),
                            )
                        )
                        db_ops.append(
                            update(shipments_t)
                            .where(shipments_t.c.id == sid)
                            .values(latest_lat=lat, latest_lng=lng, latest_ts=sim_now)
                        )

                pipe.execute()

            if db_ops:
                with engine.begin() as conn:
                    for op in db_ops:
                        conn.execute(op)

            time.sleep(settings.tick_seconds)
    except KeyboardInterrupt:
        print("\n[stream] 已停止")


if __name__ == "__main__":
    run()
