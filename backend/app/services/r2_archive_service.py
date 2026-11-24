"""
Cloudflare R2 Daily Medallion Archiver & 48-Hour Rolling Server Retention Manager.

Keeps daily 24-hour files (`news_stream_YYYY-MM-DD.jsonl` and `.log`) and active
Medallion tables on the server for the 48-hour (2-day) retention period.
Once the retention period expires, ALL THREE Medallion layers (Gold, Silver, Bronze)
plus the raw stream log and summary report are uploaded into a timestamped and
date-partitioned folder in Cloudflare R2 before local files are pruned:

  retention_archives/date=<YYYY-MM-DD>/ts=<YYYY-MM-DD_HH-MM-SS>/
    ├── gold/gold_alerts_<YYYY-MM-DD>.json
    ├── silver/silver_disruptions_<YYYY-MM-DD>.jsonl
    ├── bronze/bronze_articles_<YYYY-MM-DD>.jsonl
    ├── summary/stream_48h_<YYYY-MM-DD>.txt
    └── logs/news_stream_<YYYY-MM-DD>.log
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import requests

try:
    from app.core.config import now_dhaka, settings
    from lakehouse.elt.medallion_manager import MedallionLakehouseManager
except ImportError:
    from backend.app.core.config import now_dhaka, settings
    from backend.lakehouse.elt.medallion_manager import MedallionLakehouseManager

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
        self.lakehouse = MedallionLakehouseManager()
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

    def _ensure_medallion_layers_on_disk(self, day_str: str) -> tuple[Path, Path, Path, Path]:
        """
        Ensures Bronze, Silver, Gold, and Summary TXT files exist on disk for `day_str`
        so that all three layers are always archived to Cloudflare R2 after retention.
        """
        bronze_file = self.lakehouse.bronze_dir / f"bronze_articles_{day_str}.jsonl"
        silver_file = self.lakehouse.silver_dir / f"silver_disruptions_{day_str}.jsonl"
        gold_file = self.lakehouse.gold_dir / f"gold_alerts_{day_str}.json"
        txt_file = self.lakehouse.archive_48h_dir / f"stream_48h_{day_str}.txt"

        raw_stream = self.logs_dir / f"news_stream_{day_str}.jsonl"
        if raw_stream.exists() and (
            not bronze_file.exists() or not silver_file.exists() or not gold_file.exists()
        ):
            raw_items: list[dict[str, Any]] = []
            try:
                for line in raw_stream.read_text(encoding="utf-8", errors="replace").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        if isinstance(obj, dict):
                            raw_items.append(obj)
                    except ValueError:
                        continue
            except OSError:
                pass

            silver_records, gold_alerts = self.lakehouse._compute_layers(raw_items, day_str)
            self.lakehouse.bronze_dir.mkdir(parents=True, exist_ok=True)
            self.lakehouse.silver_dir.mkdir(parents=True, exist_ok=True)
            self.lakehouse.gold_dir.mkdir(parents=True, exist_ok=True)
            self.lakehouse.archive_48h_dir.mkdir(parents=True, exist_ok=True)

            bronze_file.write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in raw_items)
                + ("\n" if raw_items else ""),
                encoding="utf-8",
            )
            silver_file.write_text(
                "\n".join(json.dumps(s, ensure_ascii=False) for s in silver_records)
                + ("\n" if silver_records else ""),
                encoding="utf-8",
            )
            gold_file.write_text(
                json.dumps(gold_alerts, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            report_txt = self.lakehouse._format_txt_report(
                day_str, raw_items, silver_records, gold_alerts, now_dhaka().isoformat()
            )
            txt_file.write_text(report_txt, encoding="utf-8")

        return bronze_file, silver_file, gold_file, txt_file

    def archive_day_medallion_bundle(
        self,
        day_str: str,
        ts_slug: str,
        dry_run: bool = False,
    ) -> tuple[bool, list[str], list[str]]:
        """
        Uploads Gold, Silver, Bronze, Summary TXT, and raw logs for `day_str` into a
        date + timestamp folder in Cloudflare R2:
          retention_archives/date=<YYYY-MM-DD>/ts=<YYYY-MM-DD_HH-MM-SS>/
            ├── gold/gold_alerts_<YYYY-MM-DD>.json
            ├── silver/silver_disruptions_<YYYY-MM-DD>.jsonl
            ├── bronze/bronze_articles_<YYYY-MM-DD>.jsonl
            ├── summary/stream_48h_<YYYY-MM-DD>.txt
            └── logs/news_stream_<YYYY-MM-DD>.(jsonl|log)
        Also updates the canonical date-partitioned paths (`gold/date=...`, `silver/date=...`, `bronze/date=...`).
        """
        bronze_file, silver_file, gold_file, txt_file = self._ensure_medallion_layers_on_disk(day_str)
        y, mo, d = day_str.split("-")
        ts_folder = f"retention_archives/date={day_str}/ts={ts_slug}"

        targets: list[tuple[Path, str, bool]] = [
            # (local_path, r2_object_key, is_required_medallion_layer)
            (gold_file, f"{ts_folder}/gold/{gold_file.name}", True),
            (silver_file, f"{ts_folder}/silver/{silver_file.name}", True),
            (bronze_file, f"{ts_folder}/bronze/{bronze_file.name}", True),
            (txt_file, f"{ts_folder}/summary/{txt_file.name}", False),
            # Canonical date-partitioned Lakehouse folders in Cloudflare R2
            (gold_file, f"gold/date={day_str}/{gold_file.name}", False),
            (silver_file, f"silver/date={day_str}/{silver_file.name}", False),
            (bronze_file, f"bronze/date={day_str}/{bronze_file.name}", False),
        ]

        for ext in ("jsonl", "log"):
            raw_p = self.logs_dir / f"news_stream_{day_str}.{ext}"
            if raw_p.exists():
                targets.append((raw_p, f"{ts_folder}/logs/{raw_p.name}", ext == "jsonl"))
                targets.append((raw_p, f"logs/{y}/{mo}/{d}/{raw_p.name}", False))

        uploaded_keys: list[str] = []
        errors: list[str] = []
        all_required_ok = True

        for local_p, r2_key, is_req in targets:
            if not local_p.exists():
                if is_req:
                    all_required_ok = False
                    errors.append(f"Missing required Medallion file for {day_str}: {local_p.name}")
                continue
            if dry_run:
                uploaded_keys.append(f"[dry-run] {r2_key}")
                continue
            ok, msg = self.upload_file_to_r2(local_p, r2_key)
            if ok:
                uploaded_keys.append(r2_key)
            else:
                if is_req:
                    all_required_ok = False
                errors.append(f"R2 upload failed for {r2_key}: {msg}")

        return all_required_ok, uploaded_keys, errors

    def archive_and_prune_logs(self, dry_run: bool = False) -> dict[str, Any]:
        """
        Maintains a 48-hour (2-day) rolling retention window on the server:
        - Keeps today (D) and yesterday (D-1) hot on local disk.
        - Backs up yesterday's completed 24h Gold, Silver, Bronze & logs to R2 without deleting.
        - After the 48h retention period expires (<= D-2), saves Gold, Silver, and Bronze
          into a timestamp + date folder (`retention_archives/date=<YYYY-MM-DD>/ts=<TIMESTAMP>/`)
          in Cloudflare R2 and then prunes the expired local files.
        """
        now_dt = now_dhaka()
        today = now_dt.date()
        ts_slug = now_dt.strftime("%Y-%m-%d_%H-%M-%S")
        prune_cutoff = today - dt.timedelta(days=self.retention_days)
        yesterday = today - dt.timedelta(days=1)

        uploaded: list[str] = []
        pruned: list[str] = []
        errors: list[str] = []

        # Collect all distinct dates present in logs_dir or medallion storage
        candidate_days: set[str] = set()
        if self.logs_dir.exists():
            for path in sorted(self.logs_dir.iterdir()):
                m = LOG_DATE_RE.match(path.name)
                if m and path.is_file():
                    candidate_days.add(m.group(1))
        for layer_dir, prefix in (
            (self.lakehouse.bronze_dir, "bronze_articles_"),
            (self.lakehouse.silver_dir, "silver_disruptions_"),
            (self.lakehouse.gold_dir, "gold_alerts_"),
        ):
            if layer_dir.exists():
                for p in layer_dir.iterdir():
                    if p.name.startswith(prefix):
                        day_part = p.stem.replace(prefix, "")
                        if re.match(r"^\d{4}-\d{2}-\d{2}$", day_part):
                            candidate_days.add(day_part)

        for day_str in sorted(candidate_days):
            try:
                file_date = dt.date.fromisoformat(day_str)
            except ValueError:
                continue

            if file_date <= prune_cutoff:
                ok_bundle, up_keys, err_list = self.archive_day_medallion_bundle(
                    day_str=day_str,
                    ts_slug=ts_slug,
                    dry_run=dry_run,
                )
                uploaded.extend(up_keys)
                errors.extend(err_list)

                local_files_to_prune = [
                    self.logs_dir / f"news_stream_{day_str}.jsonl",
                    self.logs_dir / f"news_stream_{day_str}.log",
                    self.lakehouse.bronze_dir / f"bronze_articles_{day_str}.jsonl",
                    self.lakehouse.silver_dir / f"silver_disruptions_{day_str}.jsonl",
                    self.lakehouse.gold_dir / f"gold_alerts_{day_str}.json",
                    self.lakehouse.archive_48h_dir / f"stream_48h_{day_str}.txt",
                ]

                if dry_run:
                    for lp in local_files_to_prune:
                        if lp.exists():
                            pruned.append(f"[dry-run] {lp.name}")
                    continue

                # Only delete local files after Gold, Silver, and Bronze are safely saved in Cloudflare R2
                if ok_bundle:
                    for lp in local_files_to_prune:
                        if lp.exists():
                            try:
                                lp.unlink()
                                pruned.append(lp.name)
                            except OSError as exc:
                                errors.append(f"Failed deleting {lp.name}: {exc}")
            elif file_date == yesterday and self.is_configured() and not dry_run:
                # Hot backup of yesterday's Gold, Silver, Bronze & logs without deleting locally
                _, up_keys, _ = self.archive_day_medallion_bundle(
                    day_str=day_str,
                    ts_slug=ts_slug,
                    dry_run=False,
                )
                uploaded.extend(up_keys)

        self.last_run = {
            "last_checked_at": now_dt.isoformat(),
            "archive_timestamp_folder": ts_slug,
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
            "r2_folder_schema": "retention_archives/date=<YYYY-MM-DD>/ts=<YYYY-MM-DD_HH-MM-SS>/{gold,silver,bronze,summary,logs}/",
            "local_log_files": local_files,
            "last_run": self.last_run,
        }


def start_r2_archive_worker(service: R2ArchiveService, interval_seconds: int = 3600) -> None:
    """Runs R2 Medallion archival & 48h pruning in a background daemon thread."""
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

    parser = argparse.ArgumentParser(description="BigWarn Cloudflare R2 48h Medallion Archiver")
    parser.add_argument("--dry-run", action="store_true", help="Preview uploads/prunes without modifying files")
    args = parser.parse_args()
    svc = R2ArchiveService()
    print(json.dumps(svc.archive_and_prune_logs(dry_run=args.dry_run), indent=2))
