# Whole-Bangladesh Real-Time Peak-Threshold Heatmap & Clickable HUD Guide

This document explains how **BigWarn** renders independent, real-time mobile density heatmaps across the **entire map of Bangladesh** based on **Peak Threshold crossing**, darkening in intensity as mobile congestion climbs above the threshold, with a single-click floating HUD showing stuck vs. moving mobiles.

---

## 1. Core Design Principles

1. **Whole-Bangladesh Independent Spatial Coverage**:
   - Heatmaps are **not** restricted to a few static Dhaka locations or only places with active newspaper articles.
   - The spatial telemetry network monitors **all 64 districts of Bangladesh**, major national highway junctions, all Dhaka metropolitan neighborhoods (`110+` canonical hubs), plus **dynamic viewport grid cells** anywhere the user pans or zooms across Bangladesh (`20.75°N – 26.60°N, 88.05°E – 92.65°E`).
2. **Peak-Threshold Gating (`totalMobiles >= peakThreshold`)**:
   - Every spatial zone has a **Peak Threshold** (`360` mobiles for Tier-1 metropolitan hubs; `180` mobiles for Tier-2 district towns and regional sectors).
   - **A heatmap is generated only when a location crosses its Peak Threshold** (or has an active `< 3h` disruption). Locations below their peak threshold remain clear so the map never gets cluttered by normal background traffic.
3. **Darker Intensity Scaling Above Peak Threshold**:
   - Once a location crosses its Peak Threshold, **the further above the threshold it climbs, the darker the heatmap becomes**:
     - **Peak Threshold Crossed (`0.45 – 0.64`)**: Warm Amber / Deep Orange (`#F59E0B` $\to$ `#D97706`)
     - **High Peak Surge (`0.65 – 0.84`)**: Bright Crimson / Dark Red (`#DC2626` $\to$ `#991B1B`)
     - **Extreme Peak — Dark Zone (`0.85 – 1.00`)**: **Deep Maroon / Dark Blood-Crimson (`#7F1D1D` $\to$ `#3B0707` / `#2A0404`)** with a high-opacity dark inner core.
4. **Autonomous Real-Time Streaming (No Manual Sync Required)**:
   - Inside [OsmMapWebView.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/OsmMapWebView.tsx), an autonomous `setInterval(renderRealtimeBangladeshHeatmaps, 2500)` loop runs on a dedicated `heatmapLayerGroup` every **2.5 seconds** (and on map pan/zoom).
   - Heatmaps smoothly appear when crossing the peak threshold, darken when stuck devices surge, and update the open HUD card live in real time without requiring the user to tap **Sync**.
5. **Simple Clickable Heatmap HUD (Zero Statistical Jargon)**:
   - Clicking any heatmap on the map opens the floating `#crowd-hud` card displaying:
     - **Location Name** & **Peak Intensity Status Pill** (`Peak Threshold Crossed`, `High Peak Surge`, `Extreme Peak (Dark Zone)`)
     - **Total Mobiles** (alongside the area's `Peak Threshold`)
     - **Mobiles Stuck (`%`)**
     - **Mobiles Moving (`%`)**
     - **Stuck vs. Moving Progress Bar**
     - **Average Speed (`km/h`)** and a live real-time stream indicator (or a `View News` shortcut if the area also has news alerts).
   - No extra crowd panels, no buttons, no veracity weighting, and no statistical jargon ($\sigma$ / H3 hex strings) are shown to the user.

---

## 2. Architecture & Code Locations

| Component | File | Responsibility |
| :--- | :--- | :--- |
| **Interactive Map & Autonomous 2.5s Real-Time Heatmap Engine** | [OsmMapWebView.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/OsmMapWebView.tsx) | Evaluates all 64 Bangladesh districts, highway corridors, Dhaka metro hubs, and dynamic viewport sectors every 2.5s; renders peak-gated dark-scaling heatmaps on `heatmapLayerGroup` and live-updates `#crowd-hud`. |
| **Backend All-Bangladesh Telemetry Service** | [crowd_service.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/services/crowd_service.py) | Pure-Python stdlib real-time telemetry generator (`compute_area_realtime_telemetry`, `get_all_bangladesh_heatmaps`) across all locations in `AREA_METADATA`. |
| **REST Endpoint (`/api/v1/crowd/heatmap`)** | [server.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/api/server.py) | Exposes whole-Bangladesh real-time peak-threshold heatmap snapshots over HTTP/JSON. |
