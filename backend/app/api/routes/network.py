"""物流关系网络：口岸/承运商为节点，航线/服务为边，供前端力导向图渲染。

后端一次性聚合成 nodes/edges，前端只负责画力导向布局，不把 shipments 全表拉回浏览器。
聚合在 Python 里算（demo 数据量小），避免拼复杂 SQL；返回的图数据本身很小。
"""

from collections import defaultdict

from fastapi import APIRouter
from sqlalchemy import select

from app.api.schemas import NetworkEdge, NetworkGraph, NetworkNode
from app.db.models.reference import Carrier, Location
from app.db.models.shipment import Shipment
from app.db.session import SessionDep

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/graph", response_model=NetworkGraph)
async def network_graph(session: SessionDep) -> NetworkGraph:
    """关系网络总入口：口岸↔口岸航线 + 承运商服务口岸，一次返回。"""
    ship_rows = (
        await session.execute(select(Shipment.origin_id, Shipment.dest_id, Shipment.carrier_id))
    ).all()
    carriers = {c.id: c for c in (await session.execute(select(Carrier))).scalars()}
    locations = {loc.id: loc for loc in (await session.execute(select(Location))).scalars()}

    lane_counter: dict[tuple[int, int, str | None], int] = defaultdict(int)
    serve_counter: dict[tuple[int, int], int] = defaultdict(int)
    loc_volume: dict[int, int] = defaultdict(int)
    car_volume: dict[int, int] = defaultdict(int)

    for origin_id, dest_id, carrier_id in ship_rows:
        mode = carriers[carrier_id].mode if carrier_id in carriers else None
        if origin_id is not None:
            loc_volume[origin_id] += 1
        if dest_id is not None:
            loc_volume[dest_id] += 1
        if carrier_id is not None:
            car_volume[carrier_id] += 1
        if origin_id is not None and dest_id is not None:
            lane_counter[(origin_id, dest_id, mode)] += 1
        if carrier_id is not None:
            if origin_id is not None:
                serve_counter[(carrier_id, origin_id)] += 1
            if dest_id is not None:
                serve_counter[(carrier_id, dest_id)] += 1

    nodes: list[NetworkNode] = []
    for loc_id, vol in loc_volume.items():
        loc = locations.get(loc_id)
        if loc is None:
            continue
        nodes.append(
            NetworkNode(
                id=f"loc-{loc_id}",
                label=loc.name,
                type="location",
                volume=vol,
                location_type=loc.type,
                country=loc.country,
            )
        )
    for car_id, vol in car_volume.items():
        car = carriers.get(car_id)
        if car is None:
            continue
        nodes.append(
            NetworkNode(
                id=f"car-{car_id}",
                label=car.name,
                type="carrier",
                volume=vol,
                carrier_mode=car.mode,
            )
        )

    edges: list[NetworkEdge] = []
    for (origin_id, dest_id, mode), cnt in lane_counter.items():
        edges.append(
            NetworkEdge(
                source=f"loc-{origin_id}",
                target=f"loc-{dest_id}",
                type="lane",
                weight=cnt,
                mode=mode,
            )
        )
    for (car_id, loc_id), cnt in serve_counter.items():
        edges.append(
            NetworkEdge(
                source=f"car-{car_id}",
                target=f"loc-{loc_id}",
                type="serve",
                weight=cnt,
            )
        )

    return NetworkGraph(nodes=nodes, edges=edges)
