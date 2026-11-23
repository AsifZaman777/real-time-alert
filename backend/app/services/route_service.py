"""
Route-Aware Road Navigation & Threat Intersection Service.
Computes real road-network routes via OSRM (Open Source Routing Machine) over OpenStreetMap roads,
intersects Gold Medallion threat clusters against the actual street polyline, and extracts
Red Danger Road Segments + Tooltip metadata for roads that need to be avoided.
"""
from __future__ import annotations

import json
import math
import re
import urllib.request
from typing import Any

EARTH_RADIUS_KM = 6371.0

# In-memory cache for OSRM road geometries keyed by rounded (lat1, lon1, lat2, lon2)
_OSRM_ROUTE_CACHE: dict[tuple[float, float, float, float], list[dict[str, Any]]] = {}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 coordinates in kilometers."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def point_to_segment_info(
    p_lat: float,
    p_lon: float,
    a_lat: float,
    a_lon: float,
    b_lat: float,
    b_lon: float,
) -> tuple[float, float, float]:
    """
    Returns (distance_km, proj_lat, proj_lon) from point P to line segment A->B
    using local tangent plane projection.
    """
    if abs(a_lat - b_lat) < 1e-7 and abs(a_lon - b_lon) < 1e-7:
        return haversine_km(p_lat, p_lon, a_lat, a_lon), a_lat, a_lon

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
    dist_km = math.hypot(px - proj_x, py - proj_y)
    proj_lat = a_lat + t * (b_lat - a_lat)
    proj_lon = a_lon + t * (b_lon - a_lon)
    return dist_km, proj_lat, proj_lon


def point_to_segment_km(
    p_lat: float,
    p_lon: float,
    a_lat: float,
    a_lon: float,
    b_lat: float,
    b_lon: float,
) -> float:
    return point_to_segment_info(p_lat, p_lon, a_lat, a_lon, b_lat, b_lon)[0]


def fetch_osrm_routes(
    cur_lat: float,
    cur_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> list[dict[str, Any]]:
    """
    Fetches real street navigation polylines and step road names from OSRM.
    Caches results by rounded coordinates for fast polling.
    """
    cache_key = (round(cur_lat, 3), round(cur_lon, 3), round(dest_lat, 3), round(dest_lon, 3))
    if cache_key in _OSRM_ROUTE_CACHE:
        return _OSRM_ROUTE_CACHE[cache_key]

    routes_out: list[dict[str, Any]] = []
    try:
        url = (
            f"https://router.project-osrm.org/route/v1/driving/"
            f"{cur_lon:.5f},{cur_lat:.5f};{dest_lon:.5f},{dest_lat:.5f}"
            f"?overview=full&geometries=geojson&alternatives=true&steps=true"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "BigWarnEdge/2.0"})
        with urllib.request.urlopen(req, timeout=1.8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for rt in data.get("routes", []):
                raw_coords = rt.get("geometry", {}).get("coordinates", [])
                # Convert GeoJSON [lon, lat] -> Leaflet [lat, lon]
                latlon_poly = [[round(float(c[1]), 5), round(float(c[0]), 5)] for c in raw_coords]
                if len(latlon_poly) < 2:
                    continue

                step_roads: list[dict[str, Any]] = []
                road_names: list[str] = []
                for leg in rt.get("legs", []):
                    for st in leg.get("steps", []):
                        r_name = (st.get("name") or st.get("ref") or "").strip()
                        loc = st.get("maneuver", {}).get("location")
                        if r_name and r_name not in road_names:
                            road_names.append(r_name)
                        if r_name and loc and len(loc) == 2:
                            step_roads.append({
                                "name": r_name,
                                "lat": float(loc[1]),
                                "lon": float(loc[0]),
                            })

                routes_out.append({
                    "polyline": latlon_poly,
                    "distance_km": round(float(rt.get("distance", 0.0)) / 1000.0, 2),
                    "duration_min": max(1, int(round(float(rt.get("duration", 0.0)) / 60.0))),
                    "road_names": road_names[:8],
                    "step_roads": step_roads,
                })
    except Exception:
        pass

    if not routes_out:
        # Interpolated fallback polyline if offline
        steps = 24
        poly = [
            [
                round(cur_lat + (dest_lat - cur_lat) * (i / steps), 5),
                round(cur_lon + (dest_lon - cur_lon) * (i / steps), 5),
            ]
            for i in range(steps + 1)
        ]
        dist = round(haversine_km(cur_lat, cur_lon, dest_lat, dest_lon), 2)
        routes_out.append({
            "polyline": poly,
            "distance_km": dist,
            "duration_min": max(2, int(round(dist * 3.2))),
            "road_names": ["Direct Road Corridor"],
            "step_roads": [],
        })

    if len(_OSRM_ROUTE_CACHE) > 256:
        _OSRM_ROUTE_CACHE.clear()
    _OSRM_ROUTE_CACHE[cache_key] = routes_out
    return routes_out


def _analyze_alert_on_polyline(
    a_lat: float,
    a_lon: float,
    polyline: list[list[float]],
    step_roads: list[dict[str, Any]],
    danger_radius_km: float = 1.45,
) -> dict[str, Any]:
    """
    Finds the exact perpendicular closest point (snap_lat, snap_lon) from an alert coordinate
    (a_lat, a_lon) to any segment of the road polyline, extracts a smoothly interpolated red
    danger road stretch centered around (snap_lat, snap_lon), and resolves the closest street name.
    """
    min_dist = 9999.0
    snap_lat, snap_lon = a_lat, a_lon
    closest_idx = 0

    for i in range(len(polyline) - 1):
        p1 = polyline[i]
        p2 = polyline[i + 1]
        d, plat, plon = point_to_segment_info(a_lat, a_lon, p1[0], p1[1], p2[0], p2[1])
        if d < min_dist:
            min_dist = d
            snap_lat, snap_lon = plat, plon
            closest_idx = i

    # Build a dense, accurate road sub-polyline stretch around the intercepted road segment
    danger_coords: list[list[float]] = []
    if min_dist <= danger_radius_km and len(polyline) >= 2:
        for i in range(len(polyline) - 1):
            p1 = polyline[i]
            p2 = polyline[i + 1]
            seg_d, _, _ = point_to_segment_info(a_lat, a_lon, p1[0], p1[1], p2[0], p2[1])
            if seg_d <= danger_radius_km:
                # Sample intermediate points along long segments so straight roads clip accurately
                seg_len_km = haversine_km(p1[0], p1[1], p2[0], p2[1])
                num_steps = max(1, min(12, int(math.ceil(seg_len_km / 0.15))))
                for s in range(num_steps + 1):
                    t = s / num_steps
                    ilat = round(p1[0] + t * (p2[0] - p1[0]), 5)
                    ilon = round(p1[1] + t * (p2[1] - p1[1]), 5)
                    if haversine_km(a_lat, a_lon, ilat, ilon) <= danger_radius_km:
                        pt = [ilat, ilon]
                        if not danger_coords or danger_coords[-1] != pt:
                            danger_coords.append(pt)
            if i == closest_idx:
                snap_pt = [round(snap_lat, 5), round(snap_lon, 5)]
                if not danger_coords or danger_coords[-1] != snap_pt:
                    danger_coords.append(snap_pt)

        if len(danger_coords) < 2:
            p1 = polyline[closest_idx]
            p2 = polyline[min(len(polyline) - 1, closest_idx + 1)]
            danger_coords = [
                [round(p1[0], 5), round(p1[1], 5)],
                [round(snap_lat, 5), round(snap_lon, 5)],
                [round(p2[0], 5), round(p2[1], 5)],
            ]

    # Find nearest named street from OSRM steps
    nearest_road = ""
    best_r_dist = 9999.0
    for sr in step_roads:
        rd = haversine_km(snap_lat, snap_lon, sr["lat"], sr["lon"])
        if rd < best_r_dist:
            best_r_dist = rd
            nearest_road = sr["name"]

    # Always place the blinking red hazard dot at the EXACT closest point on the route polyline
    tooltip_lat, tooltip_lon = round(snap_lat, 5), round(snap_lon, 5)

    return {
        "min_dist_km": round(min_dist, 2),
        "snap_lat": tooltip_lat,
        "snap_lon": tooltip_lon,
        "tooltip_lat": tooltip_lat,
        "tooltip_lon": tooltip_lon,
        "danger_road_coords": danger_coords,
        "road_name": nearest_road,
    }


def _norm_area(text: str) -> str:
    return re.sub(r"[\s\-]+", " ", text.lower()).strip()


def filter_alerts_for_route(
    gold_alerts: list[dict[str, Any]],
    cur_lat: float,
    cur_lon: float,
    dest_lat: float,
    dest_lon: float,
    todo_text: str = "",
    radius_km: float = 1.35,
) -> dict[str, Any]:
    """
    Computes the OSRM minimum road route (plus alternative route) and intersects all
    Gold threat clusters against the actual road segments.
    """
    norm_todo = _norm_area(todo_text)
    osrm_routes = fetch_osrm_routes(cur_lat, cur_lon, dest_lat, dest_lon)
    primary_rt = osrm_routes[0]
    alt_rt = osrm_routes[1] if len(osrm_routes) > 1 else None

    primary_poly = primary_rt["polyline"]
    step_roads = primary_rt.get("step_roads", [])
    road_dist = primary_rt["distance_km"]
    duration_min = primary_rt["duration_min"]

    # Road-corridor threshold so any active event near or intercepted by the route triggers a blinking red dot
    corridor_thresh = min(max(radius_km, 1.2), 1.65)
    dest_radius = 1.65

    matched: list[dict[str, Any]] = []
    danger_by_area: dict[str, dict[str, Any]] = {}

    for alert in gold_alerts:
        # Strictly enforce 3-hour recency filter (<= 180 minutes) for route red dots & route alerts
        age_min = int(alert.get("age_minutes", 9999))
        is_recent = bool(alert.get("is_recent_3h", age_min <= 180))
        if not is_recent:
            continue

        a_lat = float(alert.get("lat", 23.8103))
        a_lon = float(alert.get("lon", 90.4125))

        poly_info = _analyze_alert_on_polyline(
            a_lat, a_lon, primary_poly, step_roads, danger_radius_km=corridor_thresh
        )
        dist_route = poly_info["min_dist_km"]
        dist_dest = round(haversine_km(a_lat, a_lon, dest_lat, dest_lon), 2)
        dist_cur = round(haversine_km(a_lat, a_lon, cur_lat, cur_lon), 2)

        area_norm = _norm_area(str(alert.get("area", "")))
        mentioned_in_todo = bool(area_norm and len(area_norm) > 2 and area_norm in norm_todo)

        on_route = (
            dist_route <= corridor_thresh
            or dist_dest <= dest_radius
            or dist_cur <= 1.2
            or mentioned_in_todo
        )
        if on_route:
            road_name = poly_info["road_name"] or f"{alert.get('area')} Road"
            reason = (
                f"On {road_name}"
                if dist_route <= corridor_thresh
                else ("Near Destination Pin" if dist_dest <= dest_radius else "Mentioned in Todo")
            )
            ev_label = str(alert.get("event_type", "threat")).replace("_", " ").upper()
            avoid_msg = f"AVOID {road_name.upper()} ({alert.get('area')}) • {ev_label}"

            all_arts = alert.get("articles") or []

            enriched_alert = {
                **alert,
                "articles": all_arts,
                "sample_headline": all_arts[0]["headline"] if all_arts else alert.get("sample_headline", ""),
                "on_route": True,
                "route_match_reason": reason,
                "affected_road": road_name,
                "avoid_Wait_advice": avoid_msg,
                "distance_to_route_km": dist_route,
                "distance_to_dest_km": dist_dest,
                "distance_to_user_km": dist_cur,
                "road_snap_lat": poly_info["tooltip_lat"],
                "road_snap_lon": poly_info["tooltip_lon"],
                "danger_road_coords": poly_info["danger_road_coords"],
            }
            matched.append(enriched_alert)

            area_key = str(alert.get("area", "Unknown"))
            age_label = (
                f"{age_min}m ago"
                if age_min < 60
                else (f"{age_min // 60}h {age_min % 60}m ago" if age_min < 1440 else f"{age_min // 1440}d ago")
            )
            seg_coords = poly_info["danger_road_coords"] or [
                [poly_info["tooltip_lat"], poly_info["tooltip_lon"]],
                [round(a_lat, 5), round(a_lon, 5)],
            ]
            if area_key not in danger_by_area:
                danger_by_area[area_key] = {
                    "cluster_id": alert.get("cluster_id"),
                    "area": area_key,
                    "road_name": road_name,
                    "event_type": str(alert.get("event_type", "")),
                    "severity": alert.get("severity"),
                    "color": "#EF4444",
                    "headline": enriched_alert["sample_headline"],
                    "veracity_percent": alert.get("veracity_percent"),
                    "veracity_summary": f"{age_label} • {alert.get('veracity_summary', '')}",
                    "age_minutes": age_min,
                    "tooltip_lat": poly_info["tooltip_lat"],
                    "tooltip_lon": poly_info["tooltip_lon"],
                    "event_lat": round(a_lat, 5),
                    "event_lon": round(a_lon, 5),
                    "coords": seg_coords,
                }
            else:
                existing_seg = danger_by_area[area_key]
                ev_cur = str(alert.get("event_type", ""))
                if ev_cur and ev_cur not in existing_seg["event_type"]:
                    existing_seg["event_type"] = f"{existing_seg['event_type']} + {ev_cur}"
                if age_min < existing_seg.get("age_minutes", 9999):
                    existing_seg["age_minutes"] = age_min
                    existing_seg["headline"] = enriched_alert["sample_headline"]
                    existing_seg["veracity_summary"] = f"{age_label} • {alert.get('veracity_summary', '')}"

    danger_segments = list(danger_by_area.values())

    matched.sort(
        key=lambda x: (
            0 if x.get("severity") == "CRITICAL" else (1 if x.get("severity") == "HIGH" else 2),
            x.get("distance_to_route_km", 999.0),
            -x.get("credibility_score", 0.0),
        )
    )

    if any(a.get("event_type") in ("blockade", "strike", "gunfire", "murder", "fire", "clash") for a in matched):
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
            "corridor_radius_km": corridor_thresh,
            "route_distance_km": road_dist,
            "duration_min": duration_min,
            "road_names": primary_rt.get("road_names", []),
            "polyline": primary_poly,
            "alt_polyline": alt_rt["polyline"] if alt_rt else [],
            "alt_distance_km": alt_rt["distance_km"] if alt_rt else None,
            "alt_duration_min": alt_rt["duration_min"] if alt_rt else None,
            "danger_segments": danger_segments,
        },
        "route_risk_level": risk_level,
        "route_alert_count": len(matched),
        "total_city_alerts": len(gold_alerts),
        "suppressed_count": max(0, len(gold_alerts) - len(matched)),
        "route_alerts": matched,
    }
