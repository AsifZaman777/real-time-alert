"""
REST & Stream API Server for the BigWarn Platform.
Serves CORS-enabled endpoints for the Next.js Browser + Mobile Edge PWA Frontend,
as well as the standalone embedded debug dashboard.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
POC_DIR = ROOT_DIR / "news-live-POC"
if str(POC_DIR) not in sys.path:
    sys.path.insert(0, str(POC_DIR))

import news_dashboard as legacy_dashboard  # noqa: E402
from backend.app.core.config import settings  # noqa: E402
from backend.app.services.stream_service import DAY_RE, StreamService  # noqa: E402
from backend.ingestion.sources.registry import get_all_sources_metadata  # noqa: E402


def make_api_handler(service: StreamService):
    class ApiHandler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self._send(204, b"", "text/plain")

        def _json(self, obj, code: int = 200) -> None:
            self._send(
                code,
                json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                "application/json; charset=utf-8",
            )

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            path = u.path.rstrip("/") or "/"

            if path in ("/", "/index.html"):
                self._send(200, legacy_dashboard.PAGE.encode("utf-8"), "text/html; charset=utf-8")
            elif path in ("/api/days", "/api/v1/days"):
                self._json({"today": service.today_str(), "days": service.list_days()})
            elif path in ("/api/items", "/api/v1/items"):
                day = (q.get("date") or [service.today_str()])[0]
                if not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                try:
                    after = max(0, int((q.get("after") or ["0"])[0]))
                except ValueError:
                    after = 0
                total, items = service.read_items(day, after)
                self._json({"date": day, "total": total, "items": items})
            elif path in ("/api/debug", "/api/v1/debug"):
                day = (q.get("date") or [service.today_str()])[0]
                if not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                self._json(service.read_debug_info(day))
            elif path in ("/api/sources", "/api/v1/sources"):
                self._json({"total": 45, "sources": get_all_sources_metadata()})
            elif path in ("/api/lakehouse", "/api/v1/lakehouse"):
                day = (q.get("date") or [service.today_str()])[0]
                if not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                self._json(service.get_lakehouse_elt(day))
            elif path in ("/api/health", "/api/v1/health"):
                self._json({"status": "ok", "service": settings.app_name, "version": settings.version})
            else:
                self._send(404, b"not found", "text/plain")

    return ApiHandler


def create_server(logdir: Path | None = None, port: int = settings.api_port, host: str = settings.api_host) -> ThreadingHTTPServer:
    service = StreamService(primary_logdir=logdir)
    return ThreadingHTTPServer((host, port), make_api_handler(service))


def start_api_in_thread(logdir: Path | None = None, port: int = settings.api_port) -> str:
    srv = create_server(logdir=logdir, port=port)
    threading.Thread(target=srv.serve_forever, daemon=True, name="bigwarn-api").start()
    return f"http://127.0.0.1:{port}"


def main():
    p = argparse.ArgumentParser(description="BigWarn Backend REST & Stream API Server")
    p.add_argument("--logs", default=str(settings.logs_dir), help="folder holding news_stream_YYYY-MM-DD.jsonl")
    p.add_argument("--port", type=int, default=settings.api_port)
    p.add_argument("--host", default=settings.api_host)
    a = p.parse_args()
    srv = create_server(Path(a.logs), port=a.port, host=a.host)
    print(f"BigWarn Backend API running on http://{a.host}:{a.port} (reading {Path(a.logs).resolve()}). Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

