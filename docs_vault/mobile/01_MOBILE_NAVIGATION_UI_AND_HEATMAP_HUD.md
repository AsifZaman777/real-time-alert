# Mobile Navigation App, Responsive UI Library & Verified Heatmap HUD Guide

This document details the architecture of the **BigWarn Mobile Edge App** (`real-time-alert/mobile/`, Expo SDK 58 / React Native), including the Google Maps-style white OpenStreetMap canvas, OSRM road hazard snapping, verified heatmaps & clickable HUD, and the gesture-driven bottom drawer UI.

---

## 1. Mobile Architecture & Core Files

| File | Responsibility |
| :--- | :--- |
| [App.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/App.tsx) | Main navigation screen, floating top route/city filter card, hardware GPS telemetry (`expo-location`), route risk banner, and gesture-driven bottom drawer (with no cross `✕` button). |
| [src/components/OsmMapWebView.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/OsmMapWebView.tsx) | Interactive Leaflet + OpenStreetMap WebView in clean daylight white mode, Google Maps blue route polylines, perpendicular blinking red hazard dots (`<= 3h`), verified heatmaps, and clickable `#crowd-hud`. |
| [src/components/ui/MobileUI.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/ui/MobileUI.tsx) | Responsive mobile design system providing `useResponsiveLayout`, `SurfaceCard`, `PillChip`, `StatusBadge`, `SegmentedControl`, and `DraggableBottomDrawer`. |
| [src/components/AreaDetailModal.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/AreaDetailModal.tsx) | Gesture-driven draggable bottom drawer (drag down or tap backdrop to close; no cross `✕` button) displaying newest-first news articles and veracity meters for a selected area. |
| [src/components/VeracityMeter.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/VeracityMeter.tsx) | Newspaper/portal corroboration gauge displaying `veracity_percent%`, tier badge, and source portal chips. |
| [src/config/api.ts](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/config/api.ts) | Resolves `EXPO_PUBLIC_BIGWARN_FEED_URL` / LAN host and provides quick Dhaka destination presets. |

---

## 2. Google Maps-Style White Map & Exact Road Hazard Snapping

1. **Free OpenStreetMap Daylight White Tiles**:
   - Uses `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (no API key required) with CSS `filter: brightness(1.04) contrast(0.95) saturate(0.85)` for a crisp Google Maps-like white theme.
2. **Press-and-Hold (`~420ms`) or Drag Destination Pin**:
   - Long-pressing anywhere on the map (or dragging the red teardrop pin) sets the destination and fetches the OSRM street route (`#4285F4` over `#185ABC` casing).
3. **Strict 3-Hour Recency Filter (`<= 180 Minutes`) & Perpendicular Red Hazard Dots**:
   - Only active threats from the last **3 hours (`isRecent3h`)** are projected onto the navigated road polyline via `projectPointToPolyline()`.
   - Each intercepted road stretch is highlighted in pulsing red (`#EF4444`) with a **blinking Red Hazard Dot (`🔴`)** snapped to the exact perpendicular closest point on the road.
   - Tapping a red dot opens a compact white card popup showing the affected road name, headline, veracity summary, and a `Details ›` link.

---

## 3. Automatic BLE Proximity Crowd-Sourcing & Clickable Heatmap HUD

1. **Automatic BLE Proximity Scanning When App Is Open ([src/services/bleCrowdScanner.ts](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/services/bleCrowdScanner.ts))**:
   - When a user opens the BigWarn app, their phone automatically scans nearby Bluetooth Low Energy (BLE) advertising packets within a `~40m` radius and reads the phone's hardware GPS velocity (`speed_kmh`).
   - It transmits the accumulated BLE peer count (`ble_count`), static vs. moving BLE split (`ble_static_count`, `ble_moving_count`), average RSSI (`avg_rssi_dbm`), and GPS velocity to `/api/v1/crowd/ping`.
2. **Server Aggregation & Static vs. Moving Classification ([backend/app/services/crowd_service.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/services/crowd_service.py))**:
   - The server aggregates all active open-app BLE scanners, classifies whether the crowd around each user is **STATIC (`< 3.5 km/h` or `>= 68%` static BLE peers)**, **SLOW_MOVING**, or **MOVING**, and identifies the **Crowd Pattern** (e.g., `"Dense Static Gathering / Standstill Blockade"`, `"High-Density Static Crowd / Bottleneck"`, `"Normal Free-Flowing Movement"`).
3. **Clickable BLE Heatmap HUD ([src/components/OsmMapWebView.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/OsmMapWebView.tsx))**:
   - Renders multi-intensity heatmaps on the map (Dark Crimson / Maroon `#7F1D1D` $\rightarrow$ `#3B0707` for **STATIC** crowds; Amber `#F59E0B` for **MOVING** crowds).
   - Clicking any heatmap opens `#crowd-hud` displaying the Location, Mobility State badge (`🔴 STATIC CROWD` / `🟢 MOVING FLOW`), Crowd Pattern, Open App Scanner count, Total BLE Crowd, Static vs. Moving counts (`%`), and Avg GPS Speed (`km/h`).

---

## 4. Responsive Layout & Gesture-Only Bottom Drawers (No Cross `✕` Button)

- **Responsive Tokens (`useResponsiveLayout`)**: Dynamically adapts paddings, typography, and card widths across compact phones (`< 360dp`), standard phones, large phones, and tablets.
- **No Cross (`✕`) Button on Bottom Drawers**:
  - Both the main Route Alerts bottom drawer in [App.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/App.tsx) and the Area Detail drawer in [AreaDetailModal.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/AreaDetailModal.tsx) are controlled purely via swipe/drag gestures (`PanResponder` drag up to open `half`/`full`, drag down to dismiss `off`, or tap the drag handle/backdrop).
