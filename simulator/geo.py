"""地理计算：haversine 距离、大圆航线插值、方位角。

轨迹生成的地基——给定起止港口经纬度，按大圆航线插值出沿途轨迹点。
"""

import math

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点间球面距离（公里）。"""
    phi1, lam1, phi2, lam2 = map(math.radians, (lat1, lng1, lat2, lng2))
    dphi = phi2 - phi1
    dlam = lam2 - lam1
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def interpolate_great_circle(
    lat1: float, lng1: float, lat2: float, lng2: float, t: float
) -> tuple[float, float]:
    """大圆插值：t 取 0~1，返回该比例处的经纬度。

    直接对经纬度线性插值是错的（墨卡托投影会失真），
    必须转到球面做 slerp 再转回经纬度。
    """
    phi1, lam1, phi2, lam2 = map(math.radians, (lat1, lng1, lat2, lng2))
    delta = 2 * math.asin(
        math.sqrt(
            math.sin((phi2 - phi1) / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin((lam2 - lam1) / 2) ** 2
        )
    )
    if delta == 0:
        return lat1, lng1

    a = math.sin((1 - t) * delta) / math.sin(delta)
    b = math.sin(t * delta) / math.sin(delta)
    x = a * math.cos(phi1) * math.cos(lam1) + b * math.cos(phi2) * math.cos(lam2)
    y = a * math.cos(phi1) * math.sin(lam1) + b * math.cos(phi2) * math.sin(lam2)
    z = a * math.sin(phi1) + b * math.sin(phi2)

    phi = math.atan2(z, math.sqrt(x * x + y * y))
    lam = math.atan2(y, x)
    return math.degrees(phi), math.degrees(lam)


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """起点到终点的初始方位角（度），用作轨迹点的 heading。"""
    phi1, lam1, phi2, lam2 = map(math.radians, (lat1, lng1, lat2, lng2))
    dlam = lam2 - lam1
    y = math.sin(dlam) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    return (math.degrees(math.atan2(y, x)) + 360) % 360
