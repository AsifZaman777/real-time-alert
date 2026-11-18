"""
Cloud Lakehouse Connector (Azure ADLS Gen2, AWS S3 / Cloudflare R2, and Spark Cloud URIs).
Syncs Bronze, Silver, Gold, and 48-hour Rolling Stream Archives (.jsonl + .txt/.log)
to cloud object storage, and restores Yesterday + Today streams on ephemeral container startup.
"""
from __future__ import annotations

import json
import threading
import urllib.request
from pathlib import Path
from typing import Any

from backend.app.core.config import active_two_day_window, now_dhaka, settings


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

    def upload_files_sync(self, files: list[tuple[str, Path, str]]) -> bool:
        """Synchronously pushes archive files (blocking on lock) and returns True if uploaded cleanly."""
        if not self.is_cloud_enabled or not files:
            return not self.is_cloud_enabled
        return self._push_worker(list(files), blocking=True)

    def upload_files_async(self, files: list[tuple[str, Path, str]]) -> None:
        """Asynchronously pushes arbitrary archive files (e.g. timestamped Gold/Silver/Bronze .txt) to Cloud Storage."""
        if not self.is_cloud_enabled or not files:
            return
        threading.Thread(
            target=self._push_worker,
            args=(list(files), False),
            daemon=True,
        ).start()

    def sync_medallion_files_async(
        self,
        day: str,
        bronze_file: Path,
        silver_file: Path,
        gold_file: Path,
        extra_archives: list[tuple[str, Path, str]] | None = None,
    ) -> None:
        """Asynchronously pushes Bronze, Silver, Gold, raw active 2-day streams, and seen_urls to Cloud Lakehouse."""
        if not self.is_cloud_enabled:
            return
        files_to_push = [
            (f"bronze/date={day}/{bronze_file.name}", bronze_file, "application/x-ndjson"),
            (f"silver/date={day}/{silver_file.name}", silver_file, "application/x-ndjson"),
            (f"gold/date={day}/{gold_file.name}", gold_file, "application/json"),
        ] + (extra_archives or [])
        threading.Thread(
            target=self._push_worker,
            args=(files_to_push, False),
            daemon=True,
        ).start()

    def _push_worker(self, files_to_push: list[tuple[str, Path, str]], blocking: bool = False) -> bool:
        if not self._lock.acquire(blocking=blocking):
            return False
        try:
            if self.provider == "azure_adls":
                self._upload_to_azure(files_to_push)
            elif self.provider in ("s3", "s3_r2", "cloudflare_r2", "minio"):
                self._upload_to_s3(files_to_push)

            self.last_sync_at = now_dhaka().isoformat()
            self.last_sync_status = "SYNCED_TO_CLOUD"
            self.last_error = None
            return True
        except Exception as exc:
            self.last_sync_status = "CLOUD_SYNC_ERROR"
            self.last_error = str(exc)[:160]
            return False
        finally:
            self._lock.release()

    @staticmethod
    def _merge_jsonl_records(remote_bytes: bytes, local_target: Path) -> tuple[int, str]:
        """Merges R2 backup records with any local records, deduplicated by URL/headline."""
        seen: set[str] = set()
        merged: list[str] = []
        for raw_text in (
            remote_bytes.decode("utf-8", errors="replace"),
            local_target.read_text(encoding="utf-8", errors="replace") if local_target.exists() else "",
        ):
            for ln in raw_text.splitlines():
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    obj = json.loads(ln)
                    key = obj.get("url") or f"{obj.get('source','')}:{obj.get('headline','')}"
                except ValueError:
                    key = ln
                if key not in seen:
                    seen.add(key)
                    merged.append(ln)
        return len(merged), ("\n".join(merged) + "\n" if merged else "")

    def restore_last_48h_from_cloud(
        self, logs_dir: Path, active_days: list[str] | None = None
    ) -> int:
        """
        Restores missing/interrupted news streams for the active 2-day (48h) window and
        seen_urls state from Cloudflare R2 / Cloud Storage, merging cleanly by URL.
        """
        if not self.is_cloud_enabled:
            return 0
        logs_dir.mkdir(parents=True, exist_ok=True)
        days = active_days or list(active_two_day_window())
        restored = 0

        for day in days:
            local_target = logs_dir / f"news_stream_{day}.jsonl"
            for remote_key in (
                f"raw_streams/news_stream_{day}.jsonl",
                f"bronze/date={day}/bronze_articles_{day}.jsonl",
            ):
                try:
                    data = self._download_bytes(remote_key)
                    if not data:
                        continue
                    count, merged_text = self._merge_jsonl_records(data, local_target)
                    local_cnt = sum(
                        1
                        for ln in (
                            local_target.read_text(encoding="utf-8", errors="replace").splitlines()
                            if local_target.exists()
                            else []
                        )
                        if ln.strip()
                    )
                    if count > local_cnt and merged_text:
                        local_target.write_text(merged_text, encoding="utf-8")
                        restored += 1
                        print(
                            f"[CloudLakehouse] Restored {remote_key} ({count} records, was {local_cnt}) -> {local_target.name}"
                        )
                    break
                except Exception:
                    continue

        # Also restore seen_urls.json so scraper resumes without missing/duplicating URLs
        seen_local = logs_dir.parent / "seen_urls.json"
        try:
            seen_bytes = self._download_bytes("state/seen_urls.json")
            if seen_bytes:
                remote_seen = json.loads(seen_bytes.decode("utf-8"))
                local_seen = (
                    json.loads(seen_local.read_text(encoding="utf-8")) if seen_local.exists() else {}
                )
                if isinstance(remote_seen, dict) and isinstance(local_seen, dict):
                    merged_seen = {**remote_seen, **local_seen}
                    if len(merged_seen) > len(local_seen):
                        seen_local.write_text(json.dumps(merged_seen), encoding="utf-8")
        except Exception:
            pass
        return restored

    def _download_bytes(self, remote_key: str) -> bytes | None:
        if self.provider == "azure_adls":
            if settings.azure_storage_sas_url:
                base_url, _, sas_token = settings.azure_storage_sas_url.partition("?")
                target_url = f"{base_url.rstrip('/')}/{remote_key}?{sas_token}"
                req = urllib.request.Request(target_url, method="GET")
                with urllib.request.urlopen(req, timeout=12) as resp:
                    return resp.read()
            from azure.storage.blob import BlobServiceClient  # type: ignore

            client = (
                BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)
                if settings.azure_storage_connection_string
                else BlobServiceClient(
                    account_url=f"https://{settings.azure_storage_account}.blob.core.windows.net",
                    credential=settings.azure_storage_key,
                )
            )
            blob = client.get_blob_client(container=settings.azure_container, blob=remote_key)
            if blob.exists():
                return blob.download_blob().readall()
        elif self.provider in ("s3", "s3_r2", "cloudflare_r2", "minio"):
            import boto3  # type: ignore

            s3_kwargs: dict[str, Any] = {
                "aws_access_key_id": settings.aws_access_key_id,
                "aws_secret_access_key": settings.aws_secret_access_key,
                "region_name": settings.s3_region or "auto",
            }
            if settings.s3_endpoint_url:
                s3_kwargs["endpoint_url"] = settings.s3_endpoint_url
            s3 = boto3.client("s3", **s3_kwargs)
            obj = s3.get_object(Bucket=settings.s3_bucket, Key=remote_key)
            return obj["Body"].read()
        return None

    def _upload_to_azure(self, items: list[tuple[str, Path, str]]) -> None:
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
