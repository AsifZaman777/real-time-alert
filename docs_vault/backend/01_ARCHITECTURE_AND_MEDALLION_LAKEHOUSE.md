# Backend Architecture, Medallion Lakehouse ELT & Verified Telemetry Guide

This document covers the internal architecture of the **BigWarn Backend** (`real-time-alert/backend/`): the 45-portal bilingual news scraper, the 3-layer Medallion Lakehouse (`Bronze` $\rightarrow$ `Silver` $\rightarrow$ `Gold`), strict canonical Bangladesh spatial NLP, OSRM road-corridor routing, verified crowd telemetry, and REST/SSE APIs.

---

## 1. End-to-End Backend Data Flow

```mermaid
flowchart LR
    S["45 BD News Portals\n(15 EN + 30 BN)"] -->|"Live Scraper\n(run_streamer.py)"| B["🥉 Bronze Layer\nRaw Articles (JSONL)"]
    B -->|"Clause-Level Threat NLP\n+ Canonical AREA_METADATA"| Si["🥈 Silver Layer\nCleaned & Geocoded Threats"]
    Si -->|"Area + Event Clustering\n+ Newspaper Veracity Score"| G["🥇 Gold Layer\nCorroborated Area Alerts"]
    G <-->|"Async Cloud Sync\n(Azure ADLS / Cloudflare R2)"| C["☁️ Cloud Lakehouse\n& 48h R2 Archiver"]
    G -->|"3-Hour Recency Filter\n+ OSRM Road Projection"| R["🛣️ Route & Stream API\n(run_api.py :8765)"]
    P["📱 Connected Mobile GPS\n(/api/v1/crowd/ping)"] -->|"Verified BD Bounds\n+ 15m Sliding Window"| H["🔥 Verified Heatmap Engine\n(/api/v1/crowd/heatmap)"]
```

---

## 2. Medallion Lakehouse ELT ([medallion_manager.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/lakehouse/elt/medallion_manager.py))

All three Medallion layers are materialized under `backend/lakehouse/storage/` and cached in memory for `< 5 ms` API response times:

| Layer | Storage Path | Description |
| :--- | :--- | :--- |
| **🥉 Bronze** | `storage/bronze/articles/bronze_articles_<YYYY-MM-DD>.jsonl` | Immutable raw articles scraped from 45 Bangladesh portals with source, language (`bn`/`en`), headline, full body, and timestamps. |
| **🥈 Silver** | `storage/silver/disruptions/silver_disruptions_<YYYY-MM-DD>.jsonl` | Filtered strictly for active public safety disruptions, deduplicated by normalized headline, normalized to Dhaka time (`UTC+6`), and geocoded to canonical `(lat, lon, city)` coordinates. |
| **🥇 Gold** | `storage/gold/area_alerts/gold_alerts_<YYYY-MM-DD>.json` | Clustered by `(date, area, event_type)`, sorted newest-first, with `age_minutes`, `is_recent_3h` (`age_minutes <= 180`), newspaper veracity scores, and verified crowd metrics. |

### Newspaper-Based Veracity & Credibility Formula
Credibility is computed strictly from independent newspaper/portal corroboration:

$$\text{credibility\_score} = \min\left(0.99,\; 0.45 + 0.18 \times N_{\text{sources}} + (0.08 \text{ if bilingual})\right)$$

- **`VERIFIED (Multi-Source)` (`HIGH`)**: $\ge 3$ independent newspapers/portals
- **`CONFIRMED` (`MEDIUM`)**: $2$ independent newspapers/portals
- **`UNCONFIRMED (Single Source)` (`LOW`)**: $1$ newspaper/portal

---

## 3. Bilingual Threat & Strict Canonical Bangladesh Location NLP ([taxonomy.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/ingestion/enrichment/taxonomy.py))

1. **Strict Canonical Location Dictionary (`AREA_METADATA`, `TAG_VERSION = 3`)**:
   - Every valid location must exist in `AREA_METADATA`, which covers **all 64 districts of Bangladesh**, major national highway hubs (`Savar`, `Ashulia`, `Tongi`, `Gazipur`, `Narayanganj`), and **all Dhaka metropolitan neighborhoods** (`Mirpur-10`, `Mirpur-1`, `Mirpur-2`, `Mirpur-11`, `Mirpur-12`, `Pallabi`, `Kalshi`, `Kazipara`, `Shewrapara`, `Agargaon`, `Bijoy Sarani`, `Farmgate`, `Karwan Bazar`, `Banglamotor`, `Shahbagh`, `Paltan`, `Motijheel`, `Gulistan`, `Jatrabari`, `Sayedabad`, `Dhanmondi`, `Science Lab`, `New Market`, `Mohammadpur`, `Gabtoli`, `Tejgaon`, `Mohakhali`, `Banani`, `Gulshan`, `Badda`, `Rampura`, `Malibagh`, `Moghbazar`, `Kuril`, `Airport`, `Uttara`, `Abdullahpur`, `Sadarghat`, `Old Dhaka`, etc.).
   - Famous squares and landmarks are mapped directly to their canonical area (e.g., `শাপলা চত্বর` / `Shapla Chattar` $\rightarrow$ `Motijheel`; `দোয়েল চত্বর` $\rightarrow$ `Shahbagh`; `ইসিবি চত্বর` $\rightarrow$ `Kalshi`; `৩০০ ফিট` / `পূর্বাচল` $\rightarrow$ `Kuril`).
   - Open-vocabulary regex guessing (`_find_dynamic_locations`) is disabled so random Bangla words (`shapla`, `poro`, `carbon`, etc.) can never leak onto the map as fake places.
2. **Clause-Level `(Location -> Event)` Binding**:
   - Multi-incident roundup articles are split into clauses (`CLAUSE_SPLIT_RE`) so each location is bound only to the threat occurring in its own clause.
   - Police titles (`বনানী থানার ওসি`), bus-route modifiers (`যাত্রাবাড়ীগামী বাস`), and newspaper office address footers are stripped prior to spatial matching.

---

## 4. OSRM Real-Road Routing & 3-Hour Recency Filter ([route_service.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/services/route_service.py))

- Queries `https://router.project-osrm.org/route/v1/driving/` to retrieve the actual street geometry (`polyline`), alternative route (`alt_polyline`), distance (`km`), duration (`min`), and road names.
- **Strict 3-Hour Recency Filter (`is_recent_3h`)**:
  - Alerts older than 3 hours (`age_minutes > 180`) are skipped during route hazard evaluation.
- **Exact Perpendicular Point-to-Segment Projection**:
  - Each recent (`<= 3h`) alert within `1.35 km` of the route is projected perpendicularly onto the closest road polyline segment (`road_snap_lat`, `road_snap_lon`), producing `danger_segments` with `tooltip_lat` and `tooltip_lon` right on the road.

---

## 5. BLE Proximity Crowd-Sourcing Service ([crowd_service.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/services/crowd_service.py))

> Full feature guide: [03_BLE_PROXIMITY_CROWD_SOURCING_GUIDE.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/mobile/03_BLE_PROXIMITY_CROWD_SOURCING_GUIDE.md)

- **Real Data Only**: Accepts pings only from opened mobile apps reporting real hardware BLE scans (`BigWarnBleScannerModule.kt`) and a real GPS fix. The web console never sends pings.
- **Ingest (`record_verified_ping`)**:
  - Validates coordinates inside Bangladesh (`20.50°N–26.70°N`, `88.00°E–92.80°E`) and snaps them to the nearest `AREA_METADATA` area.
  - Rejects the legacy synthetic tag `network_type: "BLE_5.0 + 4G"` by forcing its BLE counts to `0`.
  - Persists sessions in `backend/lakehouse/storage/gold/verified_ble_crowd_pings.json` with a **30-second live TTL** (apps ping every 6 s).
- **Snapshot (`get_live_crowd_snapshot`)**:
  - Per opened app user: `ble_count = max(hardware BLE peers, other opened app phones within 50 m)`, `total_crowd_around_me = 1 + ble_count`, static vs. moving split (`< 3.5 km/h` = static), and crowd pattern.
  - Per area heatmap: `total_mobiles = opened apps in area + largest single hardware BLE scan` (no double counting of overlapping scans).

---

## 6. REST & SSE Stream API Endpoints ([server.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/api/server.py))

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/health` | `GET` | Service health check (`status: "ok"`). |
| `/api/v1/alerts/route` | `GET` | Computes OSRM road route, 3-hour route hazards (`danger_segments`), risk level, and optional `include_map=1` Gold alerts. |
| `/api/v1/alerts/map` | `GET` | Returns all active Gold alert clusters (`?city=ALL` or specific city). |
| `/api/v1/crowd/ping` | `GET` / `POST` | Records a BLE + GPS ping from an opened mobile app (`device_id`, `device_label`, `lat`, `lon`, `speed_kmh`, `accuracy_m`, `ble_count`, `ble_static_count`, `ble_moving_count`, `avg_rssi_dbm`, `scan_radius_m`, `network_type`). |
| `/api/v1/crowd/heatmap` | `GET` | Returns the live BLE crowd snapshot: `summary` KPIs, `scanners` (one row per opened app user, last 30 s), and `heatmaps` (per-area zones). |
| `/api/v1/lakehouse` | `GET` | Returns full Bronze, Silver, and Gold Medallion stats and tables. |
| `/api/v1/sources` | `GET` | Returns metadata for all 45 configured Bangladesh news portals. |
| `/api/v1/stream/feed` | `GET` | Unified open public feed (`?layer=gold|silver|bronze&format=json|ndjson|sse|rss`). |
| `/api/v1/archive/status` | `GET` | Returns 48-hour Cloudflare R2 archival status. |
