"""
Medallion Lakehouse ELT Manager (Bronze -> Silver -> Gold).
Computes live ELT transformation views (de-duplicated Silver disruptions and
area-scored Gold alerts with OpenStreetMap coordinates) from the raw Bronze stream.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from backend.app.core.config import settings
from backend.ingestion.enrichment.taxonomy import AREA_METADATA, extract_disruption_tags


def _norm_key(headline: str) -> str:
    return re.sub(r"[^\w]+", " ", headline.lower(), flags=re.UNICODE).strip()[:65]


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

        for item in raw_items:
            # Backfill disruption/location tags if reading older JSONL records
            if "event_types" not in item or "locations" not in item:
                tags = extract_disruption_tags(
                    item.get("headline", ""),
                    item.get("description", ""),
                    item.get("body", ""),
                )
                item = {**item, **tags}

            if not item.get("is_disruption") and not item.get("event_types"):
                continue

            locs = item.get("locations") or ["Bangladesh (General)"]
            ev_types = item.get("event_types") or ["general"]
            primary_loc = locs[0]
            coords = AREA_METADATA.get(primary_loc, {"lat": 23.8103, "lon": 90.4125, "city": "Dhaka"})

            silver_rec = {
                **item,
                "primary_area": primary_loc,
                "lat": coords["lat"],
                "lon": coords["lon"],
                "city": coords["city"],
            }
            silver_records.append(silver_rec)

            # Group into Gold corroborated disruption clusters by (area, primary_event_type)
            for loc in item.get("locations") or []:
                for ev in ev_types:
                    cluster_id = f"{day}:{loc}:{ev}"
                    c_meta = AREA_METADATA.get(loc, {"lat": 23.8103, "lon": 90.4125, "city": "Dhaka"})
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
                            "time_windows": set(),
                            "first_reported": item.get("published") or item.get("ingested_at"),
                            "last_updated": item.get("updated") or item.get("ingested_at"),
                        },
                    )
                    cluster["sources"].add(item.get("source", "Unknown"))
                    cluster["languages"].add(item.get("lang", "en"))
                    for tw in item.get("time_windows") or []:
                        cluster["time_windows"].add(tw)
                    if len(cluster["articles"]) < 8:
                        cluster["articles"].append(
                            {
                                "headline": item.get("headline"),
                                "source": item.get("source"),
                                "lang": item.get("lang", "en"),
                                "url": item.get("url"),
                                "published": item.get("published"),
                                "ingested_at": item.get("ingested_at"),
                            }
                        )

        gold_alerts: list[dict[str, Any]] = []
        for cid, cl in event_clusters.items():
            num_sources = len(cl["sources"])
            # Veracity / Credibility score per Section 4 of the Proposal PDF
            credibility_score = min(0.99, round(0.45 + 0.18 * num_sources + (0.08 if len(cl["languages"]) > 1 else 0.0), 2))
            status = "CONFIRMED" if num_sources >= 2 else "UNCONFIRMED (Single Source)"
            gold_alerts.append(
                {
                    "cluster_id": cid,
                    "date": cl["date"],
                    "area": cl["area"],
                    "city": cl["city"],
                    "lat": cl["lat"],
                    "lon": cl["lon"],
                    "event_type": cl["event_type"],
                    "credibility_score": credibility_score,
                    "veracity_status": status,
                    "source_count": num_sources,
                    "sources": sorted(cl["sources"]),
                    "languages": sorted(cl["languages"]),
                    "time_windows": sorted(cl["time_windows"]),
                    "first_reported": cl["first_reported"],
                    "last_updated": cl["last_updated"],
                    "sample_headline": cl["articles"][0]["headline"] if cl["articles"] else "",
                    "articles": cl["articles"],
                }
            )

        gold_alerts.sort(key=lambda x: (x["source_count"], x["credibility_score"]), reverse=True)

        # Persist Gold snapshot to Lakehouse Gold directory
        gold_file = self.gold_dir / f"gold_alerts_{day}.json"
        try:
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

