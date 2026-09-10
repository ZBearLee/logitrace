"""按两条硬规则就地校正现有数据，不新增任何运单；幂等，可重复执行。

规则：
  已送达 delivered  -> 所有段 completed，轨迹点补齐为完整大圆 0→1，实线从起点连到终点。
  运输中 in_transit / delayed ->
      已走完的段（now >= planned_end）completed 且点补完整到终点（实线）；
      正在走的段（planned_start < now < planned_end）active，点补到当前进度（实线止于此）；
      未开始的段 planned，无轨迹点（这段由前端画虚线）。
"""

import argparse
from datetime import datetime, timedelta, timezone

from sqlalchemy import MetaData, Table, create_engine, delete, func, select, text, update

from config import settings
from geo import bearing_deg, interpolate_great_circle


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def leg_progress(start: datetime, end: datetime, now: datetime) -> float:
    if now >= end:
        return 1.0
    if now <= start:
        return 0.0
    total = (end - start).total_seconds()
    if total <= 0:
        return 1.0
    return (now - start).total_seconds() / total


def build_leg_points(leg_id: int, o_lat: float, o_lng: float, d_lat: float,
                     d_lng: float, start: datetime, end: datetime,
                     target_t: float, now: datetime) -> list[dict]:
    """沿大圆插值出 0→target_t 的点；target_t=1 即延伸到终点，保证实线完整。"""
    days = (end - start).total_seconds() / 86400
    total = max(16, min(80, int(days * 3) + 16))
    heading = bearing_deg(o_lat, o_lng, d_lat, d_lng)
    if target_t >= 1.0:
        count = total + 1
        denom = total
    else:
        count = max(2, int(total * target_t))
        denom = count - 1
    out: list[dict] = []
    for k in range(count):
        t = (k / denom) if denom else 1.0
        if target_t < 1.0:
            t = target_t * (k / denom) if denom else target_t
        lat, lng = interpolate_great_circle(o_lat, o_lng, d_lat, d_lng, t)
        out.append(
            {
                "leg_id": leg_id,
                "lat": lat,
                "lng": lng,
                "speed": 0,
                "heading": heading,
                "recorded_at": start + timedelta(days=days * t),
                "created_at": now,
            }
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="校正运单轨迹与段状态")
    parser.add_argument("--apply", action="store_true", help="真正写库；不加则只预演")
    args = parser.parse_args()

    engine = create_engine(settings.mysql_dsn_sync, future=True)
    metadata = MetaData()
    legs_t = Table("legs", metadata, autoload_with=engine)
    points_t = Table("position_points", metadata, autoload_with=engine)
    shipments_t = Table("shipments", metadata, autoload_with=engine)
    locations_t = Table("locations", metadata, autoload_with=engine)
    origin = locations_t.alias("origin")
    dest = locations_t.alias("dest")

    now = _utcnow()
    print(f"基准时间 {now.isoformat()}Z，{'写库模式' if args.apply else '预演模式（加 --apply 才写）'}")

    with engine.begin() as conn:
        legs = conn.execute(
            select(
                legs_t.c.id,
                legs_t.c.shipment_id,
                legs_t.c.seq,
                legs_t.c.status,
                legs_t.c.planned_start,
                legs_t.c.planned_end,
                legs_t.c.origin_id,
                legs_t.c.dest_id,
                origin.c.lat.label("o_lat"),
                origin.c.lng.label("o_lng"),
                dest.c.lat.label("d_lat"),
                dest.c.lng.label("d_lng"),
            )
            .select_from(legs_t.join(origin, legs_t.c.origin_id == origin.c.id)
                         .join(dest, legs_t.c.dest_id == dest.c.id))
        ).mappings().all()

        ship_status = {
            r["id"]: r["status"]
            for r in conn.execute(select(shipments_t.c.id, shipments_t.c.status)).mappings()
        }

        fixed_legs = 0
        fixed_pts = 0
        for leg in legs:
            sid = leg["shipment_id"]
            st = ship_status.get(sid)
            if st is None:
                continue
            if None in (leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"]):
                continue

            if st == "delivered":
                # 硬性要求：已送达 -> 段全部完成、点补齐到终点
                new_status, target_t = "completed", 1.0
            else:
                p = leg_progress(leg["planned_start"], leg["planned_end"], now)
                if p >= 1.0:
                    new_status, target_t = "completed", 1.0
                elif p <= 0.0:
                    new_status, target_t = "planned", 0.0
                else:
                    new_status, target_t = "active", p

            pts = build_leg_points(
                leg["id"], leg["o_lat"], leg["o_lng"], leg["d_lat"], leg["d_lng"],
                leg["planned_start"], leg["planned_end"], target_t, now,
            ) if target_t > 0 else []

            cur_cnt = conn.execute(
                select(func.count()).select_from(points_t).where(points_t.c.leg_id == leg["id"])
            ).scalar()

            need = new_status != leg["status"] or pts != cur_cnt
            if need:
                fixed_legs += 1
            if pts != cur_cnt:
                fixed_pts += 1
            if args.apply:
                conn.execute(delete(points_t).where(points_t.c.leg_id == leg["id"]))
                if pts:
                    conn.execute(points_t.insert(), pts)
                if new_status != leg["status"]:
                    conn.execute(
                        update(legs_t).where(legs_t.c.id == leg["id"]).values(status=new_status)
                    )
                if pts:
                    conn.execute(
                        update(shipments_t)
                        .where(shipments_t.c.id == sid)
                        .values(latest_lat=pts[-1]["lat"], latest_lng=pts[-1]["lng"],
                                latest_ts=pts[-1]["recorded_at"])
                    )

        # 已送达却缺 actual_arrival 的是脏数据（之前才有机会出现），兜底补上
        rows = conn.execute(
            text("SELECT COUNT(*) FROM shipments WHERE status='delivered' AND actual_arrival IS NULL")
        ).scalar()
        print(f"delivered 但 actual_arrival 为空: {rows}")
        if args.apply and rows:
            conn.execute(
                text("UPDATE shipments SET actual_arrival=planned_arrival "
                     "WHERE status='delivered' AND actual_arrival IS NULL")
            )

    print(f"需修段数={fixed_legs}，点数不符的段={fixed_pts}")


if __name__ == "__main__":
    main()
