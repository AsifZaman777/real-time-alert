"""
Cloudflare R2 Daily Log Archiver & 48-Hour Rolling Server Retention Manager.

Keeps daily 24-hour files (`news_stream_YYYY-MM-DD.jsonl` and `.log`) on the
server for a 48-hour (2-day) window. Files older than 48 hours are uploaded to
Cloudflare R2 with date-partitioned keys and pruned locally after confirmation.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import requests

from backend.app.core.config import now_dhaka, settings

LOG_DATE_RE = re.compile(r"^news_stream_(\d{4}-\d{2}-\d{2})\.(jsonl|log)$")


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _get_signature_key(secret_key: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


class R2ArchiveService:
    def __init__(
        self,
        logs_dir: Path = settings.logs_dir,
        retention_hours: int = settings.log_retention_hours,
    ):
        self.logs_dir = logs_dir
        self.retention_days = max(2, retention_hours // 24)
        self.access_key = settings.r2_access_key_id
        self.secret_key = settings.r2_secret_access_key
        self.region = settings.r2_region or "auto"
        self.bucket = settings.r2_bucket or "bigwarn"
        self.base_endpoint = self._normalize_endpoint(settings.r2_endpoint_url, self.bucket)
        self.last_run: dict[str, Any] = {
            "last_checked_at": None,
            "uploaded": [],
            "pruned": [],
            "errors": [],
        }

    @staticmethod
    def _normalize_endpoint(endpoint_url: str, bucket: str) -> str:
        clean = (endpoint_url or "").strip().rstrip("/")
        if not clean:
            return ""
        suffix = f"/{bucket}"
        if clean.endswith(suffix):
            clean = clean[: -len(suffix)]
        return clean

    def is_configured(self) -> bool:
        return bool(self.access_key and self.secret_key and self.base_endpoint and self.bucket)

    def upload_file_to_r2(self, local_path: Path, object_key: str) -> tuple[bool, str]:
        """Uploads a local file to Cloudflare R2 using S3 SigV4 PUT."""
        if not self.is_configured():
            return False, "Cloudflare R2 credentials not configured"
        if not local_path.exists():
            return False, f"File not found: {local_path}"

        payload = local_path.read_bytes()
        payload_hash = hashlib.sha256(payload).hexdigest()

        parsed = urlparse(self.base_endpoint)
        host = parsed.netloc
        canonical_uri = f"/{self.bucket}/{quote(object_key.lstrip('/'), safe='/')}"
        target_url = f"{parsed.scheme}://{host}{canonical_uri}"

        now_utc = dt.datetime.now(dt.timezone.utc)
        amz_date = now_utc.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now_utc.strftime("%Y%m%d")

        canonical_headers = (
            f"host:{host}\n"
            f"x-amz-content-sha256:{payload_hash}\n"
            f"x-amz-date:{amz_date}\n"
        )
        signed_headers = "host;x-amz-content-sha256;x-amz-date"
        canonical_request = "\n".join(
            [
                "PUT",
                canonical_uri,
                "",
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )

        credential_scope = f"{date_stamp}/{self.region}/s3/aws4_request"
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
            ]
        )

        signing_key = _get_signature_key(self.secret_key, date_stamp, self.region, "s3")
        signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        authorization = (
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )

        headers = {
            "Host": host,
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
            "Authorization": authorization,
            "Content-Type": "application/octet-stream",
        }

        try:
            resp = requests.put(target_url, data=payload, headers=headers, timeout=120)
            if 200 <= resp.status_code < 300:
                return True, f"HTTP {resp.status_code}"
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
        except requests.RequestException as exc:
            return False, str(exc)

    def archive_and_prune_logs(self, dry_run: bool = False) -> dict[str, Any]:
        """
        Maintains a 48-hour (2-day) rolling window on the server:
        - Keeps today (D) and yesterday (D-1) on local disk.
        - Backs up yesterday's completed 24h file to R2 without deleting it.
        - Uploads any file older than 48h (<= D-2) to Cloudflare R2 and deletes locally.
        """
        today = now_dhaka().date()
        prune_cutoff = today - dt.timedelta(days=self.retention_days)
        yesterday = today - dt.timedelta(days=1)

        uploaded: list[str] = []
        pruned: list[str] = []
        errors: list[str] = []

        if self.logs_dir.exists():
            for path in sorted(self.logs_dir.iterdir()):
                m = LOG_DATE_RE.match(path.name)
                if not m or not path.is_file():
                    continue
                try:
                    file_date = dt.date.fromisoformat(m.group(1))
                except ValueError:
                    continue

                y, mo, d = m.group(1).split("-")
                object_key = f"logs/{y}/{mo}/{d}/{path.name}"

                if file_date <= prune_cutoff:
                    if dry_run:
                        uploaded.append(f"[dry-run] {object_key}")
                        pruned.append(f"[dry-run] {path.name}")
                        continue
                    ok, msg = self.upload_file_to_r2(path, object_key)
                    if ok:
                        uploaded.append(object_key)
                        # Also archive matching Gold snapshot if it exists
                        gold_file = settings.gold_path / f"gold_alerts_{m.group(1)}.json"
                        if gold_file.exists():
                            g_ok, _ = self.upload_file_to_r2(gold_file, f"gold/{y}/{mo}/{d}/{gold_file.name}")
                            if g_ok:
                                uploaded.append(f"gold/{y}/{mo}/{d}/{gold_file.name}")
                        try:
                            path.unlink()
                            pruned.append(path.name)
                        except OSError as exc:
                            errors.append(f"Failed deleting {path.name}: {exc}")
                    else:
                        errors.append(f"R2 upload failed for {path.name}: {msg}")
                elif file_date == yesterday and self.is_configured() and not dry_run:
                    # Daily backup of completed 24h log while keeping it hot for 48h window
                    ok, _ = self.upload_file_to_r2(path, object_key)
                    if ok:
                        uploaded.append(object_key)

        self.last_run = {
            "last_checked_at": now_dhaka().isoformat(),
            "retention_hours": self.retention_days * 24,
            "prune_cutoff_date": prune_cutoff.isoformat(),
            "r2_configured": self.is_configured(),
            "uploaded": uploaded,
            "pruned": pruned,
            "errors": errors,
        }
        return self.last_run

    def get_status(self) -> dict[str, Any]:
        local_files = []
        if self.logs_dir.exists():
            for p in sorted(self.logs_dir.iterdir()):
                if LOG_DATE_RE.match(p.name) and p.is_file():
                    local_files.append({"name": p.name, "size_bytes": p.stat().st_size})
        return {
            "r2_configured": self.is_configured(),
            "bucket": self.bucket,
            "retention_hours": self.retention_days * 24,
            "local_log_files": local_files,
            "last_run": self.last_run,
        }


def start_r2_archive_worker(service: R2ArchiveService, interval_seconds: int = 3600) -> None:
    """Runs R2 archival & 48h pruning in a background daemon thread."""
    def _loop() -> None:
        while True:
            try:
                res = service.archive_and_prune_logs()
                if res["uploaded"] or res["pruned"] or res["errors"]:
                    print(
                        f"[BigWarn R2] uploaded={len(res['uploaded'])} "
                        f"pruned={len(res['pruned'])} errors={len(res['errors'])}"
                    )
            except Exception as exc:
                print(f"[BigWarn R2] worker error: {exc}")
            time.sleep(interval_seconds)

    threading.Thread(target=_loop, daemon=True, name="bigwarn-r2-archiver").start()


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="BigWarn Cloudflare R2 48h Log Archiver")
    parser.add_argument("--dry-run", action="store_true", help="Preview uploads/prunes without modifying files")
    args = parser.parse_args()
    svc = R2ArchiveService()
    print(json.dumps(svc.archive_and_prune_logs(dry_run=args.dry_run), indent=2))
