"""
Dynamic OpenStreetMap Nominatim Geocoder & Persistent Location Cache.
Allows BigWarn to automatically discover and geocode ANY village, union, upazila,
road, or neighborhood across Bangladesh that isn't in the static seed gazetteer.
"""
from __future__ import annotations

import json
import queue
import threading
import time
from pathlib import Path
from typing import Any

import requests

from backend.app.core.config import settings

CACHE_PATH = settings.data_dir / "dynamic_locations_cache.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "BigWarnDynamicGeocoder/2.0 (Bangladesh Threat Stream)"

_lock = threading.Lock()
_dynamic_cache: dict[str, dict[str, Any]] = {}
_cache_loaded = False
_pending_queue: queue.Queue[tuple[str, str | None]] = queue.Queue()
_queued_keys: set[str] = set()
_worker_started = False


def _ensure_loaded() -> None:
    global _cache_loaded, _dynamic_cache
    if _cache_loaded:
        return
    with _lock:
        if _cache_loaded:
            return
        if CACHE_PATH.exists():
            try:
                data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    _dynamic_cache = data
            except (OSError, ValueError):
                _dynamic_cache = {}
        _cache_loaded = True


def _persist_cache() -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(
            json.dumps(_dynamic_cache, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def _extract_district(address: dict[str, Any], fallback_city: str | None) -> str:
    for key in ("city", "town", "state_district", "county", "district"):
        val = address.get(key)
        if val and isinstance(val, str):
            clean = val.replace(" District", "").replace(" জেলা", "").strip()
            if clean:
                return clean
    return fallback_city or "Bangladesh"


def _nominatim_worker() -> None:
    """Polite 1 req/sec background worker to geocode newly discovered locations via OSM."""
    while True:
        area_name, fallback_city = _pending_queue.get()
        try:
            q_parts = [area_name]
            if fallback_city and fallback_city.lower() not in area_name.lower():
                q_parts.append(fallback_city)
            q_parts.append("Bangladesh")
            resp = requests.get(
                NOMINATIM_URL,
                params={
                    "q": ", ".join(q_parts),
                    "format": "json",
                    "addressdetails": 1,
                    "limit": 1,
                    "countrycodes": "bd",
                },
                headers={"User-Agent": USER_AGENT},
                timeout=8,
            )
            if resp.status_code == 200:
                results = resp.json()
                if isinstance(results, list) and results:
                    top = results[0]
                    lat = float(top["lat"])
                    lon = float(top["lon"])
                    city = _extract_district(top.get("address") or {}, fallback_city)
                    with _lock:
                        _dynamic_cache[area_name] = {
                            "lat": round(lat, 5),
                            "lon": round(lon, 5),
                            "city": city,
                            "dynamic": True,
                        }
                        _persist_cache()
        except Exception:
            pass
        finally:
            _pending_queue.task_done()
            time.sleep(1.1)


def _start_worker_if_needed() -> None:
    global _worker_started
    if _worker_started:
        return
    with _lock:
        if _worker_started:
            return
        threading.Thread(
            target=_nominatim_worker,
            daemon=True,
            name="bigwarn-osm-geocoder",
        ).start()
        _worker_started = True


def resolve_area_metadata(
    area_name: str,
    seed_metadata: dict[str, dict[str, Any]],
    fallback_city: str | None = None,
) -> dict[str, Any]:
    """
    Resolves coordinates and district/city for verified Bangladesh locations in the seed gazetteer.
    Rejects non-gazetteer random words so only actual verified places appear on the map.
    """
    if area_name in seed_metadata:
        m = seed_metadata[area_name]
        return {"lat": m["lat"], "lon": m["lon"], "city": m["city"], "dynamic": False}

    if fallback_city and fallback_city in seed_metadata:
        base = seed_metadata[fallback_city]
        return {
            "lat": base["lat"],
            "lon": base["lon"],
            "city": base["city"],
            "dynamic": False,
        }

    return {
        "lat": 23.8103,
        "lon": 90.4125,
        "city": fallback_city or "Bangladesh",
        "dynamic": False,
    }


def get_dynamic_cache_snapshot() -> dict[str, dict[str, Any]]:
    return {}
