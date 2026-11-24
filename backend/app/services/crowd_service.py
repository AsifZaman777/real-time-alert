"""
BLE Proximity Crowd-Sourcing & Mobility Pattern Service for Bangladesh.

How It Works:
  1. When a user opens the BigWarn mobile app, their phone automatically scans nearby
     Bluetooth Low Energy (BLE) advertising packets within a ~40m radius and reads the
     phone's hardware GPS location and velocity (`speed_kmh`).
  2. Active opened-app sessions have a strict 30-second live TTL (since open apps ping
     every 6 seconds), so closed or reloaded app sessions disappear immediately instead
     of lingering as stale ghost rows.
  3. If multiple phones have the BigWarn app open within 50 meters of each other, the
     server also cross-detects those nearby open app phones alongside hardware BLE peers.
"""
from __future__ import annotations

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

# Strict 30-second live TTL for opened app users (open apps ping every 6 seconds)
PING_TTL_SECONDS = 30.0
PROXIMITY_RADIUS_KM = 0.050  # 50 meters
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
            pattern = f"Localized Static Presence ({total_crowd} device{'s' if total_crowd != 1 else ''})"
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
        self._scanner_pings: dict[str, dict[str, Any]] = {}
        self._load_persisted_pings()

    def _is_valid_non_legacy_record(self, rec: dict[str, Any], now_s: float) -> bool:
        if (now_s - float(rec.get("ts", 0))) > PING_TTL_SECONDS:
            return False
        # Reject legacy synthetic AMBIENT_BLE_MESH records that used network_type == "BLE_5.0 + 4G"
        if str(rec.get("network_type") or "") == "BLE_5.0 + 4G":
            return False
        return True

    def _load_persisted_pings(self) -> None:
        if not self._storage_path.exists():
            return
        try:
            raw = json.loads(self._storage_path.read_text(encoding="utf-8"))
            now_s = time.time()
            if isinstance(raw, dict):
                for dev_id, rec in raw.items():
                    if isinstance(rec, dict) and self._is_valid_non_legacy_record(rec, now_s):
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
            if not self._is_valid_non_legacy_record(rec, now_s)
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
        network_type: str = "NATIVE_BLE_HARDWARE",
        ble_count: int | None = None,
        ble_static_count: int | None = None,
        ble_moving_count: int | None = None,
        avg_rssi_dbm: int = -70,
        scan_radius_m: int = 40,
        device_label: str = "",
    ) -> dict[str, Any]:
        """
        Records a real-time BLE proximity scan + GPS velocity ping from an opened BigWarn mobile app.
        Rejects legacy synthetic "BLE_5.0 + 4G" pings from older app bundles.
        """
        if not (BD_MIN_LAT <= lat <= BD_MAX_LAT and BD_MIN_LON <= lon <= BD_MAX_LON):
            return {
                "status": "rejected",
                "reason": "coordinates_outside_bangladesh",
                "verified": False,
            }

        # If an older cached JS bundle on a phone sends the legacy synthetic "BLE_5.0 + 4G" tag,
        # zero out its synthetic ble_count so it only counts the real phone itself!
        is_legacy_bundle = (network_type or "") == "BLE_5.0 + 4G"
        if is_legacy_bundle:
            ble_count = 0
            ble_static_count = 0
            ble_moving_count = 0
            network_type = "REAL_GPS_ONLY (Update App for Native BLE)"

        clean_speed = max(0.0, min(160.0, float(speed_kmh)))
        area, city, snap_dist_km = snap_to_bangladesh_area(lat, lon)
        is_major = area in MAJOR_URBAN_HUBS
        peak_threshold = 45 if is_major else 25

        clean_id = (device_id or "").strip()
        if not clean_id or clean_id == "mobile-edge":
            clean_id = f"ble-node-{area.lower().replace(' ', '-')}"

        detected_ble = max(0, int(ble_count)) if ble_count is not None else 0
        st_ble = max(0, int(ble_static_count)) if ble_static_count is not None else (
            detected_ble if clean_speed < STATIC_SPEED_THRESHOLD_KMH else 0
        )
        mv_ble = max(0, detected_ble - st_ble)

        now_s = time.time()
        now_iso = now_dhaka().isoformat(timespec="seconds")

        record = {
            "device_id": clean_id,
            "device_label": device_label or f"BigWarn ANDROID ({clean_id[-4:]})",
            "area": area,
            "city": city,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "speed_kmh": round(clean_speed, 1),
            "accuracy_m": round(max(1.0, float(accuracy_m)), 1),
            "network_type": network_type or "NATIVE_BLE_HARDWARE",
            "raw_ble_count": detected_ble,
            "raw_ble_static": st_ble,
            "raw_ble_moving": mv_ble,
            "avg_rssi_dbm": int(avg_rssi_dbm or -70),
            "scan_radius_m": max(15, min(100, int(scan_radius_m or 40))),
            "peak_threshold": peak_threshold,
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
        Aggregates all currently open BigWarn mobile app users (active within last 30s).
        For each opened app user, computes:
          - `ble_count`: Hardware BLE peers + any other opened BigWarn app phones within 50m.
          - `total_crowd_around_me`: 1 (this opened app phone) + `ble_count`.
          - Static vs. Moving split and Crowd Pattern.
        """
        now_s = time.time()
        with self._lock:
            self._prune_stale_unlocked(now_s)
            raw_scanners = [dict(r) for r in self._scanner_pings.values()]
            self._persist_pings_unlocked()

        raw_scanners.sort(key=lambda r: float(r.get("ts", 0)), reverse=True)

        active_scanners: list[dict[str, Any]] = []
        for sc in raw_scanners:
            lat_i = float(sc["lat"])
            lon_i = float(sc["lon"])
            speed_i = float(sc.get("speed_kmh", 0.0))
            peak_thresh = int(sc.get("peak_threshold", 25))
            radius_m = int(sc.get("scan_radius_m", 40))

            # Count any other currently open BigWarn app phones within 50 meters of this phone
            nearby_open_apps_static = 0
            nearby_open_apps_moving = 0
            for other in raw_scanners:
                if other["device_id"] == sc["device_id"]:
                    continue
                d_km = _haversine_km(lat_i, lon_i, float(other["lat"]), float(other["lon"]))
                if d_km <= PROXIMITY_RADIUS_KM:
                    if float(other.get("speed_kmh", 0.0)) < STATIC_SPEED_THRESHOLD_KMH:
                        nearby_open_apps_static += 1
                    else:
                        nearby_open_apps_moving += 1

            hw_ble = int(sc.get("raw_ble_count", sc.get("ble_count", 0)))
            hw_static = int(sc.get("raw_ble_static", 0))
            hw_moving = int(sc.get("raw_ble_moving", 0))

            # Total nearby BLE peers = max(hardware BLE scan, nearby open BigWarn app phones)
            total_ble_peers = max(hw_ble, nearby_open_apps_static + nearby_open_apps_moving)
            peer_static = max(hw_static, nearby_open_apps_static)
            peer_moving = max(0, total_ble_peers - peer_static)

            self_is_static = 1 if speed_i < STATIC_SPEED_THRESHOLD_KMH else 0
            static_devices = self_is_static + peer_static
            moving_devices = (1 - self_is_static) + peer_moving
            total_around = max(1, static_devices + moving_devices)

            static_pct = int(round((static_devices / float(total_around)) * 100))
            moving_pct = 100 - static_pct

            mobility_state, crowd_pattern = classify_crowd_pattern(
                total_crowd=total_around,
                static_pct=static_pct,
                speed_kmh=speed_i,
                peak_threshold=peak_thresh,
            )

            area_m2 = math.pi * (radius_m ** 2)
            density_per_100m2 = round((total_around / area_m2) * 100.0, 2)

            enriched = {
                **sc,
                "ble_count": total_ble_peers,
                "total_crowd_around_me": total_around,
                "static_devices": static_devices,
                "moving_devices": moving_devices,
                "static_percent": static_pct,
                "moving_percent": moving_pct,
                "mobility_state": mobility_state,
                "crowd_pattern": crowd_pattern,
                "density_per_100m2": density_per_100m2,
                "exceeds_peak": total_around >= peak_thresh,
                "age_seconds": max(0, int(round(now_s - float(sc.get("ts", now_s))))),
            }
            active_scanners.append(enriched)

        # Group by area for map heatmaps
        by_area: dict[str, list[dict[str, Any]]] = {}
        for sc in active_scanners:
            by_area.setdefault(str(sc["area"]), []).append(sc)

        heatmaps: list[dict[str, Any]] = []
        for area, nodes in by_area.items():
            meta = AREA_METADATA.get(area)
            avg_lat = sum(float(n["lat"]) for n in nodes) / len(nodes)
            avg_lon = sum(float(n["lon"]) for n in nodes) / len(nodes)
            city = nodes[0].get("city") or (meta.get("city") if meta else "Bangladesh")
            is_major = area in MAJOR_URBAN_HUBS
            peak_threshold = 45 if is_major else 25

            scanner_count = len(nodes)
            max_hw_ble = max(int(n.get("raw_ble_count", 0)) for n in nodes)
            total_mobiles = scanner_count + max_hw_ble

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
            avg_rssi = int(round(sum(int(n.get("avg_rssi_dbm", -70)) for n in nodes) / len(nodes)))
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
                        f"BLE Proximity Scan ({scanner_count} opened app user{'s' if scanner_count != 1 else ''} • "
                        f"{max_hw_ble} external BLE peer{'s' if max_hw_ble != 1 else ''})"
                    ),
                    "scanner_nodes_count": scanner_count,
                    "ble_peers_count": max_hw_ble,
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
