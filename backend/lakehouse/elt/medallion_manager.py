"""
Medallion Lakehouse ELT Manager (Bronze -> Silver -> Gold).
Computes live ELT transformation views (de-duplicated Silver disruptions and
area-scored Gold alerts with OpenStreetMap coordinates) from the raw Bronze stream.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.app.core.config import settings
from backend.ingestion.enrichment.taxonomy import AREA_METADATA, extract_disruption_tags

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

    def __init__(self, bronze_dir: Path = settings.bronze_path,
                 silver_dir: Path = settings.silver_path,
                 gold_dir: Path = settings.gold_path):
        self.bronze_dir = bronze_dir
        self.silver_dir = silver_dir
        self.gold_dir = gold_dir
        for d in (self.bronze_dir, self.silver_dir, self.gold_dir):
            d.mkdir(parents=True, exist_ok=True)

    def build_medallion_snapshot(self, raw_items: list[dict[str, Any]], day: str) -> dict[str, Any]:
        """Executes in-memory ELT transformation over a day's Bronze records to produce
        Silver (enriched + deduplicated) and Gold (corroborated area alerts) tables."""
        bronze_count = len(raw_items)
        silver_records: list[dict[str, Any]] = []
        event_clusters: dict[str, dict[str, Any]] = {}
        now_dhaka = datetime.now(DHAKA_TZ)

        for item in raw_items:
            # Always evaluate with the context-aware clause-level threat & location extractor
            tags = extract_disruption_tags(
                item.get("headline", ""),
                item.get("description", ""),
                item.get("body", ""),
            )
            item = {**item, **tags}

            if not item.get("is_disruption") or not item.get("event_types") or not item.get("locations"):
                continue

            locs = item.get("locations") or []
            ev_types = item.get("event_types") or []
            location_events: dict[str, list[str]] = item.get("location_events") or {
                loc: ev_types for loc in locs
            }

            primary_loc = locs[0]
            coords = AREA_METADATA.get(primary_loc, {"lat": 23.8103, "lon": 90.4125, "city": "Dhaka"})

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
                if loc not in AREA_METADATA:
                    continue
                for ev in bound_events:
                    cluster_id = f"{day}:{loc}:{ev}"
                    c_meta = AREA_METADATA[loc]
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
            # Veracity / Credibility score: base 0.45 + 0.18 per distinct source + 0.08 bilingual corroboration
            credibility_score = min(0.99, round(0.45 + 0.18 * num_sources + (0.08 if len(cl["languages"]) > 1 else 0.0), 2))
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
            cluster_age = int(cl.get("min_age_minutes", 9999))
            cluster_is_recent = cluster_age <= MAX_RECENT_MINUTES

            gold_alerts.append(
                {
                    "cluster_id": cid,
                    "date": cl["date"],
                    "area": cl["area"],
                    "city": cl["city"],
                    "lat": cl["lat"],
                    "lon": cl["lon"],
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

        # Persist Bronze, Silver, and Gold snapshots to Lakehouse directories
        bronze_file = self.bronze_dir / f"bronze_articles_{day}.jsonl"
        silver_file = self.silver_dir / f"silver_disruptions_{day}.jsonl"
        gold_file = self.gold_dir / f"gold_alerts_{day}.json"
        try:
            if raw_items and not bronze_file.exists():
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
        except OSError:
            pass

        return {
            "date": day,
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
            "gold_alerts": gold_alerts,
            "area_metadata": {
                k: {"lat": v["lat"], "lon": v["lon"], "city": v["city"]} for k, v in AREA_METADATA.items()
            },
        }

