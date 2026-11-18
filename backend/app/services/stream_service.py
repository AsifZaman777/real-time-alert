"""
Stream, Debug, and Lakehouse Service Layer.
Provides unified access to daily JSONL streams, scraper logs, seen_urls stats,
and Medallion Lakehouse ELT snapshots.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta
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
        self._lakehouse_cache: dict[str, tuple[tuple[Any, ...], float, dict[str, Any]]] = {}
        self._refreshing: set[str] = set()
        self._cache_ttl_sec = 20.0

    def _candidate_logdirs(self) -> list[Path]:
        dirs = [self.primary_logdir]
        if self.poc_logdir.exists() and self.poc_logdir.resolve() != self.primary_logdir.resolve():
            dirs.append(self.poc_logdir)
        return dirs

    def today_str(self) -> str:
        return now_dhaka().strftime("%Y-%m-%d")

    def yesterday_str(self, ref_day: str | None = None) -> str:
        base = datetime.strptime(ref_day, "%Y-%m-%d") if ref_day and DAY_RE.match(ref_day) else now_dhaka()
        return (base - timedelta(days=1)).strftime("%Y-%m-%d")

    def rotate_older_than_48h(self) -> list[str]:
        """Archives completed (>48h) streams with all Gold, Silver, and Bronze data into a
        timestamped .txt file (synced to Cloudflare R2 if enabled), then removes the old active
        news/cache files so the pipeline continues cleanly from the active 48h window."""
        keep_days = {self.today_str(), self.yesterday_str()}
        archived: list[str] = []
        archive_dir = self.lakehouse.archive_48h_dir
        archive_dir.mkdir(parents=True, exist_ok=True)
        for p in list(self.primary_logdir.glob("news_stream_*.jsonl")):
            m = FILE_RE.match(p.name)
            if not m:
                continue
            d_str = m.group(1)
            if d_str not in keep_days:
                try:
                    _, expired_items = self.read_items(d_str, after=0, enrich_legacy=False)
                    self.lakehouse.archive_expired_day_to_txt(d_str, expired_items)

                    # Clear old active raw stream, log, and bronze/silver/gold caches older than 48h
                    p.unlink(missing_ok=True)
                    (self.primary_logdir / f"news_stream_{d_str}.log").unlink(missing_ok=True)
                    (self.lakehouse.bronze_dir / f"bronze_articles_{d_str}.jsonl").unlink(missing_ok=True)
                    (self.lakehouse.silver_dir / f"silver_disruptions_{d_str}.jsonl").unlink(missing_ok=True)
                    (self.lakehouse.gold_dir / f"gold_alerts_{d_str}.json").unlink(missing_ok=True)
                    (archive_dir / f"stream_48h_{d_str}.txt").unlink(missing_ok=True)
                    archived.append(d_str)
                except OSError:
                    pass
        return archived

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

    def read_48h_rolling_items(self, ref_day: str, enrich_legacy: bool = False) -> list[dict[str, Any]]:
        """Reads Yesterday + Today streams (continuous 48-hour sliding window), deduplicated by URL."""
        yest = self.yesterday_str(ref_day)
        seen_urls: set[str] = set()
        combined: list[dict[str, Any]] = []
        for d in (yest, ref_day):
            _, items = self.read_items(d, after=0, enrich_legacy=enrich_legacy)
            for it in items:
                u = it.get("url") or f"{it.get('source','')}:{it.get('headline','')}"
                if u not in seen_urls:
                    seen_urls.add(u)
                    combined.append(it)
        return combined

    def _compute_lakehouse_snapshot(self, cache_key: str, resolved_day: str, use_48h: bool) -> dict[str, Any]:
        if use_48h:
            items = self.read_48h_rolling_items(resolved_day)
        else:
            _, items = self.read_items(resolved_day, after=0, enrich_legacy=False)
        snapshot = self.lakehouse.build_medallion_snapshot(items, resolved_day)
        return snapshot

    def get_lakehouse_elt(self, day: str) -> dict[str, Any]:
        use_48h = (not day or day in ("latest", "48h"))
        resolved_day = self.resolve_day(day)
        cache_key = f"48h:{resolved_day}" if use_48h else resolved_day

        p_today = self._resolve_file(f"news_stream_{resolved_day}.jsonl")
        p_yest = self._resolve_file(f"news_stream_{self.yesterday_str(resolved_day)}.jsonl") if use_48h else None
        sig = (
            str(p_today) if p_today else "",
            p_today.stat().st_size if p_today and p_today.exists() else 0,
            str(p_yest) if p_yest else "",
            p_yest.stat().st_size if p_yest and p_yest.exists() else 0,
        )

        now_t = time.monotonic()
        cached = self._lakehouse_cache.get(cache_key)
        if cached:
            c_sig, c_ts, c_snap = cached
            if c_sig == sig:
                return c_snap
            # If cache is still within TTL OR a background refresh is running, return immediately (<1ms)!
            if (now_t - c_ts) < self._cache_ttl_sec or cache_key in self._refreshing:
                return c_snap

            # Spawn non-blocking background rebuild so phone/browser requests NEVER stall
            self._refreshing.add(cache_key)

            def _bg_rebuild() -> None:
                try:
                    snap = self._compute_lakehouse_snapshot(cache_key, resolved_day, use_48h)
                    self._lakehouse_cache[cache_key] = (sig, time.monotonic(), snap)
                finally:
                    self._refreshing.discard(cache_key)

            threading.Thread(target=_bg_rebuild, daemon=True, name="bigwarn-elt-refresh").start()
            return c_snap

        # Cold start (first call only)
        snapshot = self._compute_lakehouse_snapshot(cache_key, resolved_day, use_48h)
        self._lakehouse_cache[cache_key] = (sig, now_t, snapshot)
        return snapshot

    def resolve_day(self, day: str | None) -> str:
        """Resolves 'latest' / '48h' (or missing) to the most recent day that actually has stream data."""
        if day and day not in ("latest", "48h") and DAY_RE.match(day):
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

    def get_public_feed(
        self,
        day: str | None = "latest",
        layer: str = "gold",
        area: str | None = None,
        event_type: str | None = None,
        lang: str | None = None,
        recent_hours: float | None = None,
        after: int = 0,
        limit: int = 100,
    ) -> dict[str, Any]:
        """
        Public Open-Source Stream & Feed Query Engine.
        Allows external developers, researchers, and apps to consume Bronze, Silver, or Gold
        Bangladesh news and threat streams with rich filtering and cursor pagination.
        """
        use_48h = (not day or day in ("latest", "48h"))
        resolved_day = self.resolve_day(day)
        snapshot = self.get_lakehouse_elt(day or "latest")
        layer_norm = (layer or "gold").lower().strip()
        max_age_min = int(recent_hours * 60) if recent_hours is not None and recent_hours > 0 else None

        if layer_norm == "bronze":
            if use_48h:
                records = self.read_48h_rolling_items(resolved_day, enrich_legacy=True)
            else:
                _, records = self.read_items(resolved_day, after=0, enrich_legacy=True)
        elif layer_norm == "silver":
            silver_file = self.lakehouse.silver_dir / f"silver_disruptions_{resolved_day}.jsonl"
            records = []
            if silver_file.exists():
                try:
                    for line in silver_file.read_text(encoding="utf-8").splitlines():
                        if line.strip():
                            records.append(json.loads(line))
                except Exception:
                    pass
            if not records:
                if use_48h:
                    raw_items = self.read_48h_rolling_items(resolved_day, enrich_legacy=True)
                else:
                    _, raw_items = self.read_items(resolved_day, after=0, enrich_legacy=True)
                records = [r for r in raw_items if r.get("is_disruption")]
        else:
            layer_norm = "gold"
            records = list(snapshot.get("gold_alerts", []))

        # Apply optional filters (area, event_type, lang, recent_hours)
        filtered: list[dict[str, Any]] = []
        area_q = area.strip().lower() if area else None
        ev_q = event_type.strip().lower() if event_type else None
        lang_q = lang.strip().lower() if lang else None

        for rec in records:
            if area_q:
                rec_area = str(rec.get("area") or rec.get("primary_area") or "").lower()
                rec_locs = [str(x).lower() for x in (rec.get("locations") or [])]
                if area_q != rec_area and area_q not in rec_locs:
                    continue
            if ev_q:
                rec_ev = str(rec.get("event_type") or "").lower()
                rec_evs = [str(x).lower() for x in (rec.get("event_types") or [])]
                if ev_q != rec_ev and ev_q not in rec_evs:
                    continue
            if lang_q:
                rec_lang = str(rec.get("lang") or "").lower()
                rec_langs = [str(x).lower() for x in (rec.get("languages") or [])]
                if lang_q != rec_lang and lang_q not in rec_langs:
                    continue
            if max_age_min is not None:
                age_m = int(rec.get("age_minutes", 9999))
                if age_m > max_age_min:
                    continue
            filtered.append(rec)

        total_matched = len(filtered)
        sliced = filtered[after : after + max(1, min(limit, 1000))]
        return {
            "feed": "BigWarn Open Threat & News Stream",
            "version": settings.version,
            "date": resolved_day,
            "layer": layer_norm,
            "filters": {
                "area": area,
                "event_type": event_type,
                "lang": lang,
                "recent_hours": recent_hours,
            },
            "total_matched": total_matched,
            "after": after,
            "count": len(sliced),
            "next_cursor": after + len(sliced) if (after + len(sliced)) < total_matched else None,
            "items": sliced,
        }

    def format_rss_xml(self, feed_data: dict[str, Any]) -> str:
        """Formats a public feed payload as an RSS 2.0 + GeoRSS XML stream."""
        import html as html_mod

        items_xml: list[str] = []
        for it in feed_data.get("items", [])[:100]:
            if "cluster_id" in it:
                title = f"[{str(it.get('event_type','')).upper()} • {it.get('area')}] {it.get('sample_headline','')}"
                link = (it.get("articles") or [{}])[0].get("url") or "https://github.com/bigwarn"
                desc = f"{it.get('veracity_summary','')} ({it.get('veracity_percent')}%) — Area: {it.get('area')}, {it.get('city')}"
                pub = it.get("last_updated") or ""
                lat, lon = it.get("lat"), it.get("lon")
            else:
                title = it.get("headline") or "News Item"
                link = it.get("url") or "https://github.com/bigwarn"
                desc = it.get("description") or (it.get("body") or "")[:280]
                pub = it.get("published") or it.get("ingested_at") or ""
                lat, lon = it.get("lat"), it.get("lon")

            geo_tag = f"<georss:point>{lat} {lon}</georss:point>" if lat is not None and lon is not None else ""
            items_xml.append(
                f"    <item>\n"
                f"      <title>{html_mod.escape(str(title))}</title>\n"
                f"      <link>{html_mod.escape(str(link))}</link>\n"
                f"      <description>{html_mod.escape(str(desc))}</description>\n"
                f"      <pubDate>{html_mod.escape(str(pub))}</pubDate>\n"
                f"      {geo_tag}\n"
                f"    </item>"
            )

        body_items = "\n".join(items_xml)
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<rss version="2.0" xmlns:georss="http://www.georss.org/georss">\n'
            "  <channel>\n"
            "    <title>BigWarn Bangladesh Real-Time Threat &amp; Disruption Stream</title>\n"
            "    <link>http://localhost:8765/api/v1/stream/feed</link>\n"
            "    <description>Live open-source Medallion Lakehouse feed from 45 Bangladeshi news portals</description>\n"
            f"{body_items}\n"
            "  </channel>\n"
            "</rss>\n"
        )

