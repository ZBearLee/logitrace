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
from decimal import Decimal
from typing import Optional

import redis
from sqlalchemy import MetaData, Table, create_engine, insert, select, update

from config import settings
from geo import bearing_deg, haversine_km, interpolate_great_circle


def _utcnow() -> datetime:
    """MySQL 的 DateTime 不带时区，统一存 UTC 的 naive datetime。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _json_default(o):
    """json.dumps 兜底：DB 反射回来的坐标可能是 Decimal，转成 float 再序列化。"""
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")


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
        rows = conn.execute(stmt).mappings().all()
    # 经纬度从库里反射回来可能是 Decimal（locations.lat/lng 的实际列类型），
    # round(Decimal, 6) 仍是 Decimal，而 json.dumps 不认 Decimal、Redis 也存不进去。
    # 统一转 float，后续插值 / 序列化 / 写 Redis 都不再踩坑。
    return [
        {
            **m,
            "o_lat": float(m["o_lat"]),
            "o_lng": float(m["o_lng"]),
            "d_lat": float(m["d_lat"]),
            "d_lng": float(m["d_lng"]),
        }
        for m in rows
    ]


def _emit_event(
    r: redis.Redis,
    db_ops: list,
    events_t: Table,
    shipment_id: int,
    leg_id: int,
    event_type: str,
    occurred_at: str,
    payload_json: Optional[str],
) -> None:
    """里程碑事件：同时落 milestone_events 表（通知中心/事件流的数据源）并推送到 WS 频道。"""
    db_ops.append(
        insert(events_t).values(
            shipment_id=shipment_id,
            leg_id=leg_id,
            event_type=event_type,
            occurred_at=occurred_at,
            payload_json=payload_json,
            created_at=_utcnow(),
        )
    )
    msg = json.dumps(
        {
            "shipment_id": shipment_id,
            "leg_id": leg_id,
            "event_type": event_type,
            "occurred_at": occurred_at,
            "payload_json": payload_json,
        }
    )
    r.publish("ch:events", msg)


def _check_stall(
    r: redis.Redis,
    db_ops: list,
    events_t: Table,
    exc_t: Table,
    leg_id: int,
    shipment_id: int,
    speed: Optional[float],
    ts_iso: str,
) -> None:
    """Sorted Set 滑动窗口判滞留：窗口内速度持续低于阈值则写异常记录并推事件。

    已判滞留的段用 Redis Set 去重（key=stalled_legs），stream 重启后也不会重复插异常。
    """
    if speed is None:
        return
    score = time.time()
    member = f"{score:.3f}:{speed:.3f}"
    r.zadd(f"speed:{leg_id}", {member: score})
    r.zremrangebyrank(f"speed:{leg_id}", 0, -1 - settings.stall_window)
    if r.sismember("stalled_legs", leg_id):
        return
    items = r.zrange(f"speed:{leg_id}", 0, -1)
    if len(items) < settings.stall_window:
        return
    speeds = [float(m.decode().split(":")[1]) for m in items]
    if all(s < settings.stall_speed for s in speeds):
        r.sadd("stalled_legs", leg_id)
        payload = json.dumps({"speed": round(speed, 2)})
        # 滞留事件落 milestone_events 表，同时推 WS 频道
        _emit_event(
            r, db_ops, events_t, shipment_id, leg_id, "stalled", ts_iso, payload
        )
        # 滞留必须同时落 exception_records（异常中心的数据源），否则异常中心永远为空。
        db_ops.append(
            insert(exc_t).values(
                shipment_id=shipment_id,
                type="stalled",
                level="warning",
                detail=f"近 {settings.stall_window} 个位置点速度持续低于 {settings.stall_speed} km/h",
                detected_at=ts_iso,
                resolved_at=None,
            )
        )


def run() -> None:
    engine = create_engine(settings.mysql_dsn_sync, future=True)
    metadata = MetaData()
    points_t = Table("position_points", metadata, autoload_with=engine)
    legs_t = Table("legs", metadata, autoload_with=engine)
    shipments_t = Table("shipments", metadata, autoload_with=engine)
    events_t = Table("milestone_events", metadata, autoload_with=engine)
    exc_t = Table("exception_records", metadata, autoload_with=engine)

    r = redis.Redis.from_url(settings.redis_url)

    # 仿真时钟恒等于真实时间（1:1 推进），不再做任何倍速累加。
    # 过去每 tick 无条件 += advance_minutes，进程连续跑几天后仿真时钟会甩过所有在途段的
    # planned_end，把"运输中"运单瞬间判成已完成并改成已送达，运输中状态根本留不住。
    # 现在段是否完成只由真实时间与 planned_end 的先后决定，推进天然随时间线性增长。
    sim_now = _utcnow()
    prev_pos: dict[
        int, tuple[float, float]
    ] = {}  # leg_id -> 上一 tick 位置，用于算速度
    stall_windows: dict[int, datetime] = {}  # leg_id -> 滞留注入到期时间
    stall_registered: set[int] = set()  # 已注册滞留注入的 leg，避免重复注册
    completed: dict[int, set[int]] = {}  # shipment_id -> 已完成 leg 集合
    persist_acc: dict[int, float] = {}  # leg_id -> 已累计未落库的真实秒数
    ship_legs: dict[int, set[int]] = {}  # shipment_id -> 该运单所有段（判全完成）

    print(
        f"[stream] 启动，1:1 真实时间驱动（仿真时钟 = utcnow），"
        f"轮询间隔 {settings.tick_seconds}s，每 {settings.persist_seconds}s 落一个轨迹点"
    )
    try:
        while True:
            # 每 tick 重新对齐真实时间，避免累加导致仿真时钟无限超前（见 run() 顶部说明）
            sim_now = _utcnow()
            ts_iso = sim_now.isoformat()

            legs = _load_active_legs(engine, metadata)
            for leg in legs:
                ship_legs.setdefault(leg["shipment_id"], set()).add(leg["id"])

            db_ops: list = []
            with r.pipeline() as pipe:
                for leg in legs:
                    lid = leg["id"]
                    sid = leg["shipment_id"]
                    progress = _leg_progress(
                        leg["planned_start"], leg["planned_end"], sim_now
                    )

                    # 段刚开始（planned -> active）：发 departed 里程碑
                    if leg["status"] == "planned" and progress > 0:
                        db_ops.append(
                            update(legs_t)
                            .where(legs_t.c.id == lid)
                            .values(status="active")
                        )
                        _emit_event(
                            r, db_ops, events_t, sid, lid, "departed", ts_iso, None
                        )
                        # 实际出发时间写回 shipments，详情页「实际出发」才有值；
                        # 只在为空时写：多段联运后续段的出发不该覆盖整单的实际出发。
                        db_ops.append(
                            update(shipments_t)
                            .where(shipments_t.c.id == sid)
                            .where(shipments_t.c.actual_departure.is_(None))
                            .values(actual_departure=ts_iso)
                        )

                    if progress >= 1.0:
                        # 段完成：标记完成 + 发里程碑；最后一个段完成触发 delivered。
                        # 关键点：把该段轨迹整条补齐到终点（而非只补 1 个点）。否则历史轨迹点
                        # 只覆盖到被标完成前的那一处，已送达运单的实线会在起点/中途就断掉。
                        completed.setdefault(sid, set()).add(lid)
                        db_ops.append(
                            update(legs_t)
                            .where(legs_t.c.id == lid)
                            .values(status="completed")
                        )
                        if leg["mode"] != "road":
                            _emit_event(
                                r, db_ops, events_t, sid, lid, "arrived", ts_iso, None
                            )
                        if completed[sid] >= ship_legs.get(sid, set()):
                            _emit_event(
                                r, db_ops, events_t, sid, lid, "delivered", ts_iso, None
                            )
                            # 实际到达与状态一起写：一致性口径要求 delivered 必有 actual_arrival，
                            # 否则详情页「实际到达」永远是「—」，还得靠 fix_tracks.py 事后补。
                            db_ops.append(
                                update(shipments_t)
                                .where(shipments_t.c.id == sid)
                                .values(status="delivered", actual_arrival=ts_iso)
                            )
                        # 删除该段已有（可能只到半途）的点，再写入完整大圆轨迹 0→1，
                        # 保证已送达后实线从起点连到终点。
                        db_ops.append(points_t.delete().where(points_t.c.leg_id == lid))
                        days = (
                            leg["planned_end"] - leg["planned_start"]
                        ).total_seconds() / 86400
                        n = max(16, min(80, int(days * 3) + 16))
                        heading = bearing_deg(
                            leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"]
                        )
                        for k in range(n + 1):
                            t = k / n
                            plat, plng = interpolate_great_circle(
                                leg["o_lat"],
                                leg["o_lng"],
                                leg["d_lat"],
                                leg["d_lng"],
                                t,
                            )
                            db_ops.append(
                                insert(points_t).values(
                                    leg_id=lid,
                                    lat=plat,
                                    lng=plng,
                                    speed=0,
                                    heading=heading,
                                    recorded_at=leg["planned_start"]
                                    + timedelta(days=days * t),
                                    created_at=_utcnow(),
                                )
                            )
                        db_ops.append(
                            update(shipments_t)
                            .where(shipments_t.c.id == sid)
                            .values(
                                latest_lat=leg["d_lat"],
                                latest_lng=leg["d_lng"],
                                latest_ts=leg["planned_end"],
                            )
                        )
                        continue

                    if progress <= 0.0:
                        continue  # 还没出发

                    # 滞留注入：少数在途段注册一个短暂冻结窗口（位置冻结、速度记 0），
                    # 让滑动窗口判滞留能产出真实异常，异常中心才有内容可展示。
                    # 注册点放在「已在途」这里，而不是 planned→active 的跃迁那一 tick：
                    # seed 生成的在途运单当前段本来就是 active，抓不到跃迁，
                    # 异常中心会一直没数据。
                    if lid % 9 == 0 and lid not in stall_registered:
                        stall_windows[lid] = sim_now + timedelta(seconds=90)
                        stall_registered.add(lid)

                    # 滞留注入：少数在途段短暂"卡住"（位置冻结、速度记 0），
                    # 让滑动窗口判滞留能产出真实异常数据，异常中心才有内容可展示。
                    # 冻结只在前序窗口内生效，到期自动恢复正常推进。
                    if lid in stall_windows and sim_now < stall_windows[lid]:
                        fl_heading = bearing_deg(
                            leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"]
                        )
                        lat, lng = prev_pos.get(lid, (leg["o_lat"], leg["o_lng"]))
                        speed = 0.0
                        prev_pos[lid] = (lat, lng)
                        pos_msg = json.dumps(
                            {
                                "leg_id": lid,
                                "lat": round(lat, 6),
                                "lng": round(lng, 6),
                                "speed": 0,
                                "heading": round(fl_heading, 2),
                                "ts": ts_iso,
                            },
                            default=_json_default,
                        )
                        pipe.hset(
                            f"pos:{lid}",
                            mapping={
                                "lat": lat,
                                "lng": lng,
                                "speed": 0,
                                "heading": fl_heading,
                                "ts": ts_iso,
                            },
                        )
                        pipe.publish("ch:positions", pos_msg)
                        _check_stall(
                            r, db_ops, events_t, exc_t, lid, sid, speed, ts_iso
                        )
                        continue

                    lat, lng = interpolate_great_circle(
                        leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"], progress
                    )
                    heading = bearing_deg(
                        leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"]
                    )

                    # 速度：相邻 tick 大圆距离 / 时间差；首个 tick 无前值，先留空
                    speed: Optional[float] = None
                    if lid in prev_pos:
                        d_km = haversine_km(
                            prev_pos[lid][0], prev_pos[lid][1], lat, lng
                        )
                        # 1:1 真实推进：一个 tick 的真实间隔是 tick_seconds 秒，
                        # 按真实耗时折算才得到 km/h；若沿用旧的"仿真分钟"口径会把速度
                        # 算小约 60 倍，导致正常行驶也被误判成滞留。
                        speed = d_km / (settings.tick_seconds / 3600.0)
                    prev_pos[lid] = (lat, lng)

                    pos_msg = json.dumps(
                        {
                            "leg_id": lid,
                            "lat": round(lat, 6),
                            "lng": round(lng, 6),
                            "speed": round(speed, 2) if speed is not None else None,
                            "heading": round(heading, 2),
                            "ts": ts_iso,
                        },
                        default=_json_default,
                    )
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

                    _check_stall(r, db_ops, events_t, exc_t, lid, sid, speed, ts_iso)

                    # 周期性落库，让历史轨迹随时间增长（历史轨迹查询才有活数据）
                    persist_acc[lid] = persist_acc.get(lid, 0) + settings.tick_seconds
                    if (
                        persist_acc[lid] >= settings.persist_seconds
                        and speed is not None
                    ):
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
