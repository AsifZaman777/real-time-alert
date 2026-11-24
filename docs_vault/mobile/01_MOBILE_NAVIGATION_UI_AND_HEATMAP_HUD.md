# Mobile Navigation App, Responsive UI Library & Verified Heatmap HUD Guide

This document details the architecture of the **BigWarn Mobile Edge App** (`real-time-alert/mobile/`, Expo SDK 58 / React Native), including the Google Maps-style white OpenStreetMap canvas, OSRM road hazard snapping, verified heatmaps & clickable HUD, and the gesture-driven bottom drawer UI.

---

## 1. Mobile Architecture & Core Files

| File | Responsibility |
| :--- | :--- |
| [App.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/App.tsx) | Uncongested top navigation bar (`☰` Help Menu, `EN`/`বাং` switcher, `Places` toggle tray, Search, explicit `Pin` button, single-line route advisory) and gesture-driven bottom alerts drawer. |
| [src/i18n/index.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/i18n/index.tsx) | Lightweight React Context i18n provider switching live across **English** ([en.ts](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/i18n/locales/en.ts)) and **বাংলা** ([bn.ts](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/i18n/locales/bn.ts)). |
| [src/components/HelpMenuModal.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/HelpMenuModal.tsx) | Three-bar (`☰`) Help & Features guide explaining each feature, multi-radio crowd sensing, progressive `20/50/100/150` heatmap color scale, and sensor permissions. |
| [src/components/OsmMapWebView.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/OsmMapWebView.tsx) | Interactive Leaflet + OpenStreetMap WebView in daylight white mode, Google Maps blue route polylines, blinking red hazard dots (`<= 3h`), explicit Pin-button-only map pinning, `20/50/100/150` progressive crowd heatmaps, and localized clickable `#crowd-hud`. |
| [src/components/ui/MobileUI.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/ui/MobileUI.tsx) | Responsive mobile design system providing `useResponsiveLayout`, `SurfaceCard`, `PillChip`, `StatusBadge`, `SegmentedControl`, and `DraggableBottomDrawer`. |
| [src/components/AreaDetailModal.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/AreaDetailModal.tsx) | Gesture-driven draggable bottom drawer (drag down or tap backdrop to close) displaying newest-first news articles and credibility meters for a selected area. |
| [src/components/VeracityMeter.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/VeracityMeter.tsx) | Newspaper/portal corroboration gauge displaying `veracity_percent%`, tier badge, and source portal chips. |
| [src/config/api.ts](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/config/api.ts) | Resolves `EXPO_PUBLIC_BIGWARN_FEED_URL` / LAN host and provides quick Dhaka destination presets. |

---

## 2. Google Maps-Style White Map & Explicit Pin Mode

1. **Free OpenStreetMap Daylight White Tiles**:
   - Uses `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (no API key required) with CSS `filter: brightness(1.04) contrast(0.95) saturate(0.85)` for a crisp Google Maps-like white theme.
2. **Explicit Pin-Button-Only Dropping**:
   - Scrolling, panning, zooming, or resting a finger on the map **never** drops a pin accidentally.
   - Tapping the **`📍 Pin`** button enters `pinMode` and displays a banner (`Tap anywhere on the map to set your destination`). Clicking the map sets the destination and immediately exits `pinMode`.
3. **Strict 3-Hour Recency Filter (`<= 180 Minutes`) & Perpendicular Red Hazard Dots**:
   - Only active threats from the last **3 hours (`isRecent3h`)** are projected onto the navigated road polyline via `projectPointToPolyline()`.
   - Each intercepted road stretch is highlighted in pulsing red (`#EF4444`) with a **blinking Red Hazard Dot (`🔴`)** snapped to the exact perpendicular closest point on the road.
   - Tapping a red dot opens a compact white card popup showing the affected road name, headline, veracity summary, and a `Details` link.

---

## 3. Silent Background Sensing & Progressive Heatmap Colors (`20, 50, 100, 150`)

1. **Silent Multi-Radio Crowd Sensing**:
   - No sensor/peers status strip clutters the main map screen—hardware BLE, Wi-Fi (Hotspots, Direct P2P, Shared LAN), and 4G load scans run silently in the background every 6 seconds. Users inspect detailed crowd telemetry only when tapping a heatmap (`#crowd-hud`).
2. **Threshold-Based Progressive Heatmap Density Colors**:
   - **`< 20` devices**: Soft Warm Yellow (`#FDE68A` / `#F59E0B`) — light presence
   - **`20–49` devices**: Warm Amber (`#F59E0B` / `#D97706`) — moderate gathering
   - **`50–99` devices**: Deep Orange (`#EA580C` / `#C2410C`) — dense crowd / slow traffic
   - **`100–149` devices**: Crimson Red (`#DC2626` / `#991B1B`) — heavy blockade / surge
   - **`150+` devices**: Deep Dark Maroon (`#7F1D1D` / `#450A0A`) — extreme standstill crowd
3. **Clickable Localized `#crowd-hud`**:
   - Tapping any heatmap circle opens `#crowd-hud` (localized in English or বাংলা) displaying the Area, Mobility State badge, Crowd Pattern, Open App count, Multi-Radio breakdown (`+BLE`, `+Wi-Fi P2P/LAN`, `4G Load %`), Surrounding Crowd total, Static vs. Moving split, and Traffic Speed (`km/h`).

---

## 4. Responsive Layout & Gesture-Only Bottom Drawers (No Cross `✕` Button)

- **Responsive Tokens (`useResponsiveLayout`)**: Dynamically adapts paddings, typography, and card widths across compact phones (`< 360dp`), standard phones, large phones, and tablets.
- **No Cross (`✕`) Button on Bottom Drawers**:
  - Both the main Route Alerts bottom drawer in [App.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/App.tsx) and the Area Detail drawer in [AreaDetailModal.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/src/components/AreaDetailModal.tsx) are controlled purely via swipe/drag gestures (`PanResponder` drag up to open `half`/`full`, drag down to dismiss `off`, or tap the drag handle/backdrop).
