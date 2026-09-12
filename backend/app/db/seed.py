"""基础数据 + 示例运单 seed：幂等，可重复执行。

基础数据（港口 / 承运商 / 示例账号）保证系统开箱可用；
示例运单（一批运输中）让前端看板与地图开箱即有数据可看。
"""

import random
from datetime import datetime, timedelta

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.models.reference import Carrier, Location, User
from app.db.models.shipment import Leg, Order, Shipment
from app.db.models.tracking import ExceptionRecord, MilestoneEvent
from app.db.seed_data import CARRIERS, INLAND, PORTS, ROUTES

# 示例账号：让登录页开箱可用。口令只在 seed 阶段落库，运行期不参与任何逻辑
SAMPLE_USERS: list[tuple[str, str, str]] = [
    ("admin", "admin123", "admin"),
    ("ops", "ops123", "operator"),
]

# 示例在途运单：保证开箱即有运输中数据供看板 / 地图展示
SAMPLE_IN_TRANSIT_COUNT = 20
# 示例已计划运单：让状态筛选「已计划」一档也有数据（出发在未来，只有计划虚线）
SAMPLE_PLANNED_COUNT = 8
# 运单号前缀：用于幂等判断，重复执行不会叠加
_SAMPLE_SHIPMENT_PREFIX = "SHP-INT-"
# 各运输方式典型航程天数（与模拟器对齐，推算出发 / 到货时间）
_SAMPLE_MODE_DAYS: dict[str, float] = {"sea": 28, "air": 1, "rail": 16, "road": 7}
# 货主：示例订单的归属方，与模拟器保持一致
_SAMPLE_CUSTOMERS: list[str] = [
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


def seed_shipments(session: Session) -> int:
    """幂等灌入一批运输中运单：让前端开箱即有在途数据可看。

    每条运单按航线生成多段联运 legs 并标记 in_transit。轨迹点不在此生成
    （由模拟器 / stream 实时产出），这里只写入 legs 与里程碑，并回写
    shipments.latest_lat/lng，使列表页地图点位与链路视图立即可用。
    """
    # 幂等：已存在示例运单则跳过，避免重复执行不断叠加
    existing = session.scalar(
        select(func.count())
        .select_from(Shipment)
        .where(Shipment.shipment_no.like(f"{_SAMPLE_SHIPMENT_PREFIX}%"))
    )
    if existing:
        return 0

    # 港口/内陆仓按 code 建索引，多段联运用 code 区分干线与短驳端点
    locations = {loc.code: loc for loc in session.scalars(select(Location)).all()}
    carriers_by_mode: dict[str, list[Carrier]] = {}
    for c in session.scalars(select(Carrier)).all():
        carriers_by_mode.setdefault(c.mode, []).append(c)

    now = datetime.now()
    drayage_days = 1
    added = 0

    for i in range(SAMPLE_IN_TRANSIT_COUNT):
        route = random.choice(ROUTES)
        origin_code, dest_code, mode = route["origin"], route["dest"], route["mode"]
        if origin_code not in locations or dest_code not in locations:
            continue
        if mode not in carriers_by_mode:
            continue

        origin, dest = locations[origin_code], locations[dest_code]
        carrier = random.choice(carriers_by_mode[mode])
        voyage_days = _SAMPLE_MODE_DAYS.get(mode, 10)

        # 出发在过去航程的 15%~80% 处：进度中段、到货仍在未来，展示效果最好
        departure = now - timedelta(days=voyage_days * random.uniform(0.15, 0.8))
        arrival = departure + timedelta(days=voyage_days + drayage_days * 2)

        # 门到门需要首尾内陆仓；缺了退化成单段干线，保证仍能跑
        o_inland = locations.get(f"W{origin_code}")
        d_inland = locations.get(f"W{dest_code}")
        multimodal = o_inland is not None and d_inland is not None

        order = Order(
            order_no=f"ORD-INT-{now.strftime('%Y%m%d')}-{i + 1:04d}",
            customer_name=random.choice(_SAMPLE_CUSTOMERS),
            status="created",
        )
        session.add(order)
        session.flush()

        shipment = Shipment(
            shipment_no=f"{_SAMPLE_SHIPMENT_PREFIX}{i + 1:04d}",
            status="in_transit",
            order_id=order.id,
            origin_id=origin.id,
            dest_id=dest.id,
            carrier_id=carrier.id,
            planned_departure=departure,
            planned_arrival=arrival,
            actual_departure=departure,
            created_at=now,
        )
        session.add(shipment)
        session.flush()

        # 多段联运：短驳 → 干线 → 短驳；单段则退化成一段干线
        if multimodal:
            segs: list[tuple[int, str, Location, Location, datetime, datetime]] = [
                (1, "road", o_inland, origin, departure, departure + timedelta(days=drayage_days)),
                (
                    2,
                    mode,
                    origin,
                    dest,
                    departure + timedelta(days=drayage_days),
                    departure + timedelta(days=drayage_days + voyage_days),
                ),
                (
                    3,
                    "road",
                    dest,
                    d_inland,
                    departure + timedelta(days=drayage_days + voyage_days),
                    departure + timedelta(days=drayage_days * 2 + voyage_days),
                ),
            ]
        else:
            segs = [(1, mode, origin, dest, departure, arrival)]

        leg_ids: list[int] = []
        for seq, seg_mode, seg_o, seg_d, s_start, s_end in segs:
            leg_status = (
                "completed" if now >= s_end else ("active" if now >= s_start else "planned")
            )
            leg = Leg(
                shipment_id=shipment.id,
                seq=seq,
                mode=seg_mode,
                origin_id=seg_o.id,
                dest_id=seg_d.id,
                planned_start=s_start,
                planned_end=s_end,
                status=leg_status,
            )
            session.add(leg)
            session.flush()
            leg_ids.append(leg.id)

            # 主段最新位置回写 shipments：列表地图点位直接用（简化的线性插值，
            # 真实大圆轨迹由模拟器 / stream 生成）
            if seg_mode == mode:
                prog = (
                    1.0
                    if now >= s_end
                    else 0.0
                    if now <= s_start
                    else (now - s_start).total_seconds() / (s_end - s_start).total_seconds()
                )
                shipment.latest_lat = seg_o.lat + (seg_d.lat - seg_o.lat) * prog
                shipment.latest_lng = seg_o.lng + (seg_d.lng - seg_o.lng) * prog
                shipment.latest_ts = now

        # 里程碑：提货（短驳开始）→ 离港（干线开始）
        events: list[MilestoneEvent] = []
        if multimodal:
            events.append(
                MilestoneEvent(
                    shipment_id=shipment.id,
                    leg_id=leg_ids[0],
                    event_type="picked_up",
                    occurred_at=departure,
                )
            )
        main_leg_id = leg_ids[1] if multimodal else leg_ids[0]
        main_start = segs[1][4] if multimodal else segs[0][4]
        events.append(
            MilestoneEvent(
                shipment_id=shipment.id,
                leg_id=main_leg_id,
                event_type="departed",
                occurred_at=main_start,
            )
        )
        session.add_all(events)
        added += 1

    session.commit()
    return added


def seed_locations(session: Session) -> int:
    """按 code 幂等写入地点：已存在则更新名称与经纬度，不存在则新增。"""
    added = 0
    for item in PORTS + INLAND:
        obj = session.scalar(select(Location).where(Location.code == item["code"]))
        if obj is None:
            session.add(Location(**item))
            added += 1
        else:
            obj.name = item["name"]
            obj.type = item["type"]
            obj.lat = item["lat"]
            obj.lng = item["lng"]
            obj.country = item["country"]
    session.commit()
    return added


def seed_carriers(session: Session) -> int:
    """按 name 幂等写入承运商：已存在则更新运输方式与均速。"""
    added = 0
    for item in CARRIERS:
        obj = session.scalar(select(Carrier).where(Carrier.name == item["name"]))
        if obj is None:
            session.add(Carrier(**item))
            added += 1
        else:
            obj.mode = item["mode"]
            obj.avg_speed = item["avg_speed"]
    session.commit()
    return added


def seed_users(session: Session) -> int:
    """按 username 幂等写入示例账号：已存在则重置口令，保证 seed 之后一定能登录。"""
    added = 0
    for username, password, role in SAMPLE_USERS:
        obj = session.scalar(select(User).where(User.username == username))
        if obj is None:
            session.add(User(username=username, password_hash=hash_password(password), role=role))
            added += 1
        else:
            obj.password_hash = hash_password(password)
            obj.role = role
    session.commit()
    return added


def seed_completed_shipments(session: Session) -> int:
    """幂等灌入一批已送达/延误运单：让分析页的准点率、趋势、延误原因有真实方差，而不是全绿。

    按航线选承运商，计划到达时间散布在过去约 70 天内；约 1/4 判定为延误（实际到达晚于计划），
    并为延误运单写入异常记录（delay/stalled/route_deviation 三类）以撑起「延误原因」图。
    与在途示例运单用不同前缀，互不干扰、可重复执行。
    """
    prefix = "SHP-DONE-"
    existing = session.scalar(
        select(func.count()).select_from(Shipment).where(Shipment.shipment_no.like(f"{prefix}%"))
    )
    if existing:
        return 0

    locations = {loc.code: loc for loc in session.scalars(select(Location)).all()}
    carriers_by_mode: dict[str, list[Carrier]] = {}
    for c in session.scalars(select(Carrier)).all():
        carriers_by_mode.setdefault(c.mode, []).append(c)

    random.seed(20240601)  # 固定随机源，重复 seed 数据一致
    now = datetime.now()
    added = 0
    count = 40

    for i in range(count):
        route = random.choice(ROUTES)
        origin_code, dest_code, mode = route["origin"], route["dest"], route["mode"]
        if (
            origin_code not in locations
            or dest_code not in locations
            or mode not in carriers_by_mode
        ):
            continue
        origin, dest = locations[origin_code], locations[dest_code]
        carrier = random.choice(carriers_by_mode[mode])

        # 计划到达散布在过去 1~70 天，体现时间维度趋势
        planned_arrival = now - timedelta(days=random.uniform(1, 70))
        # 约 75% 准时（实际到达 ≤ 计划），25% 延误（晚 2~72 小时）
        delayed = random.random() < 0.25
        if delayed:
            actual_arrival = planned_arrival + timedelta(hours=random.uniform(2, 72))
            status = "delayed"
        else:
            actual_arrival = planned_arrival - timedelta(hours=random.uniform(0, 12))
            status = "delivered"
        departure = planned_arrival - timedelta(days=_SAMPLE_MODE_DAYS.get(mode, 10))

        order = Order(
            order_no=f"ORD-DONE-{now.strftime('%Y%m%d')}-{i + 1:04d}",
            customer_name=random.choice(_SAMPLE_CUSTOMERS),
            status="created",
        )
        session.add(order)
        session.flush()

        shipment = Shipment(
            shipment_no=f"{prefix}{i + 1:04d}",
            status=status,
            order_id=order.id,
            origin_id=origin.id,
            dest_id=dest.id,
            carrier_id=carrier.id,
            planned_departure=departure,
            planned_arrival=planned_arrival,
            actual_departure=departure,
            actual_arrival=actual_arrival,
            created_at=departure,
        )
        session.add(shipment)
        session.flush()

        # 主段 + 送达里程碑，保证详情页与事件流有内容
        session.add(
            Leg(
                shipment_id=shipment.id,
                seq=1,
                mode=mode,
                origin_id=origin.id,
                dest_id=dest.id,
                planned_start=departure,
                planned_end=planned_arrival,
                status="completed",
            )
        )
        session.add(
            MilestoneEvent(
                shipment_id=shipment.id,
                leg_id=None,
                event_type="delivered" if status == "delivered" else "delayed",
                occurred_at=actual_arrival,
            )
        )
        # 延误运单写异常记录，类型在三类里按权重取，撑起延误原因分析
        if delayed:
            ex_type = random.choices(
                ["delay", "stalled", "route_deviation"],
                weights=[0.6, 0.25, 0.15],
            )[0]
            level = "critical" if random.random() < 0.4 else "warning"
            detail = {
                "delay": "实际到达晚于计划窗口",
                "stalled": "干线在中转港滞留超阈值",
                "route_deviation": "实际航线偏离申报路径",
            }[ex_type]
            session.add(
                ExceptionRecord(
                    shipment_id=shipment.id,
                    type=ex_type,
                    level=level,
                    detail=detail,
                    detected_at=actual_arrival,
                )
            )
        added += 1

    session.commit()
    return added


def seed_planned_shipments(session: Session) -> int:
    """幂等灌入一批「已计划」运单：让状态筛选的每一档都有数据。

    已计划 = 订单已建、运输尚未开始：出发时间在未来，legs 全是 planned，
    不写里程碑（还没有任何事发生），也不回写 latest 坐标（还没开跑）。
    这样地图上只出现计划虚线、不会出现船位点，与实际业务语义一致。
    与在途 / 已送达用不同前缀，互不干扰、可重复执行。
    """
    prefix = "SHP-PLAN-"
    existing = session.scalar(
        select(func.count()).select_from(Shipment).where(Shipment.shipment_no.like(f"{prefix}%"))
    )
    if existing:
        return 0

    locations = {loc.code: loc for loc in session.scalars(select(Location)).all()}
    carriers_by_mode: dict[str, list[Carrier]] = {}
    for c in session.scalars(select(Carrier)).all():
        carriers_by_mode.setdefault(c.mode, []).append(c)

    random.seed(20240701)  # 固定随机源，重复 seed 数据一致
    now = datetime.now()
    drayage_days = 1
    added = 0

    for i in range(SAMPLE_PLANNED_COUNT):
        route = random.choice(ROUTES)
        origin_code, dest_code, mode = route["origin"], route["dest"], route["mode"]
        if (
            origin_code not in locations
            or dest_code not in locations
            or mode not in carriers_by_mode
        ):
            continue
        origin, dest = locations[origin_code], locations[dest_code]
        carrier = random.choice(carriers_by_mode[mode])
        voyage_days = _SAMPLE_MODE_DAYS.get(mode, 10)

        # 出发在未来 1~14 天：近期要走的货，控制塔排产视角下才有意义
        departure = now + timedelta(days=random.uniform(1, 14))
        arrival = departure + timedelta(days=voyage_days + drayage_days * 2)

        o_inland = locations.get(f"W{origin_code}")
        d_inland = locations.get(f"W{dest_code}")
        multimodal = o_inland is not None and d_inland is not None

        order = Order(
            order_no=f"ORD-PLAN-{now.strftime('%Y%m%d')}-{i + 1:04d}",
            customer_name=random.choice(_SAMPLE_CUSTOMERS),
            status="created",
        )
        session.add(order)
        session.flush()

        shipment = Shipment(
            shipment_no=f"{prefix}{i + 1:04d}",
            status="planned",
            order_id=order.id,
            origin_id=origin.id,
            dest_id=dest.id,
            carrier_id=carrier.id,
            planned_departure=departure,
            planned_arrival=arrival,
            created_at=now,
        )
        session.add(shipment)
        session.flush()

        # 段结构与在途单一致（短驳 → 干线 → 短驳），但全部 planned
        if multimodal:
            segs: list[tuple[int, str, Location, Location, datetime, datetime]] = [
                (1, "road", o_inland, origin, departure, departure + timedelta(days=drayage_days)),
                (
                    2,
                    mode,
                    origin,
                    dest,
                    departure + timedelta(days=drayage_days),
                    departure + timedelta(days=drayage_days + voyage_days),
                ),
                (
                    3,
                    "road",
                    dest,
                    d_inland,
                    departure + timedelta(days=drayage_days + voyage_days),
                    departure + timedelta(days=drayage_days * 2 + voyage_days),
                ),
            ]
        else:
            segs = [(1, mode, origin, dest, departure, arrival)]
        for seq, seg_mode, seg_o, seg_d, s_start, s_end in segs:
            session.add(
                Leg(
                    shipment_id=shipment.id,
                    seq=seq,
                    mode=seg_mode,
                    origin_id=seg_o.id,
                    dest_id=seg_d.id,
                    planned_start=s_start,
                    planned_end=s_end,
                    status="planned",
                )
            )
        added += 1

    session.commit()
    return added


def main() -> None:
    engine = create_engine(settings.mysql_dsn_sync, future=True)
    with Session(engine) as session:
        added_locations = seed_locations(session)
        added_carriers = seed_carriers(session)
        added_users = seed_users(session)
        added_in_transit = seed_shipments(session)
        added_done = seed_completed_shipments(session)
        added_planned = seed_planned_shipments(session)

    print(
        f"新增地点 {added_locations} 个，新增承运商 {added_carriers} 个，新增账号 {added_users} 个"
    )
    print(
        f"地点总数 {len(PORTS) + len(INLAND)}"
        f"（港口 {len(PORTS)} + 内陆仓 {len(INLAND)}），"
        f"承运商总数 {len(CARRIERS)}（已存在则更新，不重复插入）"
    )
    print(f"示例账号：{', '.join(f'{u} / {p}' for u, p, _ in SAMPLE_USERS)}")
    print(
        f"新增示例运单 {added_in_transit} 条（运输中），{added_done} 条（已送达/延误），"
        f"{added_planned} 条（已计划）"
    )


if __name__ == "__main__":
    main()
