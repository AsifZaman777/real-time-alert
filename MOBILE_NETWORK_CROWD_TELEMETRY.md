# Verified Crowd-Sourcing & Multi-Source Disruption Heatmap Guide

This document explains how **BigWarn** ensures **100% verified, authentic crowd-sourcing and disruption heatmaps** across Bangladesh—with **zero synthetic sine-wave or random mobile counts**.

---

## 1. Why Unverified / Synthetic Heatmaps Were Removed

Previously, a mathematical sine-wave function (`Math.sin(nowSec / 18.0 + phase)`) generated simulated mobile counts (`totalMobiles = 510`, `mobilesStuck = 312`) across 68+ random districts and grid sectors (`BD Sector ...`) even when no real devices or verified incidents were present, and `/api/v1/crowd/ping` was a no-op stub.

That synthetic generator has been **completely removed** from both the backend ([crowd_service.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/services/crowd_service.py)) and the mobile map ([OsmMapWebView.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/OsmMapWebView.tsx)).

---

## 2. How Verified Heatmaps & Telemetry Now Work

Every heatmap zone and HUD metric rendered on the map is strictly backed by **verified data**:

### A. Verified Live Hardware GPS Telemetry (`/api/v1/crowd/ping`)
1. **Real Hardware GPS Capture ([App.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/App.tsx#L357-L378))**:
   - The mobile app only transmits `/api/v1/crowd/ping` after `expo-location` (`Location.getCurrentPositionAsync`) returns an actual hardware GPS fix (`hasVerifiedGpsFixRef.current === true`).
   - It sends a unique per-device session ID (`deviceIdRef.current`), real GPS coordinates (`lat`, `lon`), real GPS velocity (`pos.coords.speed * 3.6` in `km/h`), and real GPS accuracy (`pos.coords.accuracy` in meters).
2. **Backend Verification & 15-Minute Sliding Window ([crowd_service.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/services/crowd_service.py#L121-L198))**:
   - `crowd_service.record_verified_ping()` validates that:
     - Coordinates fall strictly inside Bangladesh (`20.50°N – 26.70°N`, `88.00°E – 92.80°E`).
     - Velocity is physically valid (`0.0 – 160.0 km/h`) and GPS accuracy is valid (`<= 1000m`).
     - Coordinates snap within `18 km` to a canonical Bangladesh location in `AREA_METADATA`.
   - Verified pings are persisted in `backend/lakehouse/storage/gold/verified_crowd_pings.json` with a `900s` (15-minute) active TTL.
   - Devices with `speed_kmh < 5.0` are counted as **Mobiles Stuck**; devices with `speed_kmh >= 5.0` are counted as **Mobiles Moving**.

### B. Verified Multi-Source News & Traffic Disruption Corroboration (45-Portal Lakehouse Gold Layer)
- When an area in Bangladesh has a corroborated Gold disruption cluster from the 45 verified Bangladesh news portals (`Prothom Alo`, `The Daily Star`, `bdnews24`, `Dhaka Tribune`, `Somoy TV`, `Jamuna TV`, etc.):
  - The heatmap intensity and metrics are derived **deterministically** from the verified independent source count (`source_count`), verified article count (`article_count`), and the event's physical traffic congestion profile (`EVENT_CONGESTION_FACTORS`).
  - Multi-source verified clusters (`source_count >= 2` or backed by live GPS devices) are marked `is_verified: true` (`✓ Verified`) and scale to darker crimson/maroon (`#DC2626` → `#7F1D1D` → `#3B0707`) as additional independent portals and GPS devices corroborate the disruption.
  - Clicking any heatmap opens `#crowd-hud` showing the **Verification Shield** (`🛡️ Verified by <Portals / Live GPS>`), **Verified Mobiles**, **Mobiles Stuck (`%`)**, **Mobiles Moving (`%`)**, and **Avg Speed (`km/h`)**.
