"""造短程样例运单：1:1 真实时间下肉眼可见移动。

思路：不扭曲仿真时钟（那是把在途秒成已送达、并引发后续一连串 bug 的根源），
而是把行程本身缩短到十分钟级别——时钟恒等于真实时间，planned_start/end 语义
始终自洽；行程短，1:1 推进下肉眼就能看到位置在走、看到实线增长虚线缩短。
"""

import argparse
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import MetaData, Table, create_engine, insert, select, update

from config import settings
from main import CUSTOMERS, Seg, build_points, leg_progress

# 短程路线：起终点 code、运输方式、行程分钟数。
# 选横跨距离大的组合，缩短行程后位移在全球视野下才明显。
SHORT_ROUTES: list[tuple[str, str, str, int]] = [
    ("WUSNYC", "WUSLAX", "road", 10),  # 纽约 -> 洛杉矶，10 分钟走完
    ("WDEHAM", "WNLRTM", "road", 30),  # 汉堡 -> 鹿特丹，30 分钟走完
]

POINTS = 60


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def make_short_haul(apply: bool) -> None:
    engine = create_engine(settings.mysql_dsn_sync, future=True)
    metadata = MetaData()
    locations_t = Table("locations", metadata, autoload_with=engine)
    carriers_t = Table("carriers", metadata, autoload_with=engine)
    orders_t = Table("orders", metadata, autoload_with=engine)
    shipments_t = Table("shipments", metadata, autoload_with=engine)
    legs_t = Table("legs", metadata, autoload_with=engine)
    points_t = Table("position_points", metadata, autoload_with=engine)

    now = _utcnow()
    print(
        f"基准时间 {now.isoformat()}Z，{'写库模式' if apply else '预演模式（加 --apply 才写）'}"
    )

    with engine.begin() as conn:
        locs = {r.code: (r.id, r.lat, r.lng) for r in conn.execute(select(locations_t))}
        carrier_row = conn.execute(
            select(carriers_t).where(carriers_t.c.mode == "road")
        ).first()
        if carrier_row is None:
            print("没有 road 承运商，退出")
            return
        carrier_id, road_speed = carrier_row.id, carrier_row.avg_speed

        for o_code, d_code, mode, minutes in SHORT_ROUTES:
            if o_code not in locs or d_code not in locs:
                print(f"  跳过 {o_code}->{d_code}：locations 里没有该 code")
                continue
            o_id, o_lat, o_lng = locs[o_code]
            d_id, d_lat, d_lng = locs[d_code]

            start = now
            end = now + timedelta(minutes=minutes)
            stamp = now.strftime("%Y%m%d%H%M%S")
            shipment_no = f"SHP-SHORT{minutes:02d}-{stamp}"

            if apply:
                res = conn.execute(
                    insert(orders_t).values(
                        order_no=f"ORD-SHORT{minutes:02d}-{stamp}",
                        customer_name=random.choice(CUSTOMERS),
                        status="created",
                        created_at=now,
                    )
                )
                order_id = res.inserted_primary_key[0]

                res = conn.execute(
                    insert(shipments_t).values(
                        shipment_no=shipment_no,
                        status="in_transit",
                        order_id=order_id,
                        origin_id=o_id,
                        dest_id=d_id,
                        carrier_id=carrier_id,
                        planned_departure=start,
                        planned_arrival=end,
                        actual_departure=start,
                        actual_arrival=None,
                        created_at=now,
                    )
                )
                sid = res.inserted_primary_key[0]

                res = conn.execute(
                    insert(legs_t).values(
                        shipment_id=sid,
                        seq=1,
                        mode=mode,
                        origin_id=o_id,
                        dest_id=d_id,
                        planned_start=start,
                        planned_end=end,
                        status="active",
                    )
                )
                lid = res.inserted_primary_key[0]

                seg = Seg(
                    1,
                    mode,
                    o_id,
                    d_id,
                    o_lat,
                    o_lng,
                    d_lat,
                    d_lng,
                    start,
                    end,
                    POINTS,
                    road_speed,
                )
                pts = build_points(seg, lid, leg_progress(start, end, now), now)
                if pts:
                    conn.execute(insert(points_t), pts)
                    conn.execute(
                        update(shipments_t)
                        .where(shipments_t.c.id == sid)
                        .values(
                            latest_lat=pts[-1]["lat"],
                            latest_lng=pts[-1]["lng"],
                            latest_ts=pts[-1]["recorded_at"],
                        )
                    )

            print(
                f"  {shipment_no}: {o_code} -> {d_code}，行程 {minutes} 分钟"
                f"（{start.strftime('%H:%M:%S')} -> {end.strftime('%H:%M:%S')}）"
            )


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="造短程样例运单")
    ap.add_argument("--apply", action="store_true", help="真正写库")
    args = ap.parse_args()
    make_short_haul(args.apply)
