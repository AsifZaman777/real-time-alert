"""
BigWarn Unified & Configurable Public Stream Pipeline Orchestrator.

Supports 3 Deployment Modes (100% Free & Configurable):
  1. Live All-in-One Server Mode (default):
     Runs the 45-portal crawler loop, Medallion Lakehouse ELT (Bronze -> Silver -> Gold),
     Cloud Lakehouse Sync, and the Public REST/SSE/NDJSON/GeoRSS API server in one process.
  2. Public HTTPS Tunnel Mode (--public-tunnel):
     Automatically opens a free Cloudflare Quick Tunnel (https://*.trycloudflare.com)
     so anyone on the internet can consume your local stream immediately.
  3. Serverless One-Shot Export Mode (--one-shot):
     Used by GitHub Actions / Cron jobs to crawl a round, build the Medallion Lakehouse,
     and export static public feeds (JSON, JSONL, GeoRSS XML, and an interactive HTML catalog)
     into `public_feed/` for free hosting on GitHub Pages or Cloudflare Pages.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.api.server import create_server  # noqa: E402
from backend.app.core.config import now_dhaka, settings  # noqa: E402
from backend.app.services.stream_service import StreamService  # noqa: E402
from backend.ingestion.scraper import live_news_stream as streamer  # noqa: E402
from backend.lakehouse.elt.cloud_lakehouse import cloud_connector  # noqa: E402


def export_static_public_feed(service: StreamService, out_dir: Path) -> dict:
    """
    Exports the latest Medallion Lakehouse Gold, Silver, and GeoRSS feeds to static files
    so they can be served for free on GitHub Pages, Cloudflare Pages, or S3/R2 buckets.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    gold_feed = service.get_public_feed(day="latest", layer="gold", recent_hours=3.0, limit=250)
    silver_feed = service.get_public_feed(day="latest", layer="silver", recent_hours=6.0, limit=500)
    rss_xml = service.format_rss_xml(gold_feed)

    (out_dir / "gold_alerts_latest.json").write_text(
        json.dumps(gold_feed, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "silver_stream_latest.jsonl").write_text(
        "\n".join(json.dumps(it, ensure_ascii=False) for it in silver_feed.get("items", [])) + "\n",
        encoding="utf-8",
    )
    (out_dir / "feed.rss").write_text(rss_xml, encoding="utf-8")

    status_meta = {
        "generated_at": now_dhaka().isoformat(),
        "date": gold_feed.get("date"),
        "active_3h_gold_clusters": gold_feed.get("total_matched", 0),
        "recent_6h_silver_articles": silver_feed.get("total_matched", 0),
        "cloud_lakehouse": cloud_connector.get_status_metadata(),
        "endpoints": {
            "gold_json": "gold_alerts_latest.json",
            "silver_jsonl": "silver_stream_latest.jsonl",
            "georss_xml": "feed.rss",
        },
    }
    (out_dir / "status.json").write_text(
        json.dumps(status_meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    index_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BigWarn — Open Bangladesh Real-Time Threat & News Feed</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; background: #0B1120; color: #F8FAFC; max-width: 880px; margin: 0 auto; padding: 32px 20px; line-height: 1.6; }}
    h1 {{ color: #38BDF8; margin-bottom: 4px; }}
    .card {{ background: #111827; border: 1px solid #1E293B; border-radius: 12px; padding: 16px 20px; margin-top: 16px; }}
    a {{ color: #34D399; text-decoration: none; font-weight: 700; }}
    code {{ background: #1E293B; padding: 2px 6px; border-radius: 5px; color: #7DD3FC; font-size: 13px; }}
  </style>
</head>
<body>
  <h1>🚨 BigWarn Public Threat & Disruption Feed</h1>
  <p>Updated: <code>{status_meta['generated_at']}</code> • Active 3h Threat Clusters: <b>{status_meta['active_3h_gold_clusters']}</b></p>
  <div class="card">
    <h3>📡 Public Static & CDN Feed Files</h3>
    <ul>
      <li><a href="./gold_alerts_latest.json">gold_alerts_latest.json</a> — Corroborated Gold Threat Clusters (JSON)</li>
      <li><a href="./silver_stream_latest.jsonl">silver_stream_latest.jsonl</a> — Enriched Silver Threat Stream (NDJSON / JSONL)</li>
      <li><a href="./feed.rss">feed.rss</a> — RSS 2.0 + GeoRSS XML Feed (with OpenStreetMap coordinates)</li>
      <li><a href="./status.json">status.json</a> — Pipeline & Medallion Lakehouse Health Telemetry</li>
    </ul>
  </div>
</body>
</html>
"""
    (out_dir / "index.html").write_text(index_html, encoding="utf-8")
    return status_meta


def run_crawler_round(log_dir: Path) -> None:
    """Runs one crawling round across the 45 Bangladeshi news portals."""
    seen = streamer.load_seen()
    state = streamer.StreamState(log_dir)
    try:
        streamer.crawl_round(state, seen)
    finally:
        state.close()


def start_cloudflare_tunnel(port: int) -> None:
    """Starts a free Cloudflare Quick Tunnel in a background process and prints the public HTTPS URL."""
    cmd = ["npx", "--yes", "cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}"]
    print(f"[BigWarn Tunnel] Starting free public HTTPS tunnel for port {port}...")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            shell=(os.name == "nt"),
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            if "trycloudflare.com" in line:
                print(f"\n🌍 [PUBLIC STREAM URL LIVE] -> {line.strip()}\n")
    except Exception as exc:
        print(f"[BigWarn Tunnel] Could not start cloudflared tunnel: {exc}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="BigWarn Unified Free & Configurable Public Pipeline")
    parser.add_argument("--host", default=settings.api_host)
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", str(settings.api_port))))
    parser.add_argument("--logs", default=str(settings.logs_dir))
    parser.add_argument("--export-dir", default=str(ROOT_DIR / "public_feed"))
    parser.add_argument("--interval", type=int, default=180, help="Seconds between live crawler rounds")
    parser.add_argument("--no-crawler", action="store_true", help="Serve API & feeds without background crawling")
    parser.add_argument("--crawl-now", action="store_true", help="Run a fresh 45-portal crawl round during --one-shot")
    parser.add_argument("--one-shot", action="store_true", help="Build Lakehouse + export static public_feed/ and exit")
    parser.add_argument("--public-tunnel", action="store_true", help="Expose local server via free Cloudflare HTTPS tunnel")
    args = parser.parse_args()

    log_dir = Path(args.logs)
    export_dir = Path(args.export_dir)
    service = StreamService(primary_logdir=log_dir)

    if args.one_shot:
        if args.crawl_now:
            print("[BigWarn Pipeline] Running 45-portal crawl round...")
            run_crawler_round(log_dir)
        meta = export_static_public_feed(service, export_dir)
        print(
            f"[BigWarn Pipeline] Exported public feeds to {export_dir.resolve()}:\n"
            f"  - Gold clusters (<=3h): {meta['active_3h_gold_clusters']}\n"
            f"  - Silver records (<=6h): {meta['recent_6h_silver_articles']}"
        )
        return

    if not args.no_crawler:
        def _bg_worker() -> None:
            while True:
                try:
                    export_static_public_feed(service, export_dir)
                    run_crawler_round(log_dir)
                    export_static_public_feed(service, export_dir)
                except Exception as e:
                    print(f"[BigWarn Pipeline] Background round warning: {e}")
                time.sleep(max(30, args.interval))

        threading.Thread(target=_bg_worker, daemon=True, name="bigwarn-pipeline-worker").start()
    else:
        export_static_public_feed(service, export_dir)

    if args.public_tunnel:
        threading.Thread(
            target=start_cloudflare_tunnel, args=(args.port,), daemon=True, name="bigwarn-tunnel"
        ).start()

    srv = create_server(logdir=log_dir, port=args.port, host=args.host)
    print(
        f"======================================================================\n"
        f"🚨 BigWarn Configurable Public Stream Pipeline Running!\n"
        f"  • Local / LAN Base URL : http://{args.host}:{args.port}\n"
        f"  • Live SSE Stream      : http://127.0.0.1:{args.port}/api/v1/stream/live\n"
        f"  • Queryable JSON Feed  : http://127.0.0.1:{args.port}/api/v1/stream/feed?layer=gold&recent_hours=3\n"
        f"  • NDJSON Data Stream   : http://127.0.0.1:{args.port}/api/v1/feed.jsonl\n"
        f"  • GeoRSS XML Feed      : http://127.0.0.1:{args.port}/api/v1/feed.rss\n"
        f"  • Cloud Lakehouse Mode : {cloud_connector.get_status_metadata()['provider']}\n"
        f"======================================================================"
    )
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
