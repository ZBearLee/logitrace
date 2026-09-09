"""基础数据 seed：把港口和承运商写入数据库（幂等，可重复执行）。"""

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models.reference import Carrier, Location
from app.db.seed_data import CARRIERS, INLAND, PORTS


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


def main() -> None:
    engine = create_engine(settings.mysql_dsn_sync, future=True)
    with Session(engine) as session:
        added_locations = seed_locations(session)
        added_carriers = seed_carriers(session)

    print(f"新增地点 {added_locations} 个，新增承运商 {added_carriers} 个")
    print(
        f"地点总数 {len(PORTS) + len(INLAND)}"
        f"（港口 {len(PORTS)} + 内陆仓 {len(INLAND)}），"
        f"承运商总数 {len(CARRIERS)}（已存在则更新，不重复插入）"
    )


if __name__ == "__main__":
    main()
