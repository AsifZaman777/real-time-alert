# 📚 BigWarn Documentation Vault (`docs_vault`)

Welcome to the central documentation vault for the **BigWarn Real-Time Bangladesh News, Medallion Lakehouse & Road Navigation Platform**. All architectural, operational, deployment, and build guides for the **Backend**, **Frontend**, and **Mobile** subsystems are organized inside this vault.

---

## 🗂️ Vault Directory Index

### 1. ⚙️ Backend (`docs_vault/backend/`)
- **[01_ARCHITECTURE_AND_MEDALLION_LAKEHOUSE.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/backend/01_ARCHITECTURE_AND_MEDALLION_LAKEHOUSE.md)**
  - End-to-end 45-portal bilingual scraper (`run_streamer.py`)
  - 3-Layer Medallion Lakehouse ELT (`Bronze` $\rightarrow$ `Silver` $\rightarrow$ `Gold`) & newspaper corroboration veracity scoring
  - Strict canonical `AREA_METADATA` Bangladesh location & landmark NLP (`TAG_VERSION = 3`)
  - OSRM real-road routing, 3-hour recency filter (`is_recent_3h`), and perpendicular road hazard snapping
  - Verified hardware GPS crowd telemetry (`/api/v1/crowd/ping` & `/api/v1/crowd/heatmap`)
  - Multi-Cloud Lakehouse sync (Azure ADLS Gen2 & Cloudflare R2 / S3) and public open feeds (`SSE`, `NDJSON`, `GeoRSS`, `JSON`)
- **[02_SERVER_DEPLOYMENT_SSH_AND_OPERATIONS.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/backend/02_SERVER_DEPLOYMENT_SSH_AND_OPERATIONS.md)**
  - One-command server deployment via `backend/deploy.sh`
  - Manual `rsync` code sync and SSH `pip3 install` for new Python dependencies on Ubuntu 24.04 LTS
  - Managing `systemd` services (`bigwarn-scraper`, `bigwarn-api`, `bigwarn-tunnel`) and inspecting `journalctl` logs
  - Retrieving the active Cloudflare HTTPS tunnel URL (`https://*.trycloudflare.com`)
  - 48-hour rolling hot window and automated Cloudflare R2 archival

---

### 2. 🌐 Frontend (`docs_vault/frontend/`)
- **[01_WEB_CONSOLE_RESPONSIVE_UI_AND_VERCEL.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/frontend/01_WEB_CONSOLE_RESPONSIVE_UI_AND_VERCEL.md)**
  - Next.js 14 App Router architecture & server-side proxy (`/api/bigwarn/[...slug]`)
  - Responsive mobile & desktop design (collapsible mobile filter drawer, mobile card layouts, and fixed bottom thumb-navigation bar)
  - Medallion Lakehouse Explorer (`Bronze`, `Silver`, `Gold`), 45-Portal Health Matrix, and Mobile Edge Simulator
  - Android APK distribution page (`/download`) and Vercel deployment configuration

---

### 3. 📱 Mobile (`docs_vault/mobile/`)
- **[01_MOBILE_NAVIGATION_UI_AND_HEATMAP_HUD.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/mobile/01_MOBILE_NAVIGATION_UI_AND_HEATMAP_HUD.md)**
  - Expo SDK 58 / React Native architecture
  - Google Maps-style clean white daylight OpenStreetMap canvas (`OsmMapWebView.tsx`)
  - Press-and-hold (`~420ms`) red teardrop destination pin, OSRM blue navigation polylines, and exact perpendicular blinking red hazard dots (`<= 3h`)
  - Verified multi-intensity heatmaps & clickable floating `#crowd-hud` (Total/Stuck/Moving counts, speed, and verification shield)
  - Responsive `MobileUI.tsx` component library (`useResponsiveLayout`, `SurfaceCard`, `PillChip`, `StatusBadge`, `SegmentedControl`, `DraggableBottomDrawer`) and gesture-only bottom drawers (no cross `✕` button)
- **[02_ANDROID_APK_LOCAL_AND_EAS_BUILD_GUIDE.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/mobile/02_ANDROID_APK_LOCAL_AND_EAS_BUILD_GUIDE.md)**
  - One-time macOS setup (JDK 17 + Android SDK 35 CLI)
  - Automated local release APK build via `mobile/build_apk.sh` (`arm64-v8a`) and auto-publishing to `frontend/public/downloads/bigwarn-edge.apk`
  - Baking `EXPO_PUBLIC_BIGWARN_FEED_URL` and `EXPO_PUBLIC_BIGWARN_FEED_TOKEN` from `mobile/.env`
  - Cloud APK build via Expo EAS
- **[03_BLE_PROXIMITY_CROWD_SOURCING_GUIDE.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/mobile/03_BLE_PROXIMITY_CROWD_SOURCING_GUIDE.md)**
  - Complete guide to the **Multi-Radio Crowd-Sourcing & Live Mobility Heatmap** feature across Mobile, Backend, and Frontend
  - Surrounding device model extraction (`BLE GAP/Manufacturer IDs`, `802.11 WPS IEs`, Multi-SSID router MACs, Wi-Fi Direct `primaryDeviceType`, `mDNS`/`SSDP`/TCP `62078`) and non-phone noise filtering (`Router`, `Earbud/Watch`, `TV/PC`)
  - Backend deduplication, `STATIC` vs. `SLOW_MOVING` vs. `MOVING` classification, threshold heatmaps (`<20 / 20 / 50 / 100 / 150+`), and crowd pattern detection
  - Mobile clickable `#crowd-hud` and Frontend **`📡 Crowd Sourcing (BLE)`** interactive heatmap map & dedicated `Detected Devices & Filtered Noise` table column
- **[04_MULTI_RADIO_CROWD_AND_TRAFFIC_DETECTION_PLAN.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/docs_vault/mobile/04_MULTI_RADIO_CROWD_AND_TRAFFIC_DETECTION_PLAN.md)**
  - Implementation plan for **Single-Phone Multi-Radio Surroundings & Traffic Detection (`BLE + Wi-Fi Mobile Peers + 4G LTE Cell-Tower RSRQ Load + GPS Velocity`)**
  - How 1 or 2 BigWarn phones at a strike can detect surrounding devices even when people around them have **Bluetooth turned OFF** and do not have the app installed
