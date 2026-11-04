"""
Core configuration & constants for the BigWarn Backend.
Centralizes paths, timezone settings, Kafka topics, and Lakehouse directories.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

DHAKA = timezone(timedelta(hours=6))  # Bangladesh Standard Time (UTC+6)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent
DATA_DIR = Path(os.getenv("BIGWARN_DATA_DIR", str(BACKEND_ROOT / "data")))
LOGS_DIR = DATA_DIR / "logs"
LAKEHOUSE_DIR = Path(os.getenv("BIGWARN_LAKEHOUSE_DIR", str(BACKEND_ROOT / "lakehouse" / "storage")))

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 "
    "(compatible; BigWarnNewsStreamBot/2.0; +mailto:25-93713-1@student.aiub.edu)"
)


def now_dhaka() -> datetime:
    """Returns current timestamp in Dhaka timezone (UTC+6)."""
    return datetime.now(DHAKA)


@dataclass(frozen=True)
class Settings:
    app_name: str = "BigWarn Real-Time Disruption Alert Backend"
    version: str = "2.0.0"
    api_host: str = os.getenv("BIGWARN_API_HOST", "127.0.0.1")
    api_port: int = int(os.getenv("BIGWARN_API_PORT", "8765"))

    # Storage paths
    data_dir: Path = field(default_factory=lambda: DATA_DIR)
    logs_dir: Path = field(default_factory=lambda: LOGS_DIR)
    seen_urls_path: Path = field(default_factory=lambda: DATA_DIR / "seen_urls.json")

    # Kafka configuration (Stage 2 Buffering)
    kafka_enabled: bool = os.getenv("BIGWARN_KAFKA_ENABLED", "false").lower() == "true"
    kafka_bootstrap_servers: str = os.getenv("BIGWARN_KAFKA_BOOTSTRAP", "localhost:9092")
    kafka_raw_topic: str = os.getenv("BIGWARN_KAFKA_RAW_TOPIC", "bigwarn.raw.news")
    kafka_alerts_topic: str = os.getenv("BIGWARN_KAFKA_ALERTS_TOPIC", "bigwarn.gold.alerts")

    # Medallion Lakehouse paths (Stage 4 Storage)
    bronze_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "bronze" / "articles")
    silver_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "silver" / "disruptions")
    gold_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "gold" / "area_alerts")
    checkpoint_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "checkpoints")


settings = Settings()

