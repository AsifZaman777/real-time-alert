"""
Route-Aware Relevance Filtering Service.
Filters Gold Medallion disruption alerts so the mobile edge client only receives
high-value alerts intersecting the user's current location -> todo destination route.
"""
from __future__ import annotations

import math
import re
from typing import Any

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 coordinates in kilometers."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def point_to_segment_km(
    p_lat: float,
    p_lon: float,
    a_lat: float,
    a_lon: float,
    b_lat: float,
    b_lon: float,
) -> float:
    """Minimum distance in km from point P to line segment A->B using local tangent plane."""
    if abs(a_lat - b_lat) < 1e-7 and abs(a_lon - b_lon) < 1e-7:
        return haversine_km(p_lat, p_lon, a_lat, a_lon)

    ref_lat = math.radians((a_lat + b_lat) * 0.5)
    cos_lat = math.cos(ref_lat)
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * cos_lat

    ax, ay = 0.0, 0.0
    bx, by = (b_lon - a_lon) * km_per_deg_lon, (b_lat - a_lat) * km_per_deg_lat
    px, py = (p_lon - a_lon) * km_per_deg_lon, (p_lat - a_lat) * km_per_deg_lat

    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    t = max(0.0, min(1.0, (px * dx + py * dy) / seg_len_sq)) if seg_len_sq > 0 else 0.0
    proj_x, proj_y = ax + t * dx, ay + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def _norm_area(text: str) -> str:
    return re.sub(r"[\s\-]+", " ", text.lower()).strip()


def filter_alerts_for_route(
    gold_alerts: list[dict[str, Any]],
    cur_lat: float,
    cur_lon: float,
    dest_lat: float,
    dest_lon: float,
    todo_text: str = "",
    radius_km: float = 2.5,
) -> dict[str, Any]:
    """Filters Gold disruption clusters to only those relevant to the user's route & todo."""
    norm_todo = _norm_area(todo_text)
    dest_radius = max(radius_km, 3.0)
    route_dist = round(haversine_km(cur_lat, cur_lon, dest_lat, dest_lon), 2)

    matched: list[dict[str, Any]] = []
    for alert in gold_alerts:
        a_lat = float(alert.get("lat", 23.8103))
        a_lon = float(alert.get("lon", 90.4125))
        dist_route = round(point_to_segment_km(a_lat, a_lon, cur_lat, cur_lon, dest_lat, dest_lon), 2)
        dist_dest = round(haversine_km(a_lat, a_lon, dest_lat, dest_lon), 2)
        dist_cur = round(haversine_km(a_lat, a_lon, cur_lat, cur_lon), 2)

        area_norm = _norm_area(str(alert.get("area", "")))
        mentioned_in_todo = bool(area_norm and area_norm in norm_todo)

        on_route = dist_route <= radius_km or dist_dest <= dest_radius or mentioned_in_todo
        if on_route:
            reason = (
                "Mentioned in Todo"
                if mentioned_in_todo
                else ("Near Destination" if dist_dest <= dest_radius and dist_dest <= dist_route else "Along Route Corridor")
            )
            matched.append(
                {
                    **alert,
                    "on_route": True,
                    "route_match_reason": reason,
                    "distance_to_route_km": dist_route,
                    "distance_to_dest_km": dist_dest,
                    "distance_to_user_km": dist_cur,
                }
            )

    matched.sort(
        key=lambda x: (
            0 if x.get("severity") == "CRITICAL" else (1 if x.get("severity") == "HIGH" else 2),
            x.get("distance_to_route_km", 999.0),
            -x.get("credibility_score", 0.0),
        )
    )

    if any(a.get("event_type") in ("blockade", "strike") for a in matched):
        risk_level = "BLOCKED"
    elif any(a.get("severity") == "CRITICAL" for a in matched):
        risk_level = "HIGH_RISK"
    elif matched:
        risk_level = "CAUTION"
    else:
        risk_level = "CLEAR"

    return {
        "route": {
            "cur_lat": cur_lat,
            "cur_lon": cur_lon,
            "dest_lat": dest_lat,
            "dest_lon": dest_lon,
            "todo": todo_text,
            "corridor_radius_km": radius_km,
            "route_distance_km": route_dist,
        },
        "route_risk_level": risk_level,
        "route_alert_count": len(matched),
        "total_city_alerts": len(gold_alerts),
        "suppressed_count": max(0, len(gold_alerts) - len(matched)),
        "route_alerts": matched,
    }
