"""物流关系网络：口岸/承运商为节点，航线/服务为边，供前端力导向图渲染。

后端一次性聚合成 nodes/edges，前端只负责画力导向布局，不把 shipments 全表拉回浏览器。
聚合在 Python 里算（当前数据量小），避免拼复杂 SQL；返回的图数据本身很小。
"""

from collections import defaultdict

from fastapi import APIRouter
from sqlalchemy import select

from app.api.schemas import NetworkEdge, NetworkGraph, NetworkNode, TopLane
from app.db.models.reference import Carrier, Location
from app.db.models.shipment import Shipment
from app.db.session import SessionDep

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/graph", response_model=NetworkGraph)
async def network_graph(session: SessionDep) -> NetworkGraph:
    """关系网络总入口：口岸↔口岸航线 + 承运商服务口岸，一次返回。

    顺带聚合每个节点的洞察（准点率 / 依赖风险 / 主要合作方），让前端点开节点能直接看到
    「这个口岸/承运商到底怎么样」，而不是只有一张关系示意图。
    """
    ship_rows = (
        await session.execute(
            select(
                Shipment.origin_id,
                Shipment.dest_id,
                Shipment.carrier_id,
                Shipment.status,
                Shipment.planned_arrival,
                Shipment.actual_arrival,
            )
        )
    ).all()
    carriers = {c.id: c for c in (await session.execute(select(Carrier))).scalars()}
    locations = {loc.id: loc for loc in (await session.execute(select(Location))).scalars()}

    lane_counter: dict[tuple[int, int, str | None], int] = defaultdict(int)
    serve_counter: dict[tuple[int, int], int] = defaultdict(int)
    loc_volume: dict[int, int] = defaultdict(int)
    car_volume: dict[int, int] = defaultdict(int)
    # 洞察聚合
    loc_rated: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])  # total, on_time, delayed
    car_rated: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])
    loc_carriers: dict[int, set[int]] = defaultdict(set)  # 服务某口岸的不同承运商
    car_locs: dict[int, set[int]] = defaultdict(set)  # 某承运商服务的不同口岸
    loc_car_cnt: dict[tuple[int, int], int] = defaultdict(int)  # (口岸,承运商)->运量
    car_loc_cnt: dict[tuple[int, int], int] = defaultdict(int)  # (承运商,口岸)->运量

    for origin_id, dest_id, carrier_id, status, planned, actual in ship_rows:
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
                loc_carriers[origin_id].add(carrier_id)
                car_locs[carrier_id].add(origin_id)
                loc_car_cnt[(origin_id, carrier_id)] += 1
                car_loc_cnt[(carrier_id, origin_id)] += 1
            if dest_id is not None:
                serve_counter[(carrier_id, dest_id)] += 1
                loc_carriers[dest_id].add(carrier_id)
                car_locs[carrier_id].add(dest_id)
                loc_car_cnt[(dest_id, carrier_id)] += 1
                car_loc_cnt[(carrier_id, dest_id)] += 1
        # 评分样本：已送达且有齐到达时间，按口岸/承运商累计准点表现
        if status in ("delivered", "delayed") and planned is not None and actual is not None:
            is_on_time = (actual - planned).total_seconds() / 3600 <= 0
            bucket = 1 if is_on_time else 2
            if origin_id is not None:
                loc_rated[origin_id][0] += 1
                loc_rated[origin_id][bucket] += 1
            if dest_id is not None:
                loc_rated[dest_id][0] += 1
                loc_rated[dest_id][bucket] += 1
            if carrier_id is not None:
                car_rated[carrier_id][0] += 1
                car_rated[carrier_id][bucket] += 1

    def top_partners(
        counter: dict[tuple[int, int], int], key: int, name_of: dict[int, object]
    ) -> list[str]:
        pairs = sorted(counter.get(key, {}).items(), key=lambda kv: kv[1], reverse=True)[:5]
        return [name_of[i].name for i, _ in pairs if i in name_of]

    # 节点下钻吞吐量：口岸看 Top 目的港、承运商看 Top 服务口岸，按运量降序取前 5。
    # 直接从已聚合的 lane_counter / car_loc_cnt 派生，不二次扫全表。
    loc_dest: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for (o, d, _m), c in lane_counter.items():
        if o is not None and d is not None:
            loc_dest[o][d] += c
    loc_top: dict[int, list[TopLane]] = {}
    for loc_id, dests in loc_dest.items():
        loc_top[loc_id] = [
            TopLane(label=locations[d].name, count=c)
            for d, c in sorted(dests.items(), key=lambda kv: kv[1], reverse=True)[:5]
            if d in locations
        ]
    car_top: dict[int, list[TopLane]] = {}
    # car_loc_cnt 是 (承运商, 口岸)->运量 的扁平计数，先按承运商聚成嵌套再取 Top 5
    car_ports: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for (cid, lid), c in car_loc_cnt.items():
        car_ports[cid][lid] += c
    for car_id, ports in car_ports.items():
        car_top[car_id] = [
            TopLane(
                label=locations[p].name,
                count=c,
                mode=carriers[car_id].mode if car_id in carriers else None,
            )
            for p, c in sorted(ports.items(), key=lambda kv: kv[1], reverse=True)[:5]
            if p in locations
        ]

    nodes: list[NetworkNode] = []
    for loc_id, vol in loc_volume.items():
        loc = locations.get(loc_id)
        if loc is None:
            continue
        served_by = len(loc_carriers.get(loc_id, set()))
        tr, to, td = loc_rated.get(loc_id, [0, 0, 0])
        nodes.append(
            NetworkNode(
                id=f"loc-{loc_id}",
                label=loc.name,
                type="location",
                volume=vol,
                location_type=loc.type,
                country=loc.country,
                code=loc.code,
                lat=loc.lat,
                lng=loc.lng,
                on_time_rate=round(to / tr, 4) if tr else None,
                risk="single_carrier" if served_by == 1 else None,
                served_by=served_by,
                partners=top_partners(loc_car_cnt, loc_id, carriers),
                top_lanes=loc_top.get(loc_id, []),
            )
        )
    for car_id, vol in car_volume.items():
        car = carriers.get(car_id)
        if car is None:
            continue
        serves = len(car_locs.get(car_id, set()))
        tr, to, td = car_rated.get(car_id, [0, 0, 0])
        nodes.append(
            NetworkNode(
                id=f"car-{car_id}",
                label=car.name,
                type="carrier",
                volume=vol,
                carrier_mode=car.mode,
                on_time_rate=round(to / tr, 4) if tr else None,
                risk="single_port" if serves == 1 else None,
                serves=serves,
                partners=top_partners(car_loc_cnt, car_id, locations),
                top_lanes=car_top.get(car_id, []),
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
