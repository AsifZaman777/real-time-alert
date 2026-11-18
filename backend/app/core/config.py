"""
Core configuration & constants for the BigWarn Backend.
Centralizes paths, timezone settings, Kafka topics, and Hybrid/Cloud Lakehouse settings
(Azure ADLS Gen2, AWS S3 / Cloudflare R2, Databricks, and Local Medallion Cache).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

DHAKA = timezone(timedelta(hours=6))  # Bangladesh Standard Time (UTC+6)
DHAKA_TZ = DHAKA

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent


def _load_dotenv_if_present() -> None:
    for env_path in (BACKEND_ROOT / ".env", PROJECT_ROOT / ".env"):
        if env_path.exists():
            try:
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    ln = line.strip()
                    if not ln or ln.startswith("#") or "=" not in ln:
                        continue
                    k, v = ln.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            except OSError:
                pass


_load_dotenv_if_present()

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

    # Storage paths
    data_dir: Path = field(default_factory=lambda: DATA_DIR)
    logs_dir: Path = field(default_factory=lambda: LOGS_DIR)
    seen_urls_path: Path = field(default_factory=lambda: DATA_DIR / "seen_urls.json")

    # Kafka configuration (Stage 2 Buffering)
    kafka_enabled: bool = os.getenv("BIGWARN_KAFKA_ENABLED", "false").lower() == "true"
    kafka_bootstrap_servers: str = os.getenv("BIGWARN_KAFKA_BOOTSTRAP", "localhost:9092")
    kafka_raw_topic: str = os.getenv("BIGWARN_KAFKA_RAW_TOPIC", "bigwarn.raw.news")
    kafka_alerts_topic: str = os.getenv("BIGWARN_KAFKA_ALERTS_TOPIC", "bigwarn.gold.alerts")

    # Local Medallion Lakehouse cache paths (Stage 4 Storage)
    bronze_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "bronze" / "articles")
    silver_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "silver" / "disruptions")
    gold_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "gold" / "area_alerts")
    checkpoint_path: Path = field(default_factory=lambda: LAKEHOUSE_DIR / "checkpoints")

    # Cloud Lakehouse Provider ("azure_adls", "s3_r2", or "local")
    cloud_lakehouse_provider: str = os.getenv("BIGWARN_CLOUD_PROVIDER", "local").lower()

    # Option A: Azure Data Lake Storage Gen2 (ADLS Gen2 / Azure Blob SAS or Connection String)
    azure_storage_account: str = os.getenv("AZURE_STORAGE_ACCOUNT", "")
    azure_storage_key: str = os.getenv("AZURE_STORAGE_KEY", "")
    azure_storage_connection_string: str = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
    azure_storage_sas_url: str = os.getenv("AZURE_STORAGE_SAS_URL", "")
    azure_container: str = os.getenv("AZURE_LAKEHOUSE_CONTAINER", "bigwarn-lakehouse")

    # Option B: AWS S3 / Cloudflare R2 / MinIO Cloud (S3-Compatible Object Storage)
    s3_endpoint_url: str = os.getenv("S3_ENDPOINT_URL", "")
    s3_bucket: str = os.getenv("S3_LAKEHOUSE_BUCKET", "bigwarn-lakehouse")
    s3_region: str = os.getenv("AWS_DEFAULT_REGION", "auto")
    aws_access_key_id: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    aws_secret_access_key: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")


settings = Settings()
