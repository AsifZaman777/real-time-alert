"""
Single-Phone Multi-Radio Surroundings & Traffic Detection Service for Bangladesh.

How It Works:
  1. When 1 or 2 people with the BigWarn mobile app are at a strike or road blockade,
     each open phone scans four hardware sensors:
       - Radio A: Bluetooth Low Energy (`ble_count`, 40m radius)
       - Radio B: Wi-Fi Mobile Peers & Hotspots (`wifi_mobile_count`, 50m radius —
         detects surrounding phones/vehicles even when they have Bluetooth turned OFF!)
       - Radio C: 4G/LTE Cell-Tower Sector Load (`cell_rsrp_dbm`, `cell_rsrq_db`,
         `cell_load_percent` — measures SIM-card saturation on the local cell tower)
       - Radio D: Hardware GPS Velocity (`speed_kmh` — measures whether traffic is
         STATIC / BLOCKED vs. MOVING)
  2. The server fuses all four hardware signals (`1 Self + BLE Peers + Wi-Fi Mobile Peers
     + Nearby Open App Phones within 50m`), enforces a strict 30-second live TTL, and
     determines the traffic & crowd state for both the Mobile Map HUD and Frontend Table.
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
    cell_load_pct: int = 25,
) -> tuple[str, str]:
    is_dense = total_crowd >= peak_threshold or cell_load_pct >= 75
    is_very_dense = total_crowd >= int(peak_threshold * 1.45) or (total_crowd >= 15 and cell_load_pct >= 82)

    if static_pct >= 68 or speed_kmh < STATIC_SPEED_THRESHOLD_KMH:
        mobility_state = "STATIC"
        if is_very_dense:
            pattern = "Strike / Standstill Blockade (High Multi-Radio & Cell Density)"
        elif is_dense:
            pattern = "High-Density Static Crowd / Traffic Bottleneck"
        elif total_crowd >= 10:
            pattern = "Stationary Traffic Queue / Commuter Cluster"
        else:
            pattern = f"Localized Static Presence ({total_crowd} device{'s' if total_crowd != 1 else ''})"
    elif static_pct >= 42 or speed_kmh < SLOW_SPEED_THRESHOLD_KMH:
        mobility_state = "SLOW_MOVING"
        if is_dense:
            pattern = "Slow-Moving Procession / Congested Traffic Surge"
        else:
            pattern = "Slow Crawling Traffic Corridor"
    else:
        mobility_state = "MOVING"
        if is_dense:
            pattern = "High-Volume Moving Transit Flow"
        else:
            pattern = "Normal Free-Flowing Traffic"

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
        network_type: str = "NATIVE_MULTI_RADIO",
        ble_count: int | None = None,
        ble_static_count: int | None = None,
        ble_moving_count: int | None = None,
        bt_classic_count: int | None = None,
        wifi_mobile_count: int | None = None,
        wifi_hotspot_count: int | None = None,
        wifi_p2p_count: int | None = None,
        wifi_lan_count: int | None = None,
        wifi_ap_count: int | None = None,
        wifi_static_count: int | None = None,
        wifi_moving_count: int | None = None,
        cell_rsrp_dbm: int | None = None,
        cell_rsrq_db: int | None = None,
        cell_load_percent: int | None = None,
        cell_tower_count: int | None = None,
        cell_network_type: str = "",
        avg_rssi_dbm: int = -70,
        scan_radius_m: int = 50,
        device_label: str = "",
    ) -> dict[str, Any]:
        """
        Records a real-time Multi-Radio scan (BLE + Wi-Fi Mobile Peers + 4G Cell Load + GPS Speed)
        from an opened BigWarn mobile app.
        """
        if not (BD_MIN_LAT <= lat <= BD_MAX_LAT and BD_MIN_LON <= lon <= BD_MAX_LON):
            return {
                "status": "rejected",
                "reason": "coordinates_outside_bangladesh",
                "verified": False,
            }

        is_legacy_bundle = (network_type or "") == "BLE_5.0 + 4G"
        if is_legacy_bundle:
            ble_count = 0
            ble_static_count = 0
            ble_moving_count = 0
            wifi_mobile_count = 0
            wifi_static_count = 0
            wifi_moving_count = 0
            network_type = "REAL_GPS_ONLY (Update App for Multi-Radio)"

        clean_speed = max(0.0, min(160.0, float(speed_kmh)))
        area, city, snap_dist_km = snap_to_bangladesh_area(lat, lon)
        is_major = area in MAJOR_URBAN_HUBS
        peak_threshold = 45 if is_major else 25

        clean_id = (device_id or "").strip()
        if not clean_id or clean_id == "mobile-edge":
            clean_id = f"ble-node-{area.lower().replace(' ', '-')}"

        detected_ble = max(0, int(ble_count)) if ble_count is not None else 0
        detected_bt_classic = max(0, int(bt_classic_count)) if bt_classic_count is not None else 0
        st_ble = (
            max(0, int(ble_static_count))
            if ble_static_count is not None
            else (detected_ble if clean_speed < STATIC_SPEED_THRESHOLD_KMH else 0)
        )
        mv_ble = max(0, detected_ble - st_ble)

        detected_wifi_hs = max(0, int(wifi_hotspot_count)) if wifi_hotspot_count is not None else 0
        detected_wifi_p2p = max(0, int(wifi_p2p_count)) if wifi_p2p_count is not None else 0
        detected_wifi_lan = max(0, int(wifi_lan_count)) if wifi_lan_count is not None else 0
        detected_wifi_mob = (
            max(0, int(wifi_mobile_count))
            if wifi_mobile_count is not None
            else (detected_wifi_hs + detected_wifi_p2p + detected_wifi_lan)
        )
        detected_wifi_ap = max(0, int(wifi_ap_count)) if wifi_ap_count is not None else 0
        st_wifi = (
            max(0, int(wifi_static_count))
            if wifi_static_count is not None
            else (detected_wifi_mob if clean_speed < STATIC_SPEED_THRESHOLD_KMH else 0)
        )
        mv_wifi = max(0, detected_wifi_mob - st_wifi)

        c_rsrp = int(cell_rsrp_dbm) if cell_rsrp_dbm is not None else -85
        c_rsrq = int(cell_rsrq_db) if cell_rsrq_db is not None else -9
        c_towers = max(0, int(cell_tower_count)) if cell_tower_count is not None else 0
        c_net_type = (cell_network_type or "4G_LTE").strip() or "4G_LTE"
        c_load = (
            max(0, min(100, int(cell_load_percent)))
            if cell_load_percent is not None
            else max(12, min(98, int(round(((-5.0 - c_rsrq) / 15.0) * 100.0))))
        )

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
            "network_type": network_type or "NATIVE_MULTI_RADIO",
            "raw_ble_count": detected_ble,
            "bt_classic_count": detected_bt_classic,
            "raw_ble_static": st_ble,
            "raw_ble_moving": mv_ble,
            "raw_wifi_mobile_count": detected_wifi_mob,
            "wifi_hotspot_count": detected_wifi_hs,
            "wifi_p2p_count": detected_wifi_p2p,
            "wifi_lan_count": detected_wifi_lan,
            "raw_wifi_ap_count": detected_wifi_ap,
            "raw_wifi_static": st_wifi,
            "raw_wifi_moving": mv_wifi,
            "cell_rsrp_dbm": c_rsrp,
            "cell_rsrq_db": c_rsrq,
            "cell_load_percent": c_load,
            "cell_tower_count": c_towers,
            "cell_network_type": c_net_type,
            "avg_rssi_dbm": int(avg_rssi_dbm or -70),
            "scan_radius_m": max(15, min(100, int(scan_radius_m or 50))),
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
        For each opened app user, fuses:
          - `ble_count`: Real hardware BLE peers (40m) + nearby open BigWarn phones (50m)
          - `wifi_mobile_count`: Real hardware Wi-Fi mobile peers/hotspots (50m, Bluetooth OFF)
          - `cell_load_percent`: 4G/LTE Cell-Tower Sector RSRQ Congestion (%)
          - `total_crowd_around_me`: 1 (this opened app phone) + `ble_count` + `wifi_mobile_count`
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
            radius_m = int(sc.get("scan_radius_m", 50))
            cell_load = int(sc.get("cell_load_percent", 25))

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
            hw_ble_static = int(sc.get("raw_ble_static", 0))

            hw_wifi_mob = int(sc.get("raw_wifi_mobile_count", sc.get("wifi_mobile_count", 0)))
            hw_wifi_ap = int(sc.get("raw_wifi_ap_count", sc.get("wifi_ap_count", 0)))
            hw_wifi_static = int(sc.get("raw_wifi_static", 0))

            total_ble_peers = max(hw_ble, nearby_open_apps_static + nearby_open_apps_moving)
            ble_peer_static = max(hw_ble_static, nearby_open_apps_static)
            ble_peer_moving = max(0, total_ble_peers - ble_peer_static)

            wifi_peer_static = min(hw_wifi_mob, hw_wifi_static)
            wifi_peer_moving = max(0, hw_wifi_mob - wifi_peer_static)

            self_is_static = 1 if speed_i < STATIC_SPEED_THRESHOLD_KMH else 0
            static_devices = self_is_static + ble_peer_static + wifi_peer_static
            moving_devices = (1 - self_is_static) + ble_peer_moving + wifi_peer_moving
            total_around = max(1, static_devices + moving_devices)

            static_pct = int(round((static_devices / float(total_around)) * 100))
            moving_pct = 100 - static_pct

            mobility_state, crowd_pattern = classify_crowd_pattern(
                total_crowd=total_around,
                static_pct=static_pct,
                speed_kmh=speed_i,
                peak_threshold=peak_thresh,
                cell_load_pct=cell_load,
            )

            area_m2 = math.pi * (radius_m ** 2)
            density_per_100m2 = round((total_around / area_m2) * 100.0, 2)

            enriched = {
                **sc,
                "ble_count": total_ble_peers,
                "wifi_mobile_count": hw_wifi_mob,
                "wifi_ap_count": hw_wifi_ap,
                "total_crowd_around_me": total_around,
                "static_devices": static_devices,
                "moving_devices": moving_devices,
                "static_percent": static_pct,
                "moving_percent": moving_pct,
                "mobility_state": mobility_state,
                "crowd_pattern": crowd_pattern,
                "density_per_100m2": density_per_100m2,
                "exceeds_peak": total_around >= peak_thresh or cell_load >= 75,
                "age_seconds": max(0, int(round(now_s - float(sc.get("ts", now_s))))),
            }
            active_scanners.append(enriched)

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
            max_wifi_mob = max(int(n.get("wifi_mobile_count", 0)) for n in nodes)
            max_wifi_hs = max(int(n.get("wifi_hotspot_count", 0)) for n in nodes)
            max_wifi_p2p = max(int(n.get("wifi_p2p_count", 0)) for n in nodes)
            max_wifi_lan = max(int(n.get("wifi_lan_count", 0)) for n in nodes)
            max_wifi_ap = max(int(n.get("wifi_ap_count", 0)) for n in nodes)
            avg_cell_load = int(round(sum(int(n.get("cell_load_percent", 0)) for n in nodes) / len(nodes)))
            avg_cell_rsrq = int(round(sum(int(n.get("cell_rsrq_db", -9)) for n in nodes) / len(nodes)))
            avg_cell_rsrp = int(round(sum(int(n.get("cell_rsrp_dbm", -85)) for n in nodes) / len(nodes)))
            cell_net = str(nodes[0].get("cell_network_type") or "4G_LTE")
            cell_towers = max(int(n.get("cell_tower_count", 0)) for n in nodes)

            total_mobiles = scanner_count + max_hw_ble + max_wifi_mob

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
                cell_load_pct=avg_cell_load,
            )

            exceeds_peak = total_mobiles >= peak_threshold or avg_cell_load >= 75
            excess_ratio = max(0.0, (total_mobiles - peak_threshold) / float(max(1, peak_threshold)))
            raw_int = min(
                1.0,
                0.42
                + min(0.35, (total_mobiles / float(max(1, peak_threshold))) * 0.25)
                + (stuck_percent / 100.0) * 0.22
                + (avg_cell_load / 100.0) * 0.14
                + excess_ratio * 0.18,
            )
            heat_intensity = round(raw_int, 2)

            if mobility_state == "STATIC" and exceeds_peak:
                intensity_label = f"STATIC BLOCKADE ({total_mobiles} Devs)"
            elif mobility_state == "STATIC":
                intensity_label = f"STATIC CROWD ({total_mobiles} Devs)"
            elif mobility_state == "SLOW_MOVING":
                intensity_label = f"SLOW TRAFFIC ({total_mobiles} Devs)"
            else:
                intensity_label = f"MOVING FLOW ({total_mobiles} Devs)"

            heatmaps.append(
                {
                    "area": area,
                    "city": city,
                    "lat": round(avg_lat, 6),
                    "lon": round(avg_lon, 6),
                    "is_verified": True,
                    "verification_basis": (
                        f"Multi-Radio Scan ({scanner_count} opened app{'s' if scanner_count != 1 else ''} • "
                        f"+{max_hw_ble} BLE • +{max_wifi_mob} Wi-Fi Peers • Cell Load {avg_cell_load}%)"
                    ),
                    "scanner_nodes_count": scanner_count,
                    "ble_peers_count": max_hw_ble,
                    "wifi_mobile_count": max_wifi_mob,
                    "wifi_mobile_peers_count": max_wifi_mob,
                    "wifi_hotspot_count": max_wifi_hs,
                    "wifi_p2p_count": max_wifi_p2p,
                    "wifi_lan_count": max_wifi_lan,
                    "wifi_ap_count": max_wifi_ap,
                    "cell_rsrp_dbm": avg_cell_rsrp,
                    "cell_rsrq_db": avg_cell_rsrq,
                    "cell_load_percent": avg_cell_load,
                    "cell_tower_count": cell_towers,
                    "cell_network_type": cell_net,
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
        total_wifi_mob = sum(h["wifi_mobile_count"] for h in heatmaps)
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
                "total_wifi_mobile_detected": total_wifi_mob,
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
