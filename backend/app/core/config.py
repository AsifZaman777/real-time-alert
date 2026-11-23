"""
Core configuration & constants for the BigWarn Backend.
Centralizes paths, timezone settings, Kafka topics, Cloudflare R2 archive,
and Lakehouse directories.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

DHAKA = timezone(timedelta(hours=6))  # Bangladesh Standard Time (UTC+6)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent


def _load_dotenv(env_path: Path) -> None:
    """Lightweight .env loader (no external dependency required)."""
    if not env_path.exists():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass


_load_dotenv(BACKEND_ROOT / ".env")

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
    api_host: str = os.getenv("BIGWARN_API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("BIGWARN_API_PORT", "8765"))
    feed_access_token: str = os.getenv("BIGWARN_FEED_TOKEN", "")

    # Storage paths
    data_dir: Path = field(default_factory=lambda: DATA_DIR)
    logs_dir: Path = field(default_factory=lambda: LOGS_DIR)
    seen_urls_path: Path = field(default_factory=lambda: DATA_DIR / "seen_urls.json")

    # 48-hour rolling server retention & Cloudflare R2 archival
    log_retention_hours: int = int(os.getenv("BIGWARN_LOG_RETENTION_HOURS", "48"))
    cloud_provider: str = os.getenv("BIGWARN_CLOUD_PROVIDER", "s3_r2")
    r2_access_key_id: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    r2_secret_access_key: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    r2_region: str = os.getenv("AWS_DEFAULT_REGION", "auto")
    r2_endpoint_url: str = os.getenv("S3_ENDPOINT_URL", "")
    r2_bucket: str = os.getenv("S3_LAKEHOUSE_BUCKET", "bigwarn")

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
