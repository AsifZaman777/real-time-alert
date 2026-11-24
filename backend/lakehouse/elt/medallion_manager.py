"""
Medallion Lakehouse ELT Manager (Bronze -> Silver -> Gold).
Computes live ELT transformation views (de-duplicated Silver disruptions and
area-scored Gold alerts with OpenStreetMap coordinates) from the raw Bronze stream.
"""
from __future__ import annotations

import json
import re
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.app.core.config import active_two_day_window, settings
from backend.app.services.crowd_service import crowd_service
from backend.ingestion.enrichment.dynamic_geocoder import get_dynamic_cache_snapshot, resolve_area_metadata
from backend.ingestion.enrichment.taxonomy import AREA_METADATA, TAG_VERSION, extract_disruption_tags
from backend.lakehouse.elt.cloud_lakehouse import cloud_connector

DHAKA_TZ = timezone(timedelta(hours=6))
MAX_RECENT_MINUTES = 180  # 3 hours recency window for route red dots & tooltips


def _norm_key(headline: str) -> str:
    return re.sub(r"[^\w]+", " ", headline.lower(), flags=re.UNICODE).strip()[:65]


def _normalize_article_ts(
    published: str | None,
    ingested_at: str | None,
    now_dhaka: datetime,
) -> tuple[str, int, bool]:
    """
    Normalizes an article's published/ingested timestamp to Dhaka local time (UTC+6),
    correcting double +6h timezone shifts, and returns (iso_ts, age_minutes, is_recent_3h).
    """
    pub_dt: datetime | None = None
    ing_dt: datetime | None = None

    if published:
        try:
            pub_dt = datetime.fromisoformat(published.replace("Z", "+00:00")).astimezone(DHAKA_TZ)
        except Exception:
            pub_dt = None

    if ingested_at:
        try:
            ing_dt = datetime.fromisoformat(ingested_at.replace("Z", "+00:00")).astimezone(DHAKA_TZ)
        except Exception:
            ing_dt = None

    # Correct double +6h offset if published appears in the future relative to ingested_at or now
    ref_ceiling = ing_dt or now_dhaka
    if pub_dt and (pub_dt - ref_ceiling).total_seconds() > 900:
        shifted = pub_dt - timedelta(hours=6)
        if abs((ref_ceiling - shifted).total_seconds()) < abs((pub_dt - ref_ceiling).total_seconds()):
            pub_dt = shifted
        else:
            pub_dt = ref_ceiling

    eff_dt = pub_dt or ing_dt or now_dhaka
    age_min = max(0, int(round((now_dhaka - eff_dt).total_seconds() / 60.0)))
    return eff_dt.isoformat(), age_min, (age_min <= MAX_RECENT_MINUTES)


EVENT_SEVERITY: dict[str, tuple[str, str]] = {
    "gunfire": ("CRITICAL", "#EF4444"),
    "murder": ("CRITICAL", "#EF4444"),
    "blockade": ("CRITICAL", "#EF4444"),
    "strike": ("CRITICAL", "#EF4444"),
    "clash": ("CRITICAL", "#EF4444"),
    "fire": ("CRITICAL", "#EF4444"),
    "accident": ("HIGH", "#F59E0B"),
    "procession": ("HIGH", "#F59E0B"),
    "waterlogging": ("MODERATE", "#3B82F6"),
    "power_outage": ("MODERATE", "#3B82F6"),
}


class MedallionLakehouseManager:
    """Materializes and queries Bronze (raw), Silver (cleansed/enriched), and Gold
    (multi-source corroborated area alerts) layers for the ELT pipeline."""

    def __init__(self, bronze_dir: Path | None = None,
                 silver_dir: Path | None = None,
                 gold_dir: Path | None = None):
        self.bronze_dir = bronze_dir or settings.bronze_path
        self.silver_dir = silver_dir or settings.silver_path
        self.gold_dir = gold_dir or settings.gold_path
        self.archive_48h_dir = settings.logs_dir / "archive_48h"
        for d in (self.bronze_dir, self.silver_dir, self.gold_dir, self.archive_48h_dir):
            d.mkdir(parents=True, exist_ok=True)
        self._tag_cache: dict[str, dict[str, Any]] = {}
        self._persist_lock = threading.Lock()

    def _compute_layers(
        self, raw_items: list[dict[str, Any]], day: str
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Transforms raw Bronze records into cleansed Silver disruptions and Gold alert clusters."""
        silver_records: list[dict[str, Any]] = []
        event_clusters: dict[str, dict[str, Any]] = {}
        now_dhaka = datetime.now(DHAKA_TZ)

        if len(self._tag_cache) > 25000:
            self._tag_cache.clear()

        for item in raw_items:
            cache_k = item.get("url") or item.get("headline") or ""
            tags = self._tag_cache.get(cache_k) if cache_k else None
            if tags is None:
                raw_locs = item.get("locations") or []
                has_only_valid_locs = bool(raw_locs) and all(loc in AREA_METADATA for loc in raw_locs)
                if (
                    item.get("tag_version", 1) >= TAG_VERSION
                    and has_only_valid_locs
                    and "location_events" in item
                    and isinstance(item.get("location_events"), dict)
                ):
                    valid_loc_events = {
                        k: v for k, v in item.get("location_events", {}).items() if k in AREA_METADATA
                    }
                    tags = {
                        "tag_version": item.get("tag_version", TAG_VERSION),
                        "event_types": item.get("event_types", []),
                        "locations": [loc for loc in raw_locs if loc in AREA_METADATA],
                        "location_events": valid_loc_events,
                        "parent_city": item.get("parent_city"),
                        "time_windows": item.get("time_windows", []),
                        "is_disruption": bool(item.get("is_disruption", False) and valid_loc_events),
                    }
                else:
                    tags = extract_disruption_tags(
                        item.get("headline", ""),
                        item.get("description", ""),
                        item.get("body", ""),
                    )
                if cache_k:
                    self._tag_cache[cache_k] = tags

            item = {**item, **tags}

            if not item.get("is_disruption") or not item.get("event_types") or not item.get("locations"):
                continue

            locs = [loc for loc in (item.get("locations") or []) if loc in AREA_METADATA]
            if not locs:
                continue
            ev_types = item.get("event_types") or []
            parent_city = item.get("parent_city")
            raw_loc_events = item.get("location_events") or {}
            location_events: dict[str, list[str]] = {
                loc: (raw_loc_events.get(loc) or ev_types)
                for loc in locs
                if loc in AREA_METADATA
            }

            primary_loc = locs[0]
            coords = resolve_area_metadata(primary_loc, AREA_METADATA, fallback_city=parent_city)

            norm_ts, age_min, is_recent = _normalize_article_ts(
                item.get("published"),
                item.get("ingested_at"),
                now_dhaka,
            )

            silver_rec = {
                **item,
                "published": norm_ts,
                "age_minutes": age_min,
                "is_recent_3h": is_recent,
                "primary_area": primary_loc,
                "lat": coords["lat"],
                "lon": coords["lon"],
                "city": coords["city"],
            }
            silver_records.append(silver_rec)

            # Group into Gold corroborated disruption clusters by exact (area -> bound_event_types)
            for loc, bound_events in location_events.items():
                c_meta = resolve_area_metadata(loc, AREA_METADATA, fallback_city=parent_city)
                for ev in bound_events:
                    cluster_id = f"{day}:{loc}:{ev}"
                    item_ts = norm_ts
                    cluster = event_clusters.setdefault(
                        cluster_id,
                        {
                            "cluster_id": cluster_id,
                            "date": day,
                            "area": loc,
                            "city": c_meta["city"],
                            "lat": c_meta["lat"],
                            "lon": c_meta["lon"],
                            "is_dynamic_area": bool(c_meta.get("dynamic")),
                            "event_type": ev,
                            "sources": set(),
                            "languages": set(),
                            "articles": [],
                            "seen_keys": set(),
                            "time_windows": set(),
                            "first_reported": item_ts,
                            "last_updated": item_ts,
                            "min_age_minutes": age_min,
                        },
                    )
                    cluster["sources"].add(item.get("source", "Unknown"))
                    cluster["languages"].add(item.get("lang", "en"))
                    for tw in item.get("time_windows") or []:
                        cluster["time_windows"].add(tw)

                    if item_ts and (not cluster["first_reported"] or item_ts < cluster["first_reported"]):
                        cluster["first_reported"] = item_ts
                    if item_ts and (not cluster["last_updated"] or item_ts > cluster["last_updated"]):
                        cluster["last_updated"] = item_ts
                    if age_min < cluster["min_age_minutes"]:
                        cluster["min_age_minutes"] = age_min

                    dedup_k = f"{item.get('source','')}:{_norm_key(item.get('headline',''))}"
                    if dedup_k not in cluster["seen_keys"]:
                        cluster["seen_keys"].add(dedup_k)
                        cluster["articles"].append(
                            {
                                "headline": item.get("headline"),
                                "source": item.get("source"),
                                "lang": item.get("lang", "en"),
                                "url": item.get("url"),
                                "published": norm_ts,
                                "ingested_at": item.get("ingested_at"),
                                "age_minutes": age_min,
                                "is_recent_3h": is_recent,
                                "_sort_ts": item_ts,
                            }
                        )

        gold_alerts: list[dict[str, Any]] = []
        for cid, cl in event_clusters.items():
            # Sort articles inside cluster so most recent news is at the top
            sorted_articles = sorted(
                cl["articles"],
                key=lambda a: a.get("_sort_ts") or "",
                reverse=True,
            )[:12]
            for a in sorted_articles:
                a.pop("_sort_ts", None)

            num_sources = len(cl["sources"])
            cluster_age = int(cl.get("min_age_minutes", 9999))
            cluster_is_recent = cluster_age <= MAX_RECENT_MINUTES

            # Veracity / Credibility score based purely on newspaper/portal corroboration
            credibility_score = min(
                0.99,
                round(0.45 + 0.18 * num_sources + (0.08 if len(cl["languages"]) > 1 else 0.0), 2),
            )
            veracity_percent = int(round(credibility_score * 100))
            if num_sources >= 3:
                status = "VERIFIED (Multi-Source)"
                veracity_tier = "HIGH"
            elif num_sources == 2:
                status = "CONFIRMED"
                veracity_tier = "MEDIUM"
            else:
                status = "UNCONFIRMED (Single Source)"
                veracity_tier = "LOW"

            severity, color = EVENT_SEVERITY.get(cl["event_type"], ("MODERATE", "#6B7280"))
            source_word = "newspaper/portal" if num_sources == 1 else "newspapers/portals"

            crowd_metrics = crowd_service.compute_crowd_metrics_for_cluster(
                area=cl["area"],
                event_type=cl["event_type"],
                source_count=num_sources,
                is_recent_3h=cluster_is_recent,
                article_count=len(sorted_articles),
                veracity_percent=veracity_percent,
            )

            gold_alerts.append(
                {
                    "cluster_id": cid,
                    "date": cl["date"],
                    "area": cl["area"],
                    "city": cl["city"],
                    "lat": cl["lat"],
                    "lon": cl["lon"],
                    "is_dynamic_area": cl.get("is_dynamic_area", False),
                    "event_type": cl["event_type"],
                    "severity": severity,
                    "color": color,
                    "credibility_score": credibility_score,
                    "veracity_percent": veracity_percent,
                    "veracity_tier": veracity_tier,
                    "veracity_status": status,
                    "veracity_summary": f"Verified by {num_sources} {source_word}",
                    "source_count": num_sources,
                    "sources": sorted(cl["sources"]),
                    "languages": sorted(cl["languages"]),
                    "time_windows": sorted(cl["time_windows"]),
                    "first_reported": cl["first_reported"],
                    "last_updated": cl["last_updated"],
                    "age_minutes": cluster_age,
                    "is_recent_3h": cluster_is_recent,
                    "crowd_metrics": crowd_metrics,
                    "sample_headline": sorted_articles[0]["headline"] if sorted_articles else "",
                    "articles": sorted_articles,
                }
            )

        gold_alerts.sort(
            key=lambda x: (
                x.get("last_updated") or "",
                x["source_count"],
                x["credibility_score"],
            ),
            reverse=True,
        )
        return silver_records, gold_alerts

    def build_medallion_snapshot(self, raw_items: list[dict[str, Any]], day: str) -> dict[str, Any]:
        """Executes in-memory ELT transformation over Bronze records (single-day or 48h rolling)
        to produce Silver (enriched + deduplicated) and Gold (corroborated area alerts) tables."""
        bronze_count = len(raw_items)
        silver_records, gold_alerts = self._compute_layers(raw_items, day)

        # Persist Bronze, Silver, Gold, active raw streams, and 48h TXT archive asynchronously (<5ms API)
        self._persist_snapshot_async(day, raw_items, silver_records, gold_alerts)
        d1, d2 = active_two_day_window(day)

        city_counts: dict[str, dict[str, Any]] = {}
        for g in gold_alerts:
            c = str(g.get("city") or "Bangladesh").strip()
            entry = city_counts.setdefault(
                c,
                {
                    "city": c,
                    "alert_count": 0,
                    "lat": AREA_METADATA.get(c, {}).get("lat", g.get("lat", 23.8103)),
                    "lon": AREA_METADATA.get(c, {}).get("lon", g.get("lon", 90.4125)),
                },
            )
            entry["alert_count"] += 1
        available_cities = sorted(city_counts.values(), key=lambda x: (-x["alert_count"], x["city"]))

        combined_area_meta = {
            k: {"lat": v["lat"], "lon": v["lon"], "city": v["city"]} for k, v in AREA_METADATA.items()
        }
        for k, v in get_dynamic_cache_snapshot().items():
            combined_area_meta.setdefault(k, {"lat": v["lat"], "lon": v["lon"], "city": v["city"]})

        return {
            "date": day,
            "window": f"2d_cycle ({d1} to {d2})",
            "cloud_lakehouse": cloud_connector.get_status_metadata(),
            "layers": {
                "bronze": {
                    "table": "lakehouse.bronze.raw_articles",
                    "format": "JSONL / Delta Parquet",
                    "record_count": bronze_count,
                    "total_words": sum(i.get("word_count") or len((i.get("body") or "").split()) for i in raw_items),
                    "sources_active": len({i.get("source") for i in raw_items if i.get("source")}),
                },
                "silver": {
                    "table": "lakehouse.silver.cleansed_disruptions",
                    "format": "Delta / Parquet (Filtered + OSM Geocoded)",
                    "record_count": len(silver_records),
                    "deduplicated_count": len({_norm_key(r.get("headline", "")) for r in silver_records}),
                },
                "gold": {
                    "table": "lakehouse.gold.corroborated_area_alerts",
                    "format": "Delta / Area MQTT Topics",
                    "alert_clusters": len(gold_alerts),
                    "confirmed_multi_source": sum(1 for g in gold_alerts if g["source_count"] >= 2),
                },
            },
            "available_cities": available_cities,
            "gold_alerts": gold_alerts,
            "area_metadata": combined_area_meta,
        }

    def _format_txt_report(
        self,
        day: str,
        raw_items: list[dict[str, Any]],
        silver_records: list[dict[str, Any]],
        gold_alerts: list[dict[str, Any]],
        generated_at: str,
    ) -> str:
        """Formats complete Gold, Silver, and Bronze Medallion data into a timestamped UTF-8 text archive."""
        lines = [
            f"=== BigWarn 48-Hour Medallion Archive ({day}) | Generated: {generated_at} ===",
            f"Summary -> GOLD Clusters: {len(gold_alerts)} | SILVER Disruptions: {len(silver_records)} | BRONZE Raw Articles: {len(raw_items)}",
            "",
            "================ [1/3] GOLD: CORROBORATED AREA ALERTS ================",
        ]
        for g in gold_alerts:
            lines.append(
                f"[{g.get('last_updated','')}] {g.get('severity','')} | {g.get('area','')} ({g.get('event_type','')}) | "
                f"{g.get('veracity_status','')} ({g.get('veracity_percent',0)}%) | "
                f"Sources={','.join(g.get('sources') or [])} | {g.get('sample_headline','')}"
            )
        lines.extend(["", "================ [2/3] SILVER: ENRICHED DISRUPTIONS ================"])
        for s in silver_records:
            lines.append(
                f"[{s.get('published','')}] {s.get('source','')} | "
                f"Areas={','.join(s.get('locations') or [])} | Events={','.join(s.get('event_types') or [])} | "
                f"{s.get('headline','')} | {s.get('url','')}"
            )
        lines.extend(["", "================ [3/3] BRONZE: RAW STREAM ARTICLES ================"])
        for b in raw_items:
            ts = b.get("published") or b.get("ingested_at") or ""
            kws = ",".join(b.get("matched_keywords") or [])
            snippet = re.sub(r"\s+", " ", (b.get("body") or b.get("description") or ""))[:220]
            lines.append(
                f"[{ts}] {b.get('source','Unknown')} ({b.get('lang','')}) | {b.get('headline','')} | "
                f"KW=[{kws}] | {b.get('url','')} | {snippet}"
            )
        return "\n".join(lines) + "\n"

    def archive_cycle_to_txt(
        self, cycle_label: str, ref_day: str, raw_items: list[dict[str, Any]]
    ) -> tuple[Path, bool]:
        """
        Before clearing a completed (>2-day / 48h) retention window locally, exports all
        Gold, Silver, and Bronze data into a date + timestamp folder in Cloudflare R2:
          retention_archives/date=<cycle_label>/ts=<YYYY-MM-DD_HH-MM-SS>/
            ├── gold/gold_alerts_<cycle_label>_<ts>.json
            ├── silver/silver_disruptions_<cycle_label>_<ts>.jsonl
            ├── bronze/bronze_articles_<cycle_label>_<ts>.jsonl
            └── summary/medallion_2day_<cycle_label>_<ts>.txt
        """
        now_dt = datetime.now(DHAKA_TZ)
        ts_slug = now_dt.strftime("%Y-%m-%d_%H-%M-%S")
        silver_records, gold_alerts = self._compute_layers(raw_items, ref_day)
        report_txt = self._format_txt_report(
            cycle_label, raw_items, silver_records, gold_alerts, now_dt.isoformat()
        )
        self.archive_48h_dir.mkdir(parents=True, exist_ok=True)

        txt_path = self.archive_48h_dir / f"medallion_2day_{cycle_label}_{ts_slug}.txt"
        gold_path = self.archive_48h_dir / f"gold_alerts_{cycle_label}_{ts_slug}.json"
        silver_path = self.archive_48h_dir / f"silver_disruptions_{cycle_label}_{ts_slug}.jsonl"
        bronze_path = self.archive_48h_dir / f"bronze_articles_{cycle_label}_{ts_slug}.jsonl"

        txt_path.write_text(report_txt, encoding="utf-8")
        gold_path.write_text(json.dumps(gold_alerts, ensure_ascii=False, indent=2), encoding="utf-8")
        silver_path.write_text(
            "\n".join(json.dumps(s, ensure_ascii=False) for s in silver_records) + ("\n" if silver_records else ""),
            encoding="utf-8",
        )
        bronze_path.write_text(
            "\n".join(json.dumps(b, ensure_ascii=False) for b in raw_items) + ("\n" if raw_items else ""),
            encoding="utf-8",
        )

        r2_prefix = f"retention_archives/date={cycle_label}/ts={ts_slug}"
        uploaded = cloud_connector.upload_files_sync([
            (f"{r2_prefix}/gold/{gold_path.name}", gold_path, "application/json"),
            (f"{r2_prefix}/silver/{silver_path.name}", silver_path, "application/x-ndjson"),
            (f"{r2_prefix}/bronze/{bronze_path.name}", bronze_path, "application/x-ndjson"),
            (f"{r2_prefix}/summary/{txt_path.name}", txt_path, "text/plain; charset=utf-8"),
        ])

        # Clean temporary staging copies after successful R2 upload
        if uploaded:
            for tmp_p in (gold_path, silver_path, bronze_path):
                tmp_p.unlink(missing_ok=True)

        return txt_path, uploaded

    def _persist_snapshot_async(
        self,
        day: str,
        raw_items: list[dict[str, Any]],
        silver_records: list[dict[str, Any]],
        gold_alerts: list[dict[str, Any]],
    ) -> None:
        if not self._persist_lock.acquire(blocking=False):
            return

        def _worker() -> None:
            try:
                bronze_file = self.bronze_dir / f"bronze_articles_{day}.jsonl"
                silver_file = self.silver_dir / f"silver_disruptions_{day}.jsonl"
                gold_file = self.gold_dir / f"gold_alerts_{day}.json"
                txt_archive = self.archive_48h_dir / f"stream_48h_{day}.txt"

                if raw_items:
                    bronze_file.write_text(
                        "\n".join(json.dumps(r, ensure_ascii=False) for r in raw_items) + "\n",
                        encoding="utf-8",
                    )
                if silver_records:
                    silver_file.write_text(
                        "\n".join(json.dumps(s, ensure_ascii=False) for s in silver_records) + "\n",
                        encoding="utf-8",
                    )
                gold_file.write_text(json.dumps(gold_alerts, ensure_ascii=False, indent=2), encoding="utf-8")

                report_txt = self._format_txt_report(
                    day, raw_items, silver_records, gold_alerts, datetime.now(DHAKA_TZ).isoformat()
                )
                txt_archive.write_text(report_txt, encoding="utf-8")

                extra: list[tuple[str, Path, str]] = [
                    (f"archive_48h/{txt_archive.name}", txt_archive, "text/plain; charset=utf-8")
                ]
                for d in active_two_day_window(day):
                    raw_p = settings.logs_dir / f"news_stream_{d}.jsonl"
                    if raw_p.exists() and raw_p.stat().st_size > 0:
                        extra.append((f"raw_streams/{raw_p.name}", raw_p, "application/x-ndjson"))
                seen_p = settings.logs_dir.parent / "seen_urls.json"
                if seen_p.exists() and seen_p.stat().st_size > 0:
                    extra.append(("state/seen_urls.json", seen_p, "application/json"))

                cloud_connector.sync_medallion_files_async(
                    day, bronze_file, silver_file, gold_file, extra_archives=extra
                )
            except OSError:
                pass
            finally:
                self._persist_lock.release()

        threading.Thread(target=_worker, daemon=True, name="bigwarn-lakehouse-persist").start()

