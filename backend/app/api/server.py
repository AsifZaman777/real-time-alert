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
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.api import dashboard_ui as legacy_dashboard  # noqa: E402
from backend.app.core.config import settings  # noqa: E402
from backend.app.services.stream_service import DAY_RE, StreamService  # noqa: E402
from backend.ingestion.sources.registry import get_all_sources_metadata  # noqa: E402


def make_api_handler(service: StreamService):
    class ApiHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            print(f"[BigWarn API] {self.client_address[0]} - {format % args}")

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
                day = (q.get("date") or ["latest"])[0]
                if day != "latest" and not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                self._json(service.get_lakehouse_elt(day))
            elif path in ("/api/alerts/map", "/api/v1/alerts/map"):
                day = (q.get("date") or ["latest"])[0]
                if day != "latest" and not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                self._json(service.get_map_alerts(day))
            elif path in ("/api/alerts/route", "/api/v1/alerts/route"):
                day = (q.get("date") or ["latest"])[0]
                if day != "latest" and not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                try:
                    cur_lat = float((q.get("cur_lat") or ["23.7461"])[0])
                    cur_lon = float((q.get("cur_lon") or ["90.3742"])[0])
                    dest_lat = float((q.get("dest_lat") or ["23.7330"])[0])
                    dest_lon = float((q.get("dest_lon") or ["90.4172"])[0])
                    radius_km = float((q.get("radius_km") or ["2.5"])[0])
                except ValueError:
                    return self._send(400, b"bad coordinates", "text/plain")
                todo = (q.get("todo") or [""])[0]
                include_map = (q.get("include_map") or ["0"])[0] in ("1", "true", "yes")
                self._json(
                    service.get_route_alerts(
                        day=day,
                        cur_lat=cur_lat,
                        cur_lon=cur_lon,
                        dest_lat=dest_lat,
                        dest_lon=dest_lon,
                        todo=todo,
                        radius_km=radius_km,
                        include_map=include_map,
                    )
                )
            elif path in ("/api/stream/alerts", "/api/v1/stream/alerts"):
                self._handle_sse_alerts(q)
            elif path in ("/api/stream/feed", "/api/v1/stream/feed", "/feed"):
                self._handle_public_feed(q)
            elif path in ("/api/feed.rss", "/api/v1/feed.rss", "/feed.rss"):
                self._handle_public_feed(q, default_format="rss", default_layer="gold")
            elif path in ("/api/feed.jsonl", "/api/v1/feed.jsonl", "/feed.jsonl"):
                self._handle_public_feed(q, default_format="ndjson", default_layer="silver")
            elif path in ("/api/stream/live", "/api/v1/stream/live"):
                self._handle_public_feed(q, default_format="sse", default_layer="silver")
            elif path in ("/api/health", "/api/v1/health"):
                self._json({"status": "ok", "service": settings.app_name, "version": settings.version})
            else:
                self._send(404, b"not found", "text/plain")

        def _handle_public_feed(
            self,
            q: dict[str, list[str]],
            default_format: str = "json",
            default_layer: str = "gold",
        ) -> None:
            day = (q.get("date") or ["latest"])[0]
            layer = (q.get("layer") or [default_layer])[0]
            fmt = (q.get("format") or [default_format])[0].lower().strip()
            area = (q.get("area") or [None])[0]
            event_type = (q.get("event_type") or [None])[0]
            lang = (q.get("lang") or [None])[0]
            try:
                recent_hours = float(q["recent_hours"][0]) if "recent_hours" in q else None
                after = max(0, int((q.get("after") or ["0"])[0]))
                limit = max(1, min(1000, int((q.get("limit") or ["100"])[0])))
            except ValueError:
                return self._send(400, b"invalid query parameters", "text/plain")

            if fmt == "sse":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                seen_ids: set[str] = set()
                try:
                    for _ in range(180):
                        feed_data = service.get_public_feed(
                            day=day,
                            layer=layer,
                            area=area,
                            event_type=event_type,
                            lang=lang,
                            recent_hours=recent_hours,
                            after=0,
                            limit=limit,
                        )
                        emitted = 0
                        for item in feed_data.get("items", []):
                            uid = str(item.get("cluster_id") or item.get("url") or item.get("headline") or "")
                            if uid and uid not in seen_ids:
                                seen_ids.add(uid)
                                msg = f"event: {feed_data['layer']}_item\ndata: {json.dumps(item, ensure_ascii=False)}\n\n"
                                self.wfile.write(msg.encode("utf-8"))
                                emitted += 1
                        if emitted == 0:
                            self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        time.sleep(3.0)
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                return

            feed_data = service.get_public_feed(
                day=day,
                layer=layer,
                area=area,
                event_type=event_type,
                lang=lang,
                recent_hours=recent_hours,
                after=after,
                limit=limit,
            )

            if fmt in ("ndjson", "jsonl"):
                lines = "\n".join(json.dumps(it, ensure_ascii=False) for it in feed_data.get("items", [])) + "\n"
                self._send(200, lines.encode("utf-8"), "application/x-ndjson; charset=utf-8")
            elif fmt in ("rss", "xml"):
                xml_str = service.format_rss_xml(feed_data)
                self._send(200, xml_str.encode("utf-8"), "application/rss+xml; charset=utf-8")
            else:
                self._json(feed_data)

        def _handle_sse_alerts(self, q: dict[str, list[str]]) -> None:
            day = (q.get("date") or ["latest"])[0]
            has_route = "cur_lat" in q and "cur_lon" in q and "dest_lat" in q and "dest_lon" in q
            try:
                cur_lat = float((q.get("cur_lat") or ["23.7461"])[0])
                cur_lon = float((q.get("cur_lon") or ["90.3742"])[0])
                dest_lat = float((q.get("dest_lat") or ["23.7330"])[0])
                dest_lon = float((q.get("dest_lon") or ["90.4172"])[0])
                radius_km = float((q.get("radius_km") or ["2.5"])[0])
            except ValueError:
                return self._send(400, b"bad coordinates", "text/plain")
            todo = (q.get("todo") or [""])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            last_sig = None
            try:
                for _ in range(120):
                    if has_route:
                        payload = service.get_route_alerts(day, cur_lat, cur_lon, dest_lat, dest_lon, todo, radius_km)
                        map_data = service.get_map_alerts(day)
                        payload["map_alerts"] = map_data["alerts"]
                        event_name = "route_alerts"
                    else:
                        payload = service.get_map_alerts(day)
                        event_name = "map_alerts"

                    sig = (payload.get("date"), payload.get("layers", {}).get("bronze", {}).get("record_count"))
                    if sig != last_sig:
                        last_sig = sig
                        msg = f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                        self.wfile.write(msg.encode("utf-8"))
                    else:
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    time.sleep(3.0)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

    return ApiHandler


def create_server(logdir: Path | None = None, port: int = settings.api_port, host: str = settings.api_host) -> ThreadingHTTPServer:
    service = StreamService(primary_logdir=logdir)
    # Pre-warm latest Medallion Lakehouse snapshot so first mobile request is instant
    try:
        snap = service.get_lakehouse_elt("latest")
        print(
            f"[BigWarn ELT] Warmed {snap['date']}: "
            f"Bronze={snap['layers']['bronze']['record_count']} -> "
            f"Silver={snap['layers']['silver']['record_count']} -> "
            f"Gold={snap['layers']['gold']['alert_clusters']} clusters"
        )
    except Exception as exc:
        print(f"[BigWarn ELT] Warmup skipped: {exc}")
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

