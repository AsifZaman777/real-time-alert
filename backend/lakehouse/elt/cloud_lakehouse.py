"""
Cloud Lakehouse Connector (Azure ADLS Gen2, AWS S3 / Cloudflare R2, and Spark Cloud URIs).
Syncs Bronze, Silver, and Gold Medallion tables to cloud object storage while keeping
a local high-speed cache for sub-millisecond edge route queries.
"""
from __future__ import annotations

import threading
import urllib.request
from pathlib import Path
from typing import Any

from backend.app.core.config import now_dhaka, settings


class CloudLakehouseConnector:
    def __init__(self) -> None:
        self.provider = settings.cloud_lakehouse_provider
        self.last_sync_at: str | None = None
        self.last_sync_status: str = "LOCAL_CACHE_ACTIVE"
        self.last_error: str | None = None
        self._lock = threading.Lock()

    @property
    def is_cloud_enabled(self) -> bool:
        if self.provider == "azure_adls":
            return bool(
                settings.azure_storage_sas_url
                or settings.azure_storage_connection_string
                or (settings.azure_storage_account and settings.azure_storage_key)
            )
        if self.provider in ("s3", "s3_r2", "cloudflare_r2", "minio"):
            return bool(settings.aws_access_key_id and settings.aws_secret_access_key and settings.s3_bucket)
        return False

    def get_spark_uri(self, layer: str) -> str:
        """Returns the cloud URI (abfss:// or s3a://) for Apache Spark Structured Streaming."""
        if self.provider == "azure_adls" and settings.azure_storage_account:
            return (
                f"abfss://{settings.azure_container}@"
                f"{settings.azure_storage_account}.dfs.core.windows.net/{layer}"
            )
        if self.provider in ("s3", "s3_r2", "cloudflare_r2", "minio") and settings.s3_bucket:
            return f"s3a://{settings.s3_bucket}/{layer}"
        return str((settings.bronze_path.parent.parent / layer).resolve())

    def get_status_metadata(self) -> dict[str, Any]:
        return {
            "provider": self.provider if self.is_cloud_enabled else "local_medallion",
            "cloud_enabled": self.is_cloud_enabled,
            "bronze_uri": self.get_spark_uri("bronze"),
            "silver_uri": self.get_spark_uri("silver"),
            "gold_uri": self.get_spark_uri("gold"),
            "last_sync_at": self.last_sync_at,
            "sync_status": self.last_sync_status,
            "last_error": self.last_error,
        }

    def sync_medallion_files_async(
        self,
        day: str,
        bronze_file: Path,
        silver_file: Path,
        gold_file: Path,
    ) -> None:
        """Asynchronously pushes Bronze, Silver, and Gold partitions to the configured Cloud Lakehouse."""
        if not self.is_cloud_enabled:
            return
        t = threading.Thread(
            target=self._sync_worker,
            args=(day, bronze_file, silver_file, gold_file),
            daemon=True,
        )
        t.start()

    def _sync_worker(
        self,
        day: str,
        bronze_file: Path,
        silver_file: Path,
        gold_file: Path,
    ) -> None:
        if not self._lock.acquire(blocking=False):
            return
        try:
            files_to_push = [
                (f"bronze/date={day}/{bronze_file.name}", bronze_file, "application/x-ndjson"),
                (f"silver/date={day}/{silver_file.name}", silver_file, "application/x-ndjson"),
                (f"gold/date={day}/{gold_file.name}", gold_file, "application/json"),
            ]
            if self.provider == "azure_adls":
                self._upload_to_azure(files_to_push)
            elif self.provider in ("s3", "s3_r2", "cloudflare_r2", "minio"):
                self._upload_to_s3(files_to_push)

            self.last_sync_at = now_dhaka().isoformat()
            self.last_sync_status = "SYNCED_TO_CLOUD"
            self.last_error = None
        except Exception as exc:
            self.last_sync_status = "CLOUD_SYNC_ERROR"
            self.last_error = str(exc)[:160]
        finally:
            self._lock.release()

    def _upload_to_azure(self, items: list[tuple[str, Path, str]]) -> None:
        # 1. Zero-dependency SAS URL upload (works immediately with an Azure Container SAS URL)
        if settings.azure_storage_sas_url:
            base_url, _, sas_token = settings.azure_storage_sas_url.partition("?")
            base_url = base_url.rstrip("/")
            for remote_key, local_path, content_type in items:
                if not local_path.exists():
                    continue
                target_url = f"{base_url}/{remote_key}?{sas_token}"
                payload = local_path.read_bytes()
                req = urllib.request.Request(
                    target_url,
                    data=payload,
                    method="PUT",
                    headers={
                        "x-ms-blob-type": "BlockBlob",
                        "Content-Type": content_type,
                        "Content-Length": str(len(payload)),
                    },
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    _ = resp.status
            return

        # 2. Azure SDK upload via Connection String or Account Key
        from azure.storage.blob import BlobServiceClient  # type: ignore

        if settings.azure_storage_connection_string:
            client = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)
        else:
            account_url = f"https://{settings.azure_storage_account}.blob.core.windows.net"
            client = BlobServiceClient(account_url=account_url, credential=settings.azure_storage_key)

        container_client = client.get_container_client(settings.azure_container)
        for remote_key, local_path, _ in items:
            if not local_path.exists():
                continue
            with open(local_path, "rb") as data:
                container_client.upload_blob(name=remote_key, data=data, overwrite=True)

    def _upload_to_s3(self, items: list[tuple[str, Path, str]]) -> None:
        import boto3  # type: ignore

        s3_kwargs: dict[str, Any] = {
            "aws_access_key_id": settings.aws_access_key_id,
            "aws_secret_access_key": settings.aws_secret_access_key,
            "region_name": settings.s3_region or "auto",
        }
        if settings.s3_endpoint_url:
            s3_kwargs["endpoint_url"] = settings.s3_endpoint_url

        s3 = boto3.client("s3", **s3_kwargs)
        for remote_key, local_path, content_type in items:
            if not local_path.exists():
                continue
            s3.upload_file(
                str(local_path),
                settings.s3_bucket,
                remote_key,
                ExtraArgs={"ContentType": content_type},
            )


cloud_connector = CloudLakehouseConnector()
