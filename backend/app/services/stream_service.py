"""
Stream, Debug, and Lakehouse Service Layer.
Provides unified access to daily JSONL streams, scraper logs, seen_urls stats,
and Medallion Lakehouse ELT snapshots.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from backend.app.core.config import BACKEND_ROOT, PROJECT_ROOT, now_dhaka, settings
from backend.app.services.route_service import filter_alerts_for_route
from backend.ingestion.enrichment.taxonomy import extract_disruption_tags
from backend.ingestion.sources.registry import get_all_sources_metadata
from backend.lakehouse.elt.medallion_manager import MedallionLakehouseManager

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILE_RE = re.compile(r"^news_stream_(\d{4}-\d{2}-\d{2})\.jsonl$")


class StreamService:
    def __init__(self, primary_logdir: Path | None = None):
        self.primary_logdir = primary_logdir or settings.logs_dir
        self.poc_logdir = PROJECT_ROOT / "news-live-POC" / "logs"
        self.primary_logdir.mkdir(parents=True, exist_ok=True)
        self.lakehouse = MedallionLakehouseManager()
        self._lakehouse_cache: dict[str, tuple[tuple[str, int, float], dict[str, Any]]] = {}

    def _candidate_logdirs(self) -> list[Path]:
        dirs = [self.primary_logdir]
        if self.poc_logdir.exists() and self.poc_logdir.resolve() != self.primary_logdir.resolve():
            dirs.append(self.poc_logdir)
        return dirs

    def today_str(self) -> str:
        return now_dhaka().strftime("%Y-%m-%d")

    def list_days(self) -> list[str]:
        days = {self.today_str()}
        for d in self._candidate_logdirs():
            for p in d.glob("news_stream_*.jsonl"):
                if m := FILE_RE.match(p.name):
                    days.add(m.group(1))
        return sorted(days, reverse=True)

    def _resolve_file(self, filename: str) -> Path | None:
        # Prefer the file with larger size or newer mtime across candidate dirs
        existing = [d / filename for d in self._candidate_logdirs() if (d / filename).exists()]
        if not existing:
            return None
        return max(existing, key=lambda p: (p.stat().st_size, p.stat().st_mtime))

    def read_items(self, day: str, after: int = 0, enrich_legacy: bool = True) -> tuple[int, list[dict[str, Any]]]:
        path = self._resolve_file(f"news_stream_{day}.jsonl")
        if not path:
            return 0, []
        items: list[dict[str, Any]] = []
        total = 0
        try:
            with open(path, encoding="utf-8") as f:
                for total, line in enumerate(f, 1):
                    if total <= after:
                        continue
                    try:
                        obj = json.loads(line)
                        if enrich_legacy and obj and ("event_types" not in obj or "locations" not in obj):
                            tags = extract_disruption_tags(
                                obj.get("headline", ""),
                                obj.get("description", ""),
                                obj.get("body", ""),
                            )
                            obj.update(tags)
                            obj.setdefault("lang", "en")
                            obj.setdefault("word_count", len((obj.get("body") or obj.get("description") or "").split()))
                        items.append(obj)
                    except ValueError:
                        items.append(None)
        except OSError:
            pass
        return total, [i for i in items if i]

    def read_debug_info(self, day: str, max_log_lines: int = 350) -> dict[str, Any]:
        log_path = self._resolve_file(f"news_stream_{day}.log")
        lines: list[str] = []
        if log_path:
            try:
                with open(log_path, encoding="utf-8", errors="replace") as f:
                    all_lines = f.readlines()
                    lines = [ln.rstrip("\r\n") for ln in all_lines[-max_log_lines:]]
            except OSError:
                pass

        seen_stats: dict[str, dict[str, int]] = {}
        seen_candidates = [
            self.primary_logdir.parent / "seen_urls.json",
            self.primary_logdir / "seen_urls.json",
            self.poc_logdir.parent / "seen_urls.json",
        ]
        for cand in seen_candidates:
            if cand.exists():
                try:
                    raw = json.loads(cand.read_text(encoding="utf-8"))
                    if isinstance(raw, dict):
                        for k, status in raw.items():
                            site_prefix = (
                                k.split(":", 1)[0]
                                if ":" in k and not k.startswith("http")
                                else (urlparse(k).netloc.lower().removeprefix("www.") if k.startswith("http") else "other")
                            )
                            bucket = seen_stats.setdefault(site_prefix, {})
                            st_key = str(status)
                            bucket[st_key] = bucket.get(st_key, 0) + 1
                    break
                except (OSError, ValueError):
                    pass

        return {
            "date": day,
            "log_lines": lines,
            "seen_stats": seen_stats,
            "configured_sources": get_all_sources_metadata(),
        }

    def get_lakehouse_elt(self, day: str) -> dict[str, Any]:
        resolved_day = self.resolve_day(day)
        path = self._resolve_file(f"news_stream_{resolved_day}.jsonl")
        if path and path.exists():
            st = path.stat()
            sig = (str(path), st.st_size, st.st_mtime)
            cached = self._lakehouse_cache.get(resolved_day)
            if cached and cached[0] == sig:
                return cached[1]
            _, items = self.read_items(resolved_day, after=0, enrich_legacy=True)
            snapshot = self.lakehouse.build_medallion_snapshot(items, resolved_day)
            self._lakehouse_cache[resolved_day] = (sig, snapshot)
            return snapshot
        _, items = self.read_items(resolved_day, after=0, enrich_legacy=True)
        return self.lakehouse.build_medallion_snapshot(items, resolved_day)

    def resolve_day(self, day: str | None) -> str:
        """Resolves 'latest' (or missing) to the most recent day that actually has stream data."""
        if day and day != "latest" and DAY_RE.match(day):
            return day
        for d in self.list_days():
            p = self._resolve_file(f"news_stream_{d}.jsonl")
            if p and p.stat().st_size > 0:
                return d
        return self.today_str()

    def get_map_alerts(self, day: str | None = None) -> dict[str, Any]:
        snapshot = self.get_lakehouse_elt(day or "latest")
        return {
            "date": snapshot["date"],
            "layers": snapshot["layers"],
            "total_alerts": len(snapshot["gold_alerts"]),
            "alerts": snapshot["gold_alerts"],
            "area_metadata": snapshot["area_metadata"],
        }

    def get_route_alerts(
        self,
        day: str | None,
        cur_lat: float,
        cur_lon: float,
        dest_lat: float,
        dest_lon: float,
        todo: str = "",
        radius_km: float = 2.5,
        include_map: bool = False,
    ) -> dict[str, Any]:
        snapshot = self.get_lakehouse_elt(day or "latest")
        filtered = filter_alerts_for_route(
            gold_alerts=snapshot["gold_alerts"],
            cur_lat=cur_lat,
            cur_lon=cur_lon,
            dest_lat=dest_lat,
            dest_lon=dest_lon,
            todo_text=todo,
            radius_km=radius_km,
        )
        result = {
            "date": snapshot["date"],
            "layers": snapshot["layers"],
            **filtered,
        }
        if include_map:
            result["map_alerts"] = snapshot["gold_alerts"]
        return result

