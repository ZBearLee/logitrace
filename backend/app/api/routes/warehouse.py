"""仓库数字孪生：一次返回库位布局 + 月台状态 + 在库作业任务，供 Three.js 场景渲染。

数据从哪来：库位不在域模型（5.1 表清单）里，这里**按「仓库 id + 固定种子」确定性生成**——
同一仓库每次请求布局完全一致，可复现、可点选；接入真实 WMS 时把生成逻辑
换成读库位表即可，前端契约（WarehouseLayout）不变。

为什么不建库位表：库位布局只需支撑 Three.js 渲染与联动展示，建表要动 Alembic 迁移、
依赖本地能跑迁移命令；而占用率仍由该仓库的**真实运单量**推导，并非纯随机数。
"""

import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import exists, func, or_, select

from app.api.deps import current_user
from app.api.schemas import (
    WarehouseDock,
    WarehouseFlow,
    WarehouseLayout,
    WarehouseSlot,
)
from app.db.models.reference import Location
from app.db.models.shipment import Leg, Shipment
from app.db.session import SessionDep

router = APIRouter(prefix="/warehouse", tags=["warehouse"], dependencies=[Depends(current_user)])

# 库位规模：32 列 × 16 行 × 2 层 = 1024 个，正好够体现 InstancedMesh 的价值
# （1024 个独立 Mesh 会明显掉帧，一个 InstancedMesh 只占一次 draw call）。
COLS = 32
ROWS = 16
LEVELS = 2
DOCKS = 6
# 作业任务数量：同时搬运的运单数，太多会看不清
MAX_FLOWS = 8


@router.get("/{location_id}/layout", response_model=WarehouseLayout)
async def warehouse_layout(session: SessionDep, location_id: int) -> WarehouseLayout:
    """仓库 3D 场景数据源：库位占用 + 月台状态 + 在库作业任务。

    占用率由该仓库关联的真实运单量推导（关联越多越满），库位与运单的绑定关系
    由固定种子决定，保证同一仓库每次刷新位置不变。
    """
    loc = (
        await session.execute(select(Location).where(Location.id == location_id))
    ).scalar_one_or_none()
    if loc is None:
        raise HTTPException(status_code=404, detail="地点不存在")
    if loc.type != "warehouse":
        raise HTTPException(status_code=404, detail="该地点不是仓库，无 3D 场景")

    # 与该仓库相关的运单：总起止港之一，或任意运输段经过该仓库。
    # 仓库通常是联运中的中间节点（陆运/铁运段），只查 shipments.origin_id/dest_id 会漏掉。
    leg_involved = exists().where(
        Leg.shipment_id == Shipment.id,
        or_(Leg.origin_id == location_id, Leg.dest_id == location_id),
    )
    involved_where = or_(
        Shipment.origin_id == location_id,
        Shipment.dest_id == location_id,
        leg_involved,
    )
    involved = (
        await session.scalar(select(func.count()).select_from(Shipment).where(involved_where))
    ) or 0
    ships = (
        await session.scalars(
            select(Shipment).where(involved_where).order_by(Shipment.id.desc()).limit(40)
        )
    ).all()

    # 占用率：关联运单越多越满，夹在 45%~90% 之间。
    # 下限取 45% 而非更低——当前数据量下真实占比可能只有一成多，
    # 满屏空位既看不出「千库位」的规模感，也让 InstancedMesh 的颜色分层失去意义。
    rate = min(0.9, max(0.45, involved / 40))

    # 固定种子：同一仓库布局每次一致（random.Random 对 str 种子做 sha512，跨进程可复现）
    rnd = random.Random(f"wh-{location_id}")

    slots: list[WarehouseSlot] = []
    occupied_idx: list[int] = []
    for idx in range(COLS * ROWS * LEVELS):
        level = idx % LEVELS
        col = (idx // LEVELS) % COLS
        row = idx // (LEVELS * COLS)
        # 底层更满：贴近拣货面，上层相对空——真实仓库的普遍形态
        p = rate * (1.15 if level == 0 else 0.8)
        roll = rnd.random()
        if roll < p and ships:
            ship = ships[len(occupied_idx) % len(ships)]
            slots.append(
                WarehouseSlot(
                    index=idx,
                    row=row,
                    col=col,
                    level=level,
                    status="occupied",
                    shipment_no=ship.shipment_no,
                    sku=f"SKU-{1000 + (idx * 7) % 9000}",
                )
            )
            occupied_idx.append(idx)
        elif roll < p + 0.03:
            slots.append(
                WarehouseSlot(index=idx, row=row, col=col, level=level, status="reserved", sku="—")
            )
        else:
            slots.append(WarehouseSlot(index=idx, row=row, col=col, level=level, status="empty"))

    docks: list[WarehouseDock] = []
    for i in range(DOCKS):
        if ships and i < min(3, len(ships)):
            docks.append(
                WarehouseDock(
                    code=f"DOCK-{i + 1:02d}", status="loading", shipment_no=ships[i].shipment_no
                )
            )
        else:
            docks.append(WarehouseDock(code=f"DOCK-{i + 1:02d}", status="idle"))

    # 作业任务：把运单从月台搬向目标库位。目标取已占用库位（确定性挑选），
    # 保证动画终点一定落在真实存在的库位上。
    flows: list[WarehouseFlow] = []
    if ships and occupied_idx:
        step = max(1, len(occupied_idx) // MAX_FLOWS)
        for i, ship in enumerate(ships[:MAX_FLOWS]):
            target = occupied_idx[(i * step) % len(occupied_idx)]
            flows.append(
                WarehouseFlow(
                    shipment_no=ship.shipment_no,
                    from_dock=f"DOCK-{(i % DOCKS) + 1:02d}",
                    to_slot=target,
                )
            )

    return WarehouseLayout(
        id=loc.id,
        code=loc.code,
        name=loc.name,
        rows=ROWS,
        cols=COLS,
        levels=LEVELS,
        # 占用率按「已用」算：有货(occupied) + 预占(reserved) 都算占上，
        # 否则无真实运单的仓库（如厦门内陆仓：厦门港不在航线里）视觉满屏橙色、
        # 统计却显示 0%，两者对不上。空位(empty)不计入。
        occupancy_rate=round(
            (len(occupied_idx) + sum(1 for s in slots if s.status == "reserved")) / len(slots),
            4,
        ),
        slots=slots,
        docks=docks,
        flows=flows,
    )
