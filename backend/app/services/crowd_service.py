"""
BLE Proximity Crowd-Sourcing & Mobility Pattern Service for Bangladesh.

How It Works:
  1. When a user opens the BigWarn mobile app, their phone automatically scans nearby
     Bluetooth Low Energy (BLE) advertising packets within a ~40m radius and reads the
     phone's hardware GPS location and velocity (`speed_kmh`).
  2. The phone sends the accumulated BLE peer count (`ble_count`), static vs. moving
     BLE peer split (`ble_static_count`, `ble_moving_count`), average RSSI (`avg_rssi_dbm`),
     and GPS velocity to `/api/v1/crowd/ping`.
  3. The server aggregates all active app scanner nodes (15-minute sliding window TTL),
     classifies whether the crowd around each open app user is STATIC or MOVING,
     determines the crowd pattern, and generates real-time heatmap zones for both the
     Mobile Map and the Frontend Crowd-Sourcing Observatory.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import threading
import time
from pathlib import Path
from typing import Any

try:
    from app.core.config import BACKEND_ROOT, now_dhaka
except ImportError:
    from backend.app.core.config import BACKEND_ROOT, now_dhaka

try:
    from ingestion.enrichment.taxonomy import AREA_METADATA
except ImportError:
    from backend.ingestion.enrichment.taxonomy import AREA_METADATA

# Geographic bounding box of Bangladesh
BD_MIN_LAT = 20.50
BD_MAX_LAT = 26.70
BD_MIN_LON = 88.00
BD_MAX_LON = 92.80

# Active BLE scanner session TTL (15 minutes)
PING_TTL_SECONDS = 900.0
STATIC_SPEED_THRESHOLD_KMH = 3.5
SLOW_SPEED_THRESHOLD_KMH = 10.0

MAJOR_URBAN_HUBS = {
    "Mirpur-10", "Motijheel", "Farmgate", "Shahbagh", "Gulistan",
    "New Market", "Karwan Bazar", "Jatrabari", "Mohakhali", "Uttara",
    "Paltan", "Chattogram", "Sadarghat", "Old Dhaka", "Gabtoli",
    "Sayedabad", "Science Lab", "Malibagh", "Rampura", "Badda",
    "Mohammadpur", "Dhanmondi", "Banani", "Gulshan", "Gazipur",
    "Narayanganj", "Sylhet", "Rajshahi", "Khulna", "Cumilla",
    "Bogura", "Mymensingh", "Rangpur", "Barishal", "Cox's Bazar",
}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2.0 * r * math.asin(min(1.0, math.sqrt(a)))


def snap_to_bangladesh_area(lat: float, lon: float, max_dist_km: float = 20.0) -> tuple[str, str, float]:
    best_area = "Dhaka"
    best_city = "Dhaka"
    best_dist = 999999.0
    for area, meta in AREA_METADATA.items():
        d = _haversine_km(lat, lon, float(meta["lat"]), float(meta["lon"]))
        if d < best_dist:
            best_dist = d
            best_area = area
            best_city = str(meta.get("city") or area)
    if best_dist <= max_dist_km:
        return best_area, best_city, round(best_dist, 2)
    return f"BD Sector ({lat:.2f}°N, {lon:.2f}°E)", "Bangladesh", round(best_dist, 2)


def classify_crowd_pattern(
    total_crowd: int,
    static_pct: int,
    speed_kmh: float,
    peak_threshold: int,
) -> tuple[str, str]:
    """
    Returns `(mobility_state, crowd_pattern)` based on accumulated BLE device count,
    percentage of static BLE devices, and scanner GPS velocity.
    """
    is_dense = total_crowd >= peak_threshold
    is_very_dense = total_crowd >= int(peak_threshold * 1.45)

    if static_pct >= 68 or speed_kmh < STATIC_SPEED_THRESHOLD_KMH:
        mobility_state = "STATIC"
        if is_very_dense:
            pattern = "Dense Static Gathering / Standstill Blockade"
        elif is_dense:
            pattern = "High-Density Static Crowd / Bottleneck"
        elif total_crowd >= 15:
            pattern = "Stationary Commuter Cluster / Queue"
        else:
            pattern = "Localized Static Presence"
    elif static_pct >= 42 or speed_kmh < SLOW_SPEED_THRESHOLD_KMH:
        mobility_state = "SLOW_MOVING"
        if is_dense:
            pattern = "Slow-Moving Crowd Surge / Procession"
        else:
            pattern = "Slow Crawling Traffic Corridor"
    else:
        mobility_state = "MOVING"
        if is_dense:
            pattern = "High-Volume Moving Transit Flow"
        else:
            pattern = "Normal Free-Flowing Movement"

    return mobility_state, pattern


class CrowdIntelligenceService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._storage_path: Path = (
            BACKEND_ROOT / "lakehouse" / "storage" / "gold" / "verified_ble_crowd_pings.json"
        )
        # device_id -> scanner telemetry record
        self._scanner_pings: dict[str, dict[str, Any]] = {}
        self._load_persisted_pings()

    def _load_persisted_pings(self) -> None:
        if not self._storage_path.exists():
            return
        try:
            raw = json.loads(self._storage_path.read_text(encoding="utf-8"))
            now_s = time.time()
            if isinstance(raw, dict):
                for dev_id, rec in raw.items():
                    if isinstance(rec, dict) and (now_s - float(rec.get("ts", 0))) <= PING_TTL_SECONDS:
                        self._scanner_pings[str(dev_id)] = rec
        except (OSError, ValueError):
            pass

    def _persist_pings_unlocked(self) -> None:
        try:
            self._storage_path.parent.mkdir(parents=True, exist_ok=True)
            self._storage_path.write_text(
                json.dumps(self._scanner_pings, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            pass

    def _prune_stale_unlocked(self, now_s: float) -> None:
        expired = [
            dev_id
            for dev_id, rec in self._scanner_pings.items()
            if (now_s - float(rec.get("ts", 0))) > PING_TTL_SECONDS
        ]
        for dev_id in expired:
            self._scanner_pings.pop(dev_id, None)

    def record_verified_ping(
        self,
        device_id: str,
        lat: float,
        lon: float,
        speed_kmh: float = 0.0,
        accuracy_m: float = 20.0,
        network_type: str = "4G_LTE",
        ble_count: int | None = None,
        ble_static_count: int | None = None,
        ble_moving_count: int | None = None,
        avg_rssi_dbm: int = -66,
        scan_radius_m: int = 40,
        device_label: str = "",
    ) -> dict[str, Any]:
        """
        Records a real-time BLE proximity scan + GPS velocity ping from an open BigWarn app instance.
        """
        if not (BD_MIN_LAT <= lat <= BD_MAX_LAT and BD_MIN_LON <= lon <= BD_MAX_LON):
            return {
                "status": "rejected",
                "reason": "coordinates_outside_bangladesh",
                "verified": False,
            }

        clean_speed = max(0.0, min(160.0, float(speed_kmh)))
        area, city, snap_dist_km = snap_to_bangladesh_area(lat, lon)
        is_major = area in MAJOR_URBAN_HUBS
        peak_threshold = 45 if is_major else 25

        clean_id = (device_id or "").strip()
        if not clean_id or clean_id == "mobile-edge":
            clean_id = f"ble-node-{area.lower().replace(' ', '-')}"

        # Total nearby BLE devices detected around this open app user
        detected_ble = max(0, int(ble_count)) if ble_count is not None else 0
        total_around_me = 1 + detected_ble  # 1 (scanner phone itself) + accumulated nearby BLE devices

        if ble_static_count is not None and ble_moving_count is not None:
            st_ble = max(0, int(ble_static_count))
            mv_ble = max(0, int(ble_moving_count))
            scanner_is_static = 1 if clean_speed < STATIC_SPEED_THRESHOLD_KMH else 0
            static_devices = scanner_is_static + st_ble
            moving_devices = (1 - scanner_is_static) + mv_ble
            total_around_me = max(1, static_devices + moving_devices)
        else:
            # Derive static vs moving split from scanner GPS velocity & RSSI stability
            if clean_speed < STATIC_SPEED_THRESHOLD_KMH:
                static_ratio = 0.82
            elif clean_speed < SLOW_SPEED_THRESHOLD_KMH:
                static_ratio = 0.54
            else:
                static_ratio = 0.22
            static_devices = max(
                1 if clean_speed < STATIC_SPEED_THRESHOLD_KMH else 0,
                int(round(total_around_me * static_ratio)),
            )
            moving_devices = max(0, total_around_me - static_devices)

        static_pct = int(round((static_devices / float(max(1, total_around_me))) * 100))
        moving_pct = 100 - static_pct

        mobility_state, crowd_pattern = classify_crowd_pattern(
            total_crowd=total_around_me,
            static_pct=static_pct,
            speed_kmh=clean_speed,
            peak_threshold=peak_threshold,
        )

        clean_radius = max(15, min(100, int(scan_radius_m or 40)))
        area_m2 = math.pi * (clean_radius ** 2)
        density_per_100m2 = round((total_around_me / area_m2) * 100.0, 2)

        now_s = time.time()
        now_iso = now_dhaka().isoformat(timespec="seconds")

        record = {
            "device_id": clean_id,
            "device_label": device_label or f"App Scanner ({clean_id[-6:]})",
            "area": area,
            "city": city,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "speed_kmh": round(clean_speed, 1),
            "accuracy_m": round(max(1.0, float(accuracy_m)), 1),
            "network_type": network_type or "BLE_5.0 + 4G",
            "ble_count": detected_ble,
            "total_crowd_around_me": total_around_me,
            "static_devices": static_devices,
            "moving_devices": moving_devices,
            "static_percent": static_pct,
            "moving_percent": moving_pct,
            "mobility_state": mobility_state,
            "crowd_pattern": crowd_pattern,
            "avg_rssi_dbm": int(avg_rssi_dbm or -65),
            "scan_radius_m": clean_radius,
            "density_per_100m2": density_per_100m2,
            "peak_threshold": peak_threshold,
            "exceeds_peak": total_around_me >= peak_threshold,
            "snap_distance_km": snap_dist_km,
            "ts": now_s,
            "last_ping_iso": now_iso,
            "verified": True,
        }

        with self._lock:
            self._prune_stale_unlocked(now_s)
            self._scanner_pings[clean_id] = record
            self._persist_pings_unlocked()

        return {
            "status": "ok",
            "verified": True,
            "area": area,
            "city": city,
            "scanner": record,
        }

    def get_live_crowd_snapshot(self) -> dict[str, Any]:
        """
        Aggregates all active open-app BLE scanner nodes into:
          1. `scanners`: Per-user live table rows ("if my app is open, how much crowd around me,
             location, static vs moving, crowd pattern, speed, RSSI").
          2. `heatmaps`: Area-level aggregated BLE crowd heatmaps across Bangladesh.
          3. `summary`: Top-level KPI counters for the Frontend & Mobile dashboards.
        """
        now_s = time.time()
        with self._lock:
            self._prune_stale_unlocked(now_s)
            active_scanners = [dict(r) for r in self._scanner_pings.values()]

        active_scanners.sort(key=lambda r: float(r.get("ts", 0)), reverse=True)
        for sc in active_scanners:
            sc["age_seconds"] = max(0, int(round(now_s - float(sc.get("ts", now_s)))))

        # Group scanner nodes by area to build area-level BLE heatmaps
        by_area: dict[str, list[dict[str, Any]]] = {}
        for sc in active_scanners:
            by_area.setdefault(str(sc["area"]), []).append(sc)

        heatmaps: list[dict[str, Any]] = []
        for area, nodes in by_area.items():
            meta = AREA_METADATA.get(area)
            # Use exact scanner GPS centroid (or canonical area coordinates)
            avg_lat = sum(float(n["lat"]) for n in nodes) / len(nodes)
            avg_lon = sum(float(n["lon"]) for n in nodes) / len(nodes)
            city = nodes[0].get("city") or (meta.get("city") if meta else "Bangladesh")
            is_major = area in MAJOR_URBAN_HUBS
            peak_threshold = 45 if is_major else 25

            scanner_count = len(nodes)
            # Deduplicate overlapping BLE scans in the same area (0.75 overlap factor when multiple scanners share an area)
            raw_ble_sum = sum(int(n.get("ble_count", 0)) for n in nodes)
            dedup_ble = (
                raw_ble_sum
                if scanner_count == 1
                else int(round(raw_ble_sum * (0.78 if scanner_count == 2 else 0.65)))
            )
            total_mobiles = scanner_count + dedup_ble

            raw_static_sum = sum(int(n.get("static_devices", 0)) for n in nodes)
            raw_total_sum = max(1, sum(int(n.get("total_crowd_around_me", 1)) for n in nodes))
            stuck_percent = int(round((raw_static_sum / float(raw_total_sum)) * 100))
            moving_percent = 100 - stuck_percent
            mobiles_stuck = int(round(total_mobiles * (stuck_percent / 100.0)))
            mobiles_moving = max(0, total_mobiles - mobiles_stuck)

            avg_speed_kmh = round(
                sum(float(n.get("speed_kmh", 0.0)) for n in nodes) / len(nodes),
                1,
            )
            avg_rssi = int(round(sum(int(n.get("avg_rssi_dbm", -66)) for n in nodes) / len(nodes)))
            max_density = max(float(n.get("density_per_100m2", 0.0)) for n in nodes)

            mobility_state, crowd_pattern = classify_crowd_pattern(
                total_crowd=total_mobiles,
                static_pct=stuck_percent,
                speed_kmh=avg_speed_kmh,
                peak_threshold=peak_threshold,
            )

            exceeds_peak = total_mobiles >= peak_threshold
            excess_ratio = max(0.0, (total_mobiles - peak_threshold) / float(max(1, peak_threshold)))
            raw_int = min(
                1.0,
                0.42
                + min(0.38, (total_mobiles / float(max(1, peak_threshold))) * 0.28)
                + (stuck_percent / 100.0) * 0.24
                + excess_ratio * 0.22,
            )
            heat_intensity = round(raw_int, 2)

            if mobility_state == "STATIC" and exceeds_peak:
                intensity_label = f"STATIC CROWD PEAK ({total_mobiles} BLE)"
            elif mobility_state == "STATIC":
                intensity_label = f"STATIC CROWD ({total_mobiles} BLE)"
            elif mobility_state == "SLOW_MOVING":
                intensity_label = f"SLOW CROWD ({total_mobiles} BLE)"
            else:
                intensity_label = f"MOVING FLOW ({total_mobiles} BLE)"

            heatmaps.append(
                {
                    "area": area,
                    "city": city,
                    "lat": round(avg_lat, 6),
                    "lon": round(avg_lon, 6),
                    "is_verified": True,
                    "verification_basis": (
                        f"BLE Proximity Scan ({scanner_count} active app user{'s' if scanner_count != 1 else ''} • "
                        f"{dedup_ble} nearby BLE devices)"
                    ),
                    "scanner_nodes_count": scanner_count,
                    "ble_peers_count": dedup_ble,
                    "total_mobiles": total_mobiles,
                    "mobiles_stuck": mobiles_stuck,
                    "mobiles_moving": mobiles_moving,
                    "stuck_percent": stuck_percent,
                    "moving_percent": moving_percent,
                    "avg_speed_kmh": avg_speed_kmh,
                    "mobility_state": mobility_state,
                    "crowd_pattern": crowd_pattern,
                    "avg_rssi_dbm": avg_rssi,
                    "density_per_100m2": max_density,
                    "peak_threshold": peak_threshold,
                    "exceeds_peak": exceeds_peak,
                    "heat_intensity": heat_intensity,
                    "intensity_label": intensity_label,
                    "last_ping_iso": nodes[0].get("last_ping_iso"),
                }
            )

        heatmaps.sort(
            key=lambda h: (
                h["mobility_state"] == "STATIC",
                h["total_mobiles"],
                h["heat_intensity"],
            ),
            reverse=True,
        )

        total_ble = sum(h["ble_peers_count"] for h in heatmaps)
        total_crowd = sum(h["total_mobiles"] for h in heatmaps)
        total_static = sum(h["mobiles_stuck"] for h in heatmaps)
        total_moving = sum(h["mobiles_moving"] for h in heatmaps)
        static_hotspots = sum(1 for h in heatmaps if h["mobility_state"] == "STATIC")

        return {
            "status": "ok",
            "updated_at": now_dhaka().isoformat(timespec="seconds"),
            "summary": {
                "active_scanner_apps": len(active_scanners),
                "total_ble_detected": total_ble,
                "total_crowd_devices": total_crowd,
                "total_static_devices": total_static,
                "total_moving_devices": total_moving,
                "active_zones_count": len(heatmaps),
                "static_hotspots_count": static_hotspots,
            },
            "scanners": active_scanners,
            "heatmaps": heatmaps,
        }

    def get_all_bangladesh_heatmaps(
        self, gold_alerts: list[dict[str, Any]] | None = None
    ) -> list[dict[str, Any]]:
        return self.get_live_crowd_snapshot()["heatmaps"]


crowd_service = CrowdIntelligenceService()
