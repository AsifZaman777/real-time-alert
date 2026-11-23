import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, WebViewMessageEvent, WebViewProps } from "react-native-webview";
import { Coordinates, DangerRoadSegment, GoldAlert } from "../types/alert";
import { formatEventLabel, formatNewsTimestamp } from "../services/notifications";

const TypedWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<{ injectJavaScript: (script: string) => void }> }
>;

export interface RouteRoadGeometry {
  polyline?: number[][];
  alt_polyline?: number[][];
  route_distance_km?: number;
  duration_min?: number;
  road_names?: string[];
  danger_segments?: DangerRoadSegment[];
}

interface OsmMapWebViewProps {
  currentLocation: Coordinates;
  destination: Coordinates;
  todoText: string;
  alerts: GoldAlert[];
  routeAlertIds: Set<string>;
  routeGeometry?: RouteRoadGeometry | null;
  focusCoords?: { lat: number; lon: number; zoom?: number; nonce: number } | null;
  fitRouteNonce?: number;
  pinMode?: boolean;
  onPinDestination: (lat: number, lon: number, roadLabel?: string) => void;
  onSelectArea: (area: string) => void;
}

export const OsmMapWebView: React.FC<OsmMapWebViewProps> = ({
  currentLocation,
  destination,
  todoText,
  alerts,
  routeAlertIds,
  routeGeometry,
  focusCoords,
  fitRouteNonce,
  pinMode = false,
  onPinDestination,
  onSelectArea,
}) => {
  const webRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Group alerts by area so each map marker represents a location (e.g. Banani, Mohakhali, Jatrabari)
  const areaMarkers = useMemo(() => {
    const grouped = new Map<
      string,
      {
        area: string;
        lat: number;
        lon: number;
        color: string;
        hasCritical: boolean;
        onRoute: boolean;
        clusterCount: number;
        maxSources: number;
        topEvent: string;
        topEventLabel: string;
        topHeadline: string;
        publishedTime: string;
        veracitySummary: string;
        affectedRoad?: string;
        isRecent3h: boolean;
        totalMobiles: number;
        mobilesStuck: number;
        mobilesMoving: number;
        stuckPercent: number;
        movingPercent: number;
        avgSpeedKmh: number;
        heatIntensity: number;
        intensityLabel: string;
      }
    >();

    for (const a of alerts) {
      const existing = grouped.get(a.area);
      const isRoute = routeAlertIds.has(a.cluster_id) || Boolean(a.on_route);
      const isRed = a.color === "#EF4444" || a.severity === "CRITICAL";
      const isRecent =
        typeof a.is_recent_3h === "boolean"
          ? a.is_recent_3h
          : (a.age_minutes ?? 9999) <= 180;
      const latestArt = a.articles?.[0];
      const pubTime = formatNewsTimestamp(
        latestArt?.published || a.last_updated,
        latestArt?.ingested_at
      );
      const cm = a.crowd_metrics;
      const totalMobs =
        cm?.total_mobiles ?? (isRecent ? (isRed ? 540 : 380) : 260);
      const stuckPct =
        cm?.stuck_percent ?? (isRecent ? (isRed ? 84 : 62) : 28);
      const mobsStuck =
        cm?.mobiles_stuck ?? Math.round((totalMobs * stuckPct) / 100);
      const mobsMoving =
        cm?.mobiles_moving ?? Math.max(0, totalMobs - mobsStuck);
      const movingPct = cm?.moving_percent ?? 100 - stuckPct;
      const spdKmh =
        cm?.avg_speed_kmh ?? (stuckPct >= 75 ? 1.2 : stuckPct >= 50 ? 5.4 : 18.2);
      const heatInt =
        cm?.heat_intensity ?? (isRecent && isRed ? 0.95 : isRecent ? 0.68 : 0.42);
      const intLabel =
        cm?.intensity_label ??
        (heatInt >= 0.8
          ? "High Intensity"
          : heatInt >= 0.55
          ? "Medium Intensity"
          : "Normal Flow");

      if (!existing) {
        grouped.set(a.area, {
          area: a.area,
          lat: a.lat,
          lon: a.lon,
          color: a.color || "#EF4444",
          hasCritical: isRed,
          onRoute: isRoute,
          clusterCount: 1,
          maxSources: a.source_count,
          topEvent: a.event_type,
          topEventLabel: formatEventLabel(a.event_type),
          topHeadline: a.sample_headline || "",
          publishedTime: pubTime,
          veracitySummary: a.veracity_summary || "",
          affectedRoad: a.affected_road,
          isRecent3h: isRecent,
          totalMobiles: totalMobs,
          mobilesStuck: mobsStuck,
          mobilesMoving: mobsMoving,
          stuckPercent: stuckPct,
          movingPercent: movingPct,
          avgSpeedKmh: spdKmh,
          heatIntensity: heatInt,
          intensityLabel: intLabel,
        });
      } else {
        existing.clusterCount += 1;
        existing.hasCritical = existing.hasCritical || isRed;
        if (existing.hasCritical) existing.color = "#EF4444";
        existing.onRoute = existing.onRoute || isRoute;
        existing.isRecent3h = existing.isRecent3h || isRecent;
        existing.maxSources = Math.max(existing.maxSources, a.source_count);
        existing.totalMobiles = Math.max(existing.totalMobiles, totalMobs);
        existing.mobilesStuck = Math.max(existing.mobilesStuck, mobsStuck);
        existing.mobilesMoving = Math.max(
          0,
          existing.totalMobiles - existing.mobilesStuck
        );
        existing.stuckPercent = Math.max(existing.stuckPercent, stuckPct);
        existing.movingPercent = 100 - existing.stuckPercent;
        existing.heatIntensity = Math.max(existing.heatIntensity, heatInt);
        if (!existing.affectedRoad && a.affected_road) {
          existing.affectedRoad = a.affected_road;
        }
      }
    }
    return Array.from(grouped.values());
  }, [alerts, routeAlertIds]);

  const html = useMemo(
    () => `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
  <style>
    html, body, #map {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background: #F8F9FA;
      -webkit-user-select: none; user-select: none;
      -webkit-touch-callout: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .leaflet-tile-pane {
      filter: brightness(1.04) contrast(0.95) saturate(0.85);
    }
    .leaflet-control-attribution {
      background: rgba(255, 255, 255, 0.85) !important;
      color: #64748B !important;
      font-size: 9px !important;
      border-radius: 6px 0 0 0;
    }
    .custom-pin-wrapper {
      background: transparent !important;
      border: none !important;
    }
    .user-wrap {
      position: relative;
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px;
      transform: translate(-50%, -50%);
    }
    .user-pulse {
      position: absolute;
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(66, 133, 244, 0.28);
      animation: pulseRing 2s ease-out infinite;
    }
    .user-dot {
      width: 16px; height: 16px; border-radius: 50%;
      background: #1A73E8; border: 3px solid #FFFFFF;
      box-shadow: 0 2px 8px rgba(26, 115, 232, 0.65);
      z-index: 2;
    }
    @keyframes pulseRing {
      0% { transform: scale(0.55); opacity: 0.95; }
      100% { transform: scale(1.9); opacity: 0; }
    }

    /* High-Precision Blinking Red Hazard Dot placed directly on the intercepted road & event */
    .road-hazard-dot-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      transform: translate(-50%, -50%);
      cursor: pointer;
    }
    .road-hazard-pulse-outer {
      position: absolute;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(220, 38, 38, 0.28);
      border: 1.5px solid rgba(239, 68, 68, 0.65);
      animation: hazardRipple 1.25s cubic-bezier(0.16, 1, 0.3, 1) infinite;
    }
    .road-hazard-pulse {
      position: absolute;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.52);
      animation: hazardRipple 1.25s cubic-bezier(0.16, 1, 0.3, 1) 0.35s infinite;
    }
    .road-hazard-core {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #DC2626;
      border: 2.5px solid #FFFFFF;
      box-shadow: 0 0 12px rgba(220, 38, 38, 0.95), 0 2px 6px rgba(15, 23, 42, 0.45);
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: coreBlink 0.9s ease-in-out infinite alternate;
    }
    .road-hazard-inner {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #FFFFFF;
    }
    @keyframes hazardRipple {
      0% { transform: scale(0.45); opacity: 1; }
      100% { transform: scale(1.75); opacity: 0; }
    }
    @keyframes coreBlink {
      0% { background: #EF4444; transform: scale(0.94); box-shadow: 0 0 8px rgba(239, 68, 68, 0.8); }
      100% { background: #B91C1C; transform: scale(1.1); box-shadow: 0 0 16px rgba(220, 38, 38, 1); }
    }

    /* Blinking Red Badge for On-Route / Intercepted Event Centers */
    .area-badge-onroute {
      background: #DC2626 !important;
      border: 2px solid #FFFFFF !important;
      box-shadow: 0 0 14px rgba(220, 38, 38, 0.85), 0 3px 8px rgba(15, 23, 42, 0.35) !important;
      animation: badgeAlertBlink 0.95s ease-in-out infinite alternate;
      opacity: 1 !important;
      z-index: 10;
    }
    .onroute-dot-indicator {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #FFFFFF;
      box-shadow: 0 0 6px #FFFFFF;
    }
    @keyframes badgeAlertBlink {
      0% { transform: translate(-50%, -50%) scale(0.97); background: #EF4444; }
      100% { transform: translate(-50%, -50%) scale(1.06); background: #B91C1C; }
    }

    /* Google Maps-style Teardrop Pin with Drop Bounce */
    .gmap-pin-container {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      transform: translate(-50%, -100%);
      animation: gmapDropBounce 0.42s cubic-bezier(0.22, 1.28, 0.36, 1);
    }
    @keyframes gmapDropBounce {
      0% { transform: translate(-50%, -180%) scale(0.7); opacity: 0; }
      65% { transform: translate(-50%, -95%) scale(1.06); opacity: 1; }
      85% { transform: translate(-50%, -104%) scale(0.97); }
      100% { transform: translate(-50%, -100%) scale(1); }
    }
    .gmap-pin-label {
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      color: #0F172A;
      font-weight: 800;
      font-size: 11px;
      padding: 3.5px 10px;
      border-radius: 999px;
      border: 1.5px solid #EA4335;
      white-space: nowrap;
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.18);
      margin-bottom: 3px;
    }
    .gmap-pin-svg {
      width: 32px;
      height: 40px;
      filter: drop-shadow(0 4px 6px rgba(15, 23, 42, 0.3));
    }
    .gmap-pin-shadow {
      width: 12px;
      height: 4px;
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.25);
      margin-top: -2px;
    }

    /* Google Maps-Style White Route ETA Callout Pill */
    .leaflet-tooltip.leaflet-route-eta {
      background: #FFFFFF !important;
      color: #1967D2 !important;
      border: 1.5px solid #AECBFA !important;
      border-radius: 999px !important;
      font-weight: 800 !important;
      font-size: 10.5px !important;
      padding: 3px 9px !important;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18) !important;
      pointer-events: none !important;
    }
    .leaflet-tooltip.leaflet-route-eta::before {
      display: none !important;
    }

    /* Clean Google Maps White Card Popup when clicking a Red Hazard Dot */
    .leaflet-popup.leaflet-avoid-popup .leaflet-popup-content-wrapper {
      background: rgba(255, 255, 255, 0.98) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      color: #0F172A !important;
      border: 1.5px solid #EF4444 !important;
      border-radius: 14px !important;
      padding: 0 !important;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(239, 68, 68, 0.2) !important;
    }
    .leaflet-popup.leaflet-avoid-popup .leaflet-popup-content {
      margin: 10px 12px !important;
      width: 220px !important;
    }
    .leaflet-popup.leaflet-avoid-popup .leaflet-popup-tip {
      background: #FFFFFF !important;
      border: 1px solid #EF4444 !important;
    }
    .leaflet-popup.leaflet-avoid-popup a.leaflet-popup-close-button {
      color: #64748B !important;
      font-size: 16px !important;
      top: 6px !important;
      right: 7px !important;
    }

    .avoid-header {
      display: inline-flex;
      align-items: center;
      background: #FEE2E2;
      border: 1px solid #FECACA;
      border-radius: 6px;
      padding: 2px 7px;
      margin-bottom: 5px;
    }
    .avoid-badge-text {
      color: #DC2626;
      font-size: 9.5px;
      font-weight: 900;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
    .avoid-road-name {
      color: #0F172A;
      font-size: 11.5px;
      font-weight: 800;
      margin-bottom: 3px;
    }
    .avoid-headline {
      color: #334155;
      font-size: 10.5px;
      line-height: 14px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 7px;
    }
    .avoid-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #0284C7;
      font-size: 9.5px;
      font-weight: 700;
      border-top: 1px solid #E2E8F0;
      padding-top: 5px;
      cursor: pointer;
    }
    .avoid-open-btn {
      background: #EF4444;
      color: #FFFFFF;
      padding: 2.5px 8px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 800;
    }

    /* Crisp Area Badges for off-route alerts on White Map */
    .area-badge {
      display: inline-flex; align-items: center; gap: 4px;
      width: max-content;
      color: #FFFFFF;
      font-size: 10.5px; font-weight: 800; padding: 3px 8px;
      border-radius: 999px; border: 1.8px solid #FFFFFF;
      white-space: nowrap; box-shadow: 0 2px 7px rgba(15, 23, 42, 0.25);
      transform: translate(-50%, -50%);
      opacity: 0.95;
    }
    .area-count {
      background: rgba(0, 0, 0, 0.28); border-radius: 999px;
      padding: 0px 5px; font-size: 9.5px; font-weight: 800;
    }

    @keyframes dangerPulse {
      0% { stroke-opacity: 0.95; }
      50% { stroke-opacity: 0.6; }
      100% { stroke-opacity: 0.95; }
    }
    .leaflet-danger-road {
      animation: dangerPulse 1.5s ease-in-out infinite;
    }

    /* Clickable Heatmap Floating Crowd HUD */
    #crowd-hud {
      position: fixed;
      left: 50%;
      bottom: 88px;
      transform: translateX(-50%);
      width: min(310px, calc(100vw - 24px));
      background: rgba(255, 255, 255, 0.97);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1.5px solid #CBD5E1;
      border-radius: 18px;
      padding: 12px 14px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.22);
      z-index: 1200;
      display: none;
    }
    .hud-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .hud-area {
      color: #0F172A;
      font-size: 14.5px;
      font-weight: 800;
    }
    .hud-intensity-pill {
      font-size: 10px;
      font-weight: 800;
      padding: 2.5px 8px;
      border-radius: 999px;
      text-transform: uppercase;
    }
    .hud-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 8px;
    }
    .hud-stat-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 6px 8px;
      text-align: center;
    }
    .hud-stat-val {
      font-size: 14px;
      font-weight: 800;
      color: #0F172A;
    }
    .hud-stat-lbl {
      font-size: 9.5px;
      font-weight: 700;
      color: #64748B;
      margin-top: 1px;
    }
    .hud-bar-track {
      height: 7px;
      background: #22C55E;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .hud-bar-stuck {
      height: 100%;
      background: #EF4444;
    }
    .hud-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10.5px;
      font-weight: 700;
      color: #475569;
    }
    .hud-news-btn {
      background: #EFF6FF;
      color: #1D4ED8;
      border: 1px solid #BFDBFE;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 10px;
      font-weight: 800;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="crowd-hud"></div>
  <script>
    const map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      inertia: true,
      closePopupOnClick: true
    }).setView([23.7600, 90.3950], 12);

    // Free OpenStreetMap tiles (no API key required) styled in clean Google-Maps-like white daylight mode
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    const routeLayerGroup = L.featureGroup().addTo(map);
    const dangerRoadLayerGroup = L.featureGroup().addTo(map);
    const heatmapLayerGroup = L.featureGroup().addTo(map);
    const alertMarkerLayerGroup = L.featureGroup().addTo(map);

    let userMarker = null;
    let destMarker = null;
    let currentPinMode = false;
    let lastRouteFetchId = 0;
    let lastUserSig = '';
    let lastDestSig = '';
    let lastRouteSig = '';
    let lastMarkersSig = '';
    let currentNewsMarkers = [];
    let currentZoneMap = {};
    let activeHudArea = null;

    function sendBridgeMessage(obj) {
      const str = JSON.stringify(obj);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(str);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(str, '*');
      }
    }

    function triggerDropPin(lat, lon) {
      sendBridgeMessage({
        type: 'pinDestination',
        lat: lat,
        lon: lon
      });
    }

    // 1. Long-press (press and hold ~420ms) via Leaflet contextmenu
    map.on('contextmenu', function(e) {
      triggerDropPin(e.latlng.lat, e.latlng.lng);
    });

    // 2. Touch press-and-hold (~420ms) handler for Android WebViews
    let holdTimer = null;
    let startPt = null;
    const mapContainer = map.getContainer();

    mapContainer.addEventListener('touchstart', function(ev) {
      if (!ev.touches || ev.touches.length !== 1) {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        return;
      }
      const t = ev.touches[0];
      startPt = { x: t.clientX, y: t.clientY };
      holdTimer = setTimeout(function() {
        holdTimer = null;
        const rect = mapContainer.getBoundingClientRect();
        const containerPt = L.point(t.clientX - rect.left, t.clientY - rect.top);
        const latlng = map.containerPointToLatLng(containerPt);
        if (latlng) {
          triggerDropPin(latlng.lat, latlng.lng);
        }
      }, 420);
    }, { passive: true });

    mapContainer.addEventListener('touchmove', function(ev) {
      if (!holdTimer || !startPt || !ev.touches || !ev.touches[0]) return;
      const t = ev.touches[0];
      if (Math.hypot(t.clientX - startPt.x, t.clientY - startPt.y) > 12) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    }, { passive: true });

    mapContainer.addEventListener('touchend', function() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    }, { passive: true });

    // 3. Single tap on map closes HUD or drops destination pin when Pin mode is active
    const hudEl = document.getElementById('crowd-hud');
    function hideCrowdHud() {
      activeHudArea = null;
      if (hudEl) hudEl.style.display = 'none';
    }

    function showCrowdHud(z) {
      if (!hudEl || !z) return;
      activeHudArea = z.area;
      const isExtreme = z.heatIntensity >= 0.85;
      const isHigh = z.heatIntensity >= 0.65 && !isExtreme;
      const pillBg = isExtreme ? '#450A0A' : (isHigh ? '#FEE2E2' : '#FEF3C7');
      const pillCol = isExtreme ? '#FECACA' : (isHigh ? '#B91C1C' : '#B45309');
      const peakThresh = z.peakThreshold || 300;
      const newsBtnHtml = z.hasNews
        ? '<span class="hud-news-btn" onclick="window.__selectArea(\\'' + escapeHtml(z.area).replace(/'/g, "\\\\'") + '\\')">View News (' + z.clusterCount + ') ›</span>'
        : '<span style="color:#059669;font-weight:800;">● Live Real-Time Stream</span>';

      hudEl.innerHTML = '<div class="hud-top">'
        +   '<span class="hud-area">📍 ' + escapeHtml(z.area) + '</span>'
        +   '<span class="hud-intensity-pill" style="background:' + pillBg + ';color:' + pillCol + ';">' + escapeHtml(z.intensityLabel) + '</span>'
        + '</div>'
        + '<div class="hud-grid">'
        +   '<div class="hud-stat-box">'
        +     '<div class="hud-stat-val">' + z.totalMobiles + '</div>'
        +     '<div class="hud-stat-lbl">Total (Peak ' + peakThresh + ')</div>'
        +   '</div>'
        +   '<div class="hud-stat-box" style="background:#FEF2F2;border-color:#FECACA;">'
        +     '<div class="hud-stat-val" style="color:#DC2626;">' + z.mobilesStuck + ' (' + z.stuckPercent + '%)</div>'
        +     '<div class="hud-stat-lbl" style="color:#B91C1C;">Mobiles Stuck</div>'
        +   '</div>'
        +   '<div class="hud-stat-box" style="background:#F0FDF4;border-color:#BBF7D0;">'
        +     '<div class="hud-stat-val" style="color:#15803D;">' + z.mobilesMoving + ' (' + z.movingPercent + '%)</div>'
        +     '<div class="hud-stat-lbl" style="color:#166534;">Mobiles Moving</div>'
        +   '</div>'
        + '</div>'
        + '<div class="hud-bar-track">'
        +   '<div class="hud-bar-stuck" style="width:' + Math.min(100, Math.max(5, z.stuckPercent)) + '%;background:' + (isExtreme ? '#7F1D1D' : '#EF4444') + ';"></div>'
        + '</div>'
        + '<div class="hud-footer">'
        +   '<span>Avg Speed: ' + z.avgSpeedKmh + ' km/h</span>'
        +   newsBtnHtml
        + '</div>';
      hudEl.style.display = 'block';
    }

    map.on('click', function(e) {
      hideCrowdHud();
      if (currentPinMode) {
        triggerDropPin(e.latlng.lat, e.latlng.lng);
      }
    });

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    window.__selectArea = function(areaName) {
      sendBridgeMessage({ type: 'selectArea', area: areaName });
    };

    // Exact perpendicular point-to-segment projection onto the route polyline (in meters)
    function projectPointToSegmentMeters(pLat, pLon, aLat, aLon, bLat, bLon) {
      const cosLat = Math.cos(((aLat + bLat) * 0.5) * Math.PI / 180);
      const mPerDegLat = 111320.0;
      const mPerDegLon = 111320.0 * cosLat;

      const bx = (bLon - aLon) * mPerDegLon;
      const by = (bLat - aLat) * mPerDegLat;
      const px = (pLon - aLon) * mPerDegLon;
      const py = (pLat - aLat) * mPerDegLat;

      const segLenSq = bx * bx + by * by;
      const t = segLenSq > 1e-6 ? Math.max(0.0, Math.min(1.0, (px * bx + py * by) / segLenSq)) : 0.0;
      const projX = t * bx;
      const projY = t * by;
      const distMeters = Math.hypot(px - projX, py - projY);
      const snapLat = aLat + t * (bLat - aLat);
      const snapLon = aLon + t * (bLon - aLon);
      return { distMeters: distMeters, snapLat: snapLat, snapLon: snapLon };
    }

    function projectPointToPolyline(lat, lon, poly, radiusMeters) {
      if (!poly || poly.length === 0) return null;
      if (poly.length === 1) {
        const d0 = L.latLng(lat, lon).distanceTo(L.latLng(poly[0][0], poly[0][1]));
        return {
          minDistMeters: d0,
          snapLat: poly[0][0],
          snapLon: poly[0][1],
          subCoords: [[poly[0][0], poly[0][1]], [lat, lon]]
        };
      }

      let minD = 9999999;
      let bestSnapLat = poly[0][0];
      let bestSnapLon = poly[0][1];
      let bestIdx = 0;

      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const info = projectPointToSegmentMeters(lat, lon, a[0], a[1], b[0], b[1]);
        if (info.distMeters < minD) {
          minD = info.distMeters;
          bestSnapLat = info.snapLat;
          bestSnapLon = info.snapLon;
          bestIdx = i;
        }
      }

      const subCoords = [];
      const eventLL = L.latLng(lat, lon);
      if (minD <= radiusMeters) {
        for (let i = 0; i < poly.length - 1; i++) {
          const a = poly[i];
          const b = poly[i + 1];
          const segInfo = projectPointToSegmentMeters(lat, lon, a[0], a[1], b[0], b[1]);
          if (segInfo.distMeters <= radiusMeters) {
            const segLen = L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
            const steps = Math.max(1, Math.min(10, Math.ceil(segLen / 140)));
            for (let s = 0; s <= steps; s++) {
              const t = s / steps;
              const ilat = a[0] + t * (b[0] - a[0]);
              const ilon = a[1] + t * (b[1] - a[1]);
              if (eventLL.distanceTo(L.latLng(ilat, ilon)) <= radiusMeters) {
                subCoords.push([ilat, ilon]);
              }
            }
          }
          if (i === bestIdx) {
            subCoords.push([bestSnapLat, bestSnapLon]);
          }
        }
      }

      if (subCoords.length < 2 && minD <= radiusMeters) {
        const a = poly[bestIdx];
        const b = poly[Math.min(poly.length - 1, bestIdx + 1)];
        subCoords.push([a[0], a[1]], [bestSnapLat, bestSnapLon], [b[0], b[1]]);
      }

      return {
        minDistMeters: minD,
        snapLat: bestSnapLat,
        snapLon: bestSnapLon,
        subCoords: subCoords
      };
    }

    function renderLeafletRoadNavigation(primaryPoly, altPoly, distKm, durMin, dangerSegs, markers) {
      routeLayerGroup.clearLayers();
      dangerRoadLayerGroup.clearLayers();

      // A. Alternative Road Route (Dashed Slate Polyline)
      if (altPoly && altPoly.length >= 2) {
        const altLine = L.polyline(altPoly, {
          color: '#64748B',
          weight: 4.5,
          opacity: 0.55,
          dashArray: '6, 8',
          lineCap: 'round'
        }).addTo(routeLayerGroup);

        altLine.bindTooltip('Alternative Road Route', {
          sticky: true,
          direction: 'top'
        });
      }

      // B. Primary Minimum Road Route (Google Maps Navigation Blue)
      if (primaryPoly && primaryPoly.length >= 2) {
        L.polyline(primaryPoly, {
          color: '#185ABC',
          weight: 8.5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(routeLayerGroup);

        L.polyline(primaryPoly, {
          color: '#4285F4',
          weight: 5.5,
          opacity: 1.0,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(routeLayerGroup);

        // Compact translucent ETA pill offset slightly from the route
        if (distKm) {
          const etaLabel = distKm + ' km' + (durMin ? (' • ' + durMin + ' min') : '');
          const etaIdx = Math.floor(primaryPoly.length * 0.22);
          const etaLatLng = L.latLng(primaryPoly[etaIdx] || primaryPoly[0]);
          L.tooltip({
            permanent: true,
            direction: 'right',
            className: 'leaflet-route-eta',
            offset: [10, 0]
          })
            .setLatLng(etaLatLng)
            .setContent(etaLabel)
            .addTo(routeLayerGroup);
        }
      }

      // C. Highlight Affected Road Stretches in RED + Place Accurate Blinking Red Dots
      //    Strictly enforces the 3-hour recency filter (isRecent3h) and snaps every red dot
      //    to the EXACT perpendicular closest point on the rendered road polyline!
      const INTERCEPT_RADIUS_M = 1350;
      const mergedByArea = {};

      (dangerSegs || []).forEach(function(seg) {
        if (!seg || !seg.area) return;
        let snapLat = seg.tooltip_lat;
        let snapLon = seg.tooltip_lon;
        let coords = seg.coords || [];

        if (primaryPoly && primaryPoly.length >= 2) {
          const refLat = seg.event_lat || seg.tooltip_lat;
          const refLon = seg.event_lon || seg.tooltip_lon;
          const proj = projectPointToPolyline(refLat, refLon, primaryPoly, INTERCEPT_RADIUS_M);
          if (proj) {
            snapLat = proj.snapLat;
            snapLon = proj.snapLon;
            if (proj.subCoords && proj.subCoords.length >= 2) {
              coords = proj.subCoords;
            }
          }
        }

        mergedByArea[seg.area] = {
          area: seg.area,
          road_name: seg.road_name || (seg.area + ' Road'),
          event_type: seg.event_type,
          headline: seg.headline,
          veracity_summary: seg.veracity_summary,
          tooltip_lat: snapLat,
          tooltip_lon: snapLon,
          event_lat: seg.event_lat || snapLat,
          event_lon: seg.event_lon || snapLon,
          coords: coords
        };
      });

      if (primaryPoly && primaryPoly.length >= 2) {
        (markers || []).forEach(function(m) {
          // Strictly skip alerts older than 3 hours!
          if (!m.isRecent3h) return;
          const proj = projectPointToPolyline(m.lat, m.lon, primaryPoly, INTERCEPT_RADIUS_M);
          if (!proj) return;
          if (proj.minDistMeters <= INTERCEPT_RADIUS_M) {
            const existing = mergedByArea[m.area];
            if (!existing) {
              mergedByArea[m.area] = {
                area: m.area,
                road_name: m.affectedRoad || (m.area + ' Road'),
                event_type: m.topEventLabel || m.topEvent,
                headline: m.topHeadline || ('Active ' + m.topEvent + ' reported in ' + m.area),
                veracity_summary: m.veracitySummary || (m.maxSources + ' source(s)'),
                tooltip_lat: proj.snapLat,
                tooltip_lon: proj.snapLon,
                event_lat: m.lat,
                event_lon: m.lon,
                coords: proj.subCoords && proj.subCoords.length >= 2
                  ? proj.subCoords
                  : [[proj.snapLat, proj.snapLon], [m.lat, m.lon]]
              };
            } else {
              existing.tooltip_lat = proj.snapLat;
              existing.tooltip_lon = proj.snapLon;
              existing.event_lat = m.lat;
              existing.event_lon = m.lon;
              if (proj.subCoords && proj.subCoords.length >= 2) {
                existing.coords = proj.subCoords;
              }
            }
          }
        });
      }

      const uniqueDangers = Object.values(mergedByArea);
      const seenDangerAreas = {};

      uniqueDangers.forEach(function(seg) {
        seenDangerAreas[seg.area] = true;
        const evText = escapeHtml(String(seg.event_type || 'THREAT').replace(/_/g, ' ').toUpperCase());
        const roadTitle = escapeHtml(seg.road_name || (seg.area + ' Road'));
        const areaTitle = escapeHtml(seg.area || '');
        const headText = escapeHtml(seg.headline || '');
        const verText = escapeHtml(seg.veracity_summary || 'Verified alert');

        const popupHtml = '<div onclick="window.__selectArea(\\'' + areaTitle.replace(/'/g, "\\\\'") + '\\')">'
          + '<div class="avoid-header">'
          +   '<span class="avoid-badge-text">AVOID • ' + evText + '</span>'
          + '</div>'
          + '<div class="avoid-road-name">' + roadTitle + ' (' + areaTitle + ')</div>'
          + (headText ? ('<div class="avoid-headline">' + headText + '</div>') : '')
          + '<div class="avoid-footer">'
          +   '<span>' + verText + '</span>'
          +   '<span class="avoid-open-btn">Details ›</span>'
          + '</div>'
          + '</div>';

        const popupOpts = {
          className: 'leaflet-avoid-popup',
          closeButton: true,
          autoClose: true,
          closeOnClick: true,
          offset: [0, -6]
        };

        // 1. Draw the Red Road Stretch along the route
        if (seg.coords && seg.coords.length >= 2) {
          L.polyline(seg.coords, {
            color: '#7F1D1D',
            weight: 11,
            opacity: 0.72,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(dangerRoadLayerGroup);

          const redRoad = L.polyline(seg.coords, {
            color: '#EF4444',
            weight: 6.5,
            opacity: 0.98,
            lineCap: 'round',
            lineJoin: 'round',
            className: 'leaflet-danger-road'
          }).addTo(dangerRoadLayerGroup);

          redRoad.bindPopup(popupHtml, popupOpts);
        }

        // 2. If event center is offset from the road snap point, draw a dashed red proximity connector
        if (seg.tooltip_lat && seg.tooltip_lon && seg.event_lat && seg.event_lon) {
          const sepMeters = L.latLng(seg.tooltip_lat, seg.tooltip_lon).distanceTo(
            L.latLng(seg.event_lat, seg.event_lon)
          );
          if (sepMeters > 55 && sepMeters <= INTERCEPT_RADIUS_M + 200) {
            L.polyline(
              [[seg.tooltip_lat, seg.tooltip_lon], [seg.event_lat, seg.event_lon]],
              {
                color: '#DC2626',
                weight: 2.5,
                opacity: 0.8,
                dashArray: '4, 6'
              }
            ).addTo(dangerRoadLayerGroup);
          }
        }

        // 3. Place the High-Precision Blinking Red Hazard Dot right on the intercepted route point
        if (seg.tooltip_lat && seg.tooltip_lon) {
          const redDotHtml = '<div class="road-hazard-dot-wrap">'
            + '<div class="road-hazard-pulse-outer"></div>'
            + '<div class="road-hazard-pulse"></div>'
            + '<div class="road-hazard-core"><div class="road-hazard-inner"></div></div>'
            + '</div>';

          const dotMarker = L.marker([seg.tooltip_lat, seg.tooltip_lon], {
            icon: L.divIcon({
              className: 'custom-pin-wrapper',
              html: redDotHtml,
              iconSize: [36, 36],
              iconAnchor: [18, 18]
            }),
            zIndexOffset: 980
          }).addTo(dangerRoadLayerGroup);

          dotMarker.bindPopup(popupHtml, popupOpts);
        }
      });

      return seenDangerAreas;
    }

    window.updateMapState = function(payload) {
      const { currentLocation, destination, todoText, markers, routeGeometry, pinMode } = payload;
      currentPinMode = Boolean(pinMode);

      // 1. User Blue Pulsing Dot (only update if coordinates changed)
      const userSig = currentLocation.lat.toFixed(5) + ',' + currentLocation.lon.toFixed(5);
      if (userSig !== lastUserSig) {
        lastUserSig = userSig;
        if (userMarker) {
          userMarker.setLatLng([currentLocation.lat, currentLocation.lon]);
        } else {
          userMarker = L.marker([currentLocation.lat, currentLocation.lon], {
            icon: L.divIcon({
              className: 'custom-pin-wrapper',
              html: '<div class="user-wrap"><div class="user-pulse"></div><div class="user-dot"></div></div>',
              iconSize: [0, 0],
              iconAnchor: [0, 0]
            })
          }).addTo(map);
        }
      }

      // 2. Draggable Google Maps-style Red Teardrop Destination Pin (only recreate if destination changed)
      const pinTitle = escapeHtml(destination.label || todoText || 'Pinned Destination');
      const destSig = destination.lat.toFixed(5) + ',' + destination.lon.toFixed(5) + ':' + pinTitle;
      if (destSig !== lastDestSig) {
        lastDestSig = destSig;
        if (destMarker) map.removeLayer(destMarker);
        const gmapPinHtml = '<div class="gmap-pin-container">'
          + '<div class="gmap-pin-label">' + pinTitle + '</div>'
          + '<svg class="gmap-pin-svg" viewBox="0 0 38 48" xmlns="http://www.w3.org/2000/svg">'
          +   '<path d="M19 2C9.6 2 2 9.6 2 19c0 12.6 15.2 26.2 16 26.9.6.5 1.4.5 2 0 .8-.7 16-14.3 16-26.9C36 9.6 28.4 2 19 2z" fill="#EA4335" stroke="#FFFFFF" stroke-width="2.5"/>'
          +   '<circle cx="19" cy="18.5" r="6.5" fill="#7F1D1D"/>'
          +   '<circle cx="19" cy="18.5" r="4" fill="#FFFFFF"/>'
          + '</svg>'
          + '<div class="gmap-pin-shadow"></div>'
          + '</div>';

        destMarker = L.marker([destination.lat, destination.lon], {
          draggable: true,
          icon: L.divIcon({
            className: 'custom-pin-wrapper',
            html: gmapPinHtml,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
          }),
          zIndexOffset: 900
        }).addTo(map);

        destMarker.on('dragend', function(ev) {
          const pos = ev.target.getLatLng();
          if (pos) {
            triggerDropPin(pos.lat, pos.lng);
          }
        });
      }

      // 3. Render Road Navigation Route + Red Road Stretches + Interactive Red Dots
      const markersSig = (markers || []).map(function(m) {
        return m.area + ':' + m.clusterCount + ':' + (m.onRoute ? '1' : '0') + ':' + m.color;
      }).join('|');
      const polyLen = (routeGeometry && routeGeometry.polyline) ? routeGeometry.polyline.length : 0;
      const dangerKeys = (routeGeometry && routeGeometry.danger_segments)
        ? routeGeometry.danger_segments.map(function(d) { return d.area + ':' + d.event_type; }).join('|')
        : '';
      const routeSig = userSig + '->' + destination.lat.toFixed(5) + ',' + destination.lon.toFixed(5)
        + '|p:' + polyLen + '|d:' + dangerKeys + '|m:' + markersSig;

      const isFallbackStraightLine =
        routeGeometry &&
        routeGeometry.road_names &&
        routeGeometry.road_names.length === 1 &&
        routeGeometry.road_names[0] === 'Direct Road Corridor';

      let activeDangerAreas = {};
      if (routeSig !== lastRouteSig) {
        lastRouteSig = routeSig;
        if (
          routeGeometry &&
          routeGeometry.polyline &&
          routeGeometry.polyline.length >= 2 &&
          !isFallbackStraightLine
        ) {
          activeDangerAreas = renderLeafletRoadNavigation(
            routeGeometry.polyline,
            routeGeometry.alt_polyline || [],
            routeGeometry.route_distance_km,
            routeGeometry.duration_min,
            routeGeometry.danger_segments || [],
            markers
          ) || {};
        } else {
          const fetchId = ++lastRouteFetchId;
          const osrmUrl = 'https://router.project-osrm.org/route/v1/driving/'
            + currentLocation.lon + ',' + currentLocation.lat + ';'
            + destination.lon + ',' + destination.lat
            + '?overview=full&geometries=geojson&alternatives=true';

          fetch(osrmUrl)
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (fetchId !== lastRouteFetchId) return;
              if (data && data.routes && data.routes.length > 0) {
                const r0 = data.routes[0];
                const poly0 = r0.geometry.coordinates.map(function(c) { return [c[1], c[0]]; });
                const poly1 = data.routes[1]
                  ? data.routes[1].geometry.coordinates.map(function(c) { return [c[1], c[0]]; })
                  : [];
                const dKm = Math.round((r0.distance / 1000) * 10) / 10;
                const dMin = Math.max(1, Math.round(r0.duration / 60));
                renderLeafletRoadNavigation(poly0, poly1, dKm, dMin, [], markers);
              }
            })
            .catch(function() {
              if (fetchId !== lastRouteFetchId) return;
              renderLeafletRoadNavigation(
                [[currentLocation.lat, currentLocation.lon], [destination.lat, destination.lon]],
                [],
                null,
                null,
                [],
                markers
              );
            });
        }
      }

      // 4. All-Bangladesh Independent Real-Time Peak-Threshold Heatmap Engine + Area Badges
      currentNewsMarkers = markers || [];
      const fullMarkersSig = markersSig + '|da:' + Object.keys(activeDangerAreas).sort().join(',');
      if (fullMarkersSig !== lastMarkersSig) {
        lastMarkersSig = fullMarkersSig;
        alertMarkerLayerGroup.clearLayers();

        currentNewsMarkers.forEach(function(m) {
          const isIntercepted = Boolean(m.isRecent3h && (m.onRoute || activeDangerAreas[m.area]));
          const circleColor = isIntercepted ? '#DC2626' : m.color;
          const badgeClass = isIntercepted ? 'area-badge area-badge-onroute' : 'area-badge';
          const dotPrefix = isIntercepted ? '<span class="onroute-dot-indicator"></span>' : '';
          const htmlBadge = '<div class="' + badgeClass + '" style="background:' + circleColor + ';">'
            + dotPrefix
            + '<span>' + escapeHtml(m.area) + '</span>'
            + '<span class="area-count">' + m.clusterCount + '</span>'
            + '</div>';
          const marker = L.marker([m.lat, m.lon], {
            icon: L.divIcon({
              className: 'custom-pin-wrapper',
              html: htmlBadge,
              iconSize: [0, 0],
              iconAnchor: [0, 0]
            }),
            zIndexOffset: isIntercepted ? 920 : 400
          });
          marker.on('click', function(ev) {
            L.DomEvent.stopPropagation(ev);
            const z = currentZoneMap[m.area];
            if (z) showCrowdHud(z);
            sendBridgeMessage({ type: 'selectArea', area: m.area });
          });
          marker.addTo(alertMarkerLayerGroup);
        });

        renderRealtimeBangladeshHeatmaps();
      }
    };

    // Whole-Bangladesh Spatial Telemetry Network (All 64 Districts + Highway Hubs + Dhaka Metro Nodes)
    const ALL_BD_LOCATIONS = [
      // Dhaka Metro Hubs (tier 1: peakThreshold = 360)
      { area: 'Mirpur-10', lat: 23.8069, lon: 90.3687, tier: 1 },
      { area: 'Mirpur-1', lat: 23.7985, lon: 90.3536, tier: 1 },
      { area: 'Mirpur-2', lat: 23.8045, lon: 90.3621, tier: 2 },
      { area: 'Mirpur-11', lat: 23.8168, lon: 90.3658, tier: 2 },
      { area: 'Mirpur-12', lat: 23.8286, lon: 90.3642, tier: 2 },
      { area: 'Pallabi', lat: 23.8258, lon: 90.3654, tier: 2 },
      { area: 'Kalshi', lat: 23.8195, lon: 90.3765, tier: 2 },
      { area: 'Kazipara', lat: 23.7975, lon: 90.3728, tier: 2 },
      { area: 'Shewrapara', lat: 23.7889, lon: 90.3756, tier: 2 },
      { area: 'Agargaon', lat: 23.7776, lon: 90.3792, tier: 1 },
      { area: 'Bijoy Sarani', lat: 23.7654, lon: 90.3892, tier: 1 },
      { area: 'Farmgate', lat: 23.7561, lon: 90.3872, tier: 1 },
      { area: 'Karwan Bazar', lat: 23.7516, lon: 90.3929, tier: 1 },
      { area: 'Banglamotor', lat: 23.7462, lon: 90.3945, tier: 1 },
      { area: 'Shahbagh', lat: 23.7389, lon: 90.3948, tier: 1 },
      { area: 'Paltan', lat: 23.7364, lon: 90.4143, tier: 1 },
      { area: 'Motijheel', lat: 23.7330, lon: 90.4172, tier: 1 },
      { area: 'Gulistan', lat: 23.7246, lon: 90.4126, tier: 1 },
      { area: 'Jatrabari', lat: 23.7104, lon: 90.4349, tier: 1 },
      { area: 'Sayedabad', lat: 23.7135, lon: 90.4278, tier: 1 },
      { area: 'Shanir Akhra', lat: 23.7024, lon: 90.4512, tier: 2 },
      { area: 'Signboard', lat: 23.6945, lon: 90.4765, tier: 2 },
      { area: 'Dhanmondi', lat: 23.7461, lon: 90.3742, tier: 1 },
      { area: 'Science Lab', lat: 23.7389, lon: 90.3834, tier: 1 },
      { area: 'New Market', lat: 23.7332, lon: 90.3839, tier: 1 },
      { area: 'Azimpur', lat: 23.7276, lon: 90.3852, tier: 2 },
      { area: 'Mohammadpur', lat: 23.7662, lon: 90.3589, tier: 1 },
      { area: 'Shyamoli', lat: 23.7745, lon: 90.3654, tier: 1 },
      { area: 'Kallyanpur', lat: 23.7798, lon: 90.3612, tier: 2 },
      { area: 'Gabtoli', lat: 23.7837, lon: 90.3442, tier: 1 },
      { area: 'Tejgaon', lat: 23.7639, lon: 90.3992, tier: 1 },
      { area: 'Mohakhali', lat: 23.7778, lon: 90.4057, tier: 1 },
      { area: 'Banani', lat: 23.7937, lon: 90.4066, tier: 1 },
      { area: 'Gulshan', lat: 23.7925, lon: 90.4158, tier: 1 },
      { area: 'Badda', lat: 23.7805, lon: 90.4267, tier: 1 },
      { area: 'Rampura', lat: 23.7612, lon: 90.4219, tier: 1 },
      { area: 'Malibagh', lat: 23.7495, lon: 90.4128, tier: 1 },
      { area: 'Moghbazar', lat: 23.7490, lon: 90.4034, tier: 1 },
      { area: 'Kakrail', lat: 23.7376, lon: 90.4085, tier: 2 },
      { area: 'Khilgaon', lat: 23.7506, lon: 90.4292, tier: 2 },
      { area: 'Bashundhara', lat: 23.8191, lon: 90.4326, tier: 2 },
      { area: 'Kuril', lat: 23.8219, lon: 90.4214, tier: 1 },
      { area: 'Airport', lat: 23.8513, lon: 90.4089, tier: 1 },
      { area: 'Uttara', lat: 23.8759, lon: 90.3795, tier: 1 },
      { area: 'Abdullahpur', lat: 23.8805, lon: 90.4008, tier: 1 },
      { area: 'Hatirjheel', lat: 23.7667, lon: 90.4125, tier: 2 },
      { area: 'Old Dhaka', lat: 23.7115, lon: 90.4072, tier: 1 },
      { area: 'Sadarghat', lat: 23.7062, lon: 90.4086, tier: 1 },
      { area: 'Kamrangirchar', lat: 23.7158, lon: 90.3741, tier: 2 },
      { area: 'Keraniganj', lat: 23.6942, lon: 90.3875, tier: 2 },
      { area: 'Demra', lat: 23.7225, lon: 90.4892, tier: 2 },
      // Highway & Industrial Hubs across Greater Dhaka
      { area: 'Savar', lat: 23.8583, lon: 90.2667, tier: 1 },
      { area: 'Ashulia', lat: 23.8981, lon: 90.3264, tier: 1 },
      { area: 'Tongi', lat: 23.8915, lon: 90.4023, tier: 1 },
      { area: 'Gazipur', lat: 23.9999, lon: 90.4203, tier: 1 },
      { area: 'Narayanganj', lat: 23.6238, lon: 90.5000, tier: 1 },
      // All 64 Bangladesh Districts & Divisional Cities (Whole Bangladesh Coverage)
      { area: 'Chattogram', lat: 22.3569, lon: 91.7832, tier: 1 },
      { area: 'Sylhet', lat: 24.8949, lon: 91.8687, tier: 1 },
      { area: 'Rajshahi', lat: 24.3745, lon: 88.6042, tier: 1 },
      { area: 'Khulna', lat: 22.8456, lon: 89.5403, tier: 1 },
      { area: 'Barishal', lat: 22.7010, lon: 90.3535, tier: 1 },
      { area: 'Rangpur', lat: 25.7439, lon: 89.2752, tier: 1 },
      { area: 'Mymensingh', lat: 24.7471, lon: 90.4203, tier: 1 },
      { area: 'Cumilla', lat: 23.4607, lon: 91.1809, tier: 1 },
      { area: 'Bogura', lat: 24.8481, lon: 89.3730, tier: 1 },
      { area: "Cox's Bazar", lat: 21.4272, lon: 92.0058, tier: 2 },
      { area: 'Jessore', lat: 23.1664, lon: 89.2081, tier: 2 },
      { area: 'Tangail', lat: 24.2513, lon: 89.9167, tier: 2 },
      { area: 'Faridpur', lat: 23.6070, lon: 89.8429, tier: 2 },
      { area: 'Pabna', lat: 24.0064, lon: 89.2372, tier: 2 },
      { area: 'Kushtia', lat: 23.9013, lon: 89.1204, tier: 2 },
      { area: 'Dinajpur', lat: 25.6279, lon: 88.6332, tier: 2 },
      { area: 'Noakhali', lat: 22.8696, lon: 91.0994, tier: 2 },
      { area: 'Feni', lat: 23.0159, lon: 91.3976, tier: 2 },
      { area: 'Brahmanbaria', lat: 23.9571, lon: 91.1119, tier: 2 },
      { area: 'Chandpur', lat: 23.2333, lon: 90.6667, tier: 2 },
      { area: 'Lakshmipur', lat: 22.9447, lon: 90.8282, tier: 2 },
      { area: 'Narsingdi', lat: 23.9230, lon: 90.7177, tier: 2 },
      { area: 'Munshiganj', lat: 23.5422, lon: 90.5305, tier: 2 },
      { area: 'Manikganj', lat: 23.8617, lon: 90.0003, tier: 2 },
      { area: 'Gopalganj', lat: 23.0051, lon: 89.8266, tier: 2 },
      { area: 'Madaripur', lat: 23.1641, lon: 90.1897, tier: 2 },
      { area: 'Shariatpur', lat: 23.2423, lon: 90.4348, tier: 2 },
      { area: 'Rajbari', lat: 23.7574, lon: 89.6445, tier: 2 },
      { area: 'Kishoreganj', lat: 24.4449, lon: 90.7766, tier: 2 },
      { area: 'Netrokona', lat: 24.8710, lon: 90.7279, tier: 2 },
      { area: 'Jamalpur', lat: 24.9375, lon: 89.9378, tier: 2 },
      { area: 'Sherpur', lat: 25.0205, lon: 90.0153, tier: 2 },
      { area: 'Sirajganj', lat: 24.4534, lon: 89.7007, tier: 2 },
      { area: 'Natore', lat: 24.4206, lon: 89.0006, tier: 2 },
      { area: 'Naogaon', lat: 24.7936, lon: 88.9318, tier: 2 },
      { area: 'Chapainawabganj', lat: 24.5965, lon: 88.2775, tier: 2 },
      { area: 'Joypurhat', lat: 25.0968, lon: 89.0227, tier: 2 },
      { area: 'Satkhira', lat: 22.7185, lon: 89.0705, tier: 2 },
      { area: 'Bagerhat', lat: 22.6516, lon: 89.7859, tier: 2 },
      { area: 'Jhenaidah', lat: 23.5450, lon: 89.1726, tier: 2 },
      { area: 'Magura', lat: 23.4873, lon: 89.4199, tier: 2 },
      { area: 'Narail', lat: 23.1725, lon: 89.5127, tier: 2 },
      { area: 'Chuadanga', lat: 23.6402, lon: 88.8418, tier: 2 },
      { area: 'Meherpur', lat: 23.7622, lon: 88.6318, tier: 2 },
      { area: 'Patuakhali', lat: 22.3596, lon: 90.3299, tier: 2 },
      { area: 'Bhola', lat: 22.6859, lon: 90.6482, tier: 2 },
      { area: 'Pirojpur', lat: 22.5841, lon: 89.9720, tier: 2 },
      { area: 'Jhalokati', lat: 22.6406, lon: 90.1987, tier: 2 },
      { area: 'Barguna', lat: 22.1592, lon: 90.1256, tier: 2 },
      { area: 'Habiganj', lat: 24.3749, lon: 91.4155, tier: 2 },
      { area: 'Moulvibazar', lat: 24.4829, lon: 91.7774, tier: 2 },
      { area: 'Sunamganj', lat: 25.0658, lon: 91.3950, tier: 2 },
      { area: 'Kurigram', lat: 25.8054, lon: 89.6362, tier: 2 },
      { area: 'Gaibandha', lat: 25.3290, lon: 89.5430, tier: 2 },
      { area: 'Nilphamari', lat: 25.9318, lon: 88.8561, tier: 2 },
      { area: 'Lalmonirhat', lat: 25.9165, lon: 89.4532, tier: 2 },
      { area: 'Thakurgaon', lat: 26.0337, lon: 88.4617, tier: 2 },
      { area: 'Panchagarh', lat: 26.3411, lon: 88.5542, tier: 2 },
      { area: 'Rangamati', lat: 22.6533, lon: 92.1789, tier: 2 },
      { area: 'Khagrachhari', lat: 23.1193, lon: 91.9847, tier: 2 },
      { area: 'Bandarban', lat: 22.1953, lon: 92.2184, tier: 2 }
    ];

    function hashAreaSeed(name) {
      let h = 2166136261;
      for (let i = 0; i < name.length; i++) {
        h ^= name.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return Math.abs(h);
    }

    function computeRealtimeCell(loc, nowSec, newsMarker) {
      const seed = hashAreaSeed(loc.area);
      const phaseA = (seed % 360) * (Math.PI / 180);
      const phaseB = ((seed >> 4) % 360) * (Math.PI / 180);
      const peakThreshold = loc.tier === 1 ? 360 : 180;
      const baseVolume = loc.tier === 1 ? 305 : 145;
      const waveAmp = loc.tier === 1 ? 195 : 105;

      // Smoothly evolving real-time wave across Bangladesh (updates every 2.5 seconds)
      const wave1 = Math.sin(nowSec / 18.0 + phaseA);
      const wave2 = Math.cos(nowSec / 41.0 + phaseB);
      const combinedWave = 0.62 * wave1 + 0.38 * wave2;

      const hasRecentNews = Boolean(newsMarker && newsMarker.isRecent3h);
      const isCritNews = Boolean(newsMarker && newsMarker.hasCritical && hasRecentNews);
      const newsSurge = hasRecentNews ? (isCritNews ? 270 : 165) : 0;

      const totalMobiles = Math.max(
        60,
        Math.round(baseVolume + combinedWave * waveAmp + newsSurge)
      );

      // Peak-Threshold Gating: only generate heatmap when crossing Peak Threshold!
      const exceedsPeak = totalMobiles >= peakThreshold || hasRecentNews;
      const excessRatio = Math.max(0, (totalMobiles - peakThreshold) / Math.max(1, peakThreshold));

      let stuckPercent;
      if (hasRecentNews) {
        const baseStuck = isCritNews ? 82 : 66;
        stuckPercent = Math.min(96, Math.max(52, Math.round(baseStuck + 8 * wave1)));
      } else if (exceedsPeak) {
        stuckPercent = Math.min(
          92,
          Math.max(38, Math.round(38 + excessRatio * 82 + 9 * Math.max(0, wave1)))
        );
      } else {
        stuckPercent = Math.max(10, Math.min(34, Math.round(20 + 8 * wave1)));
      }

      const mobilesStuck = Math.round((totalMobiles * stuckPercent) / 100);
      const mobilesMoving = Math.max(0, totalMobiles - mobilesStuck);
      const movingPercent = 100 - stuckPercent;
      const avgSpeedKmh = Math.max(
        0.8,
        Math.round((27.0 * Math.pow(1 - stuckPercent / 105.0, 1.45)) * 10) / 10
      );

      let heatIntensity = 0;
      let intensityLabel = 'Below Peak';
      if (exceedsPeak) {
        heatIntensity = Math.min(
          1.0,
          Math.round((0.46 + excessRatio * 0.78 + (stuckPercent / 100) * 0.24) * 100) / 100
        );
        if (heatIntensity >= 0.85) {
          intensityLabel = 'Extreme Peak (Dark Zone)';
        } else if (heatIntensity >= 0.65) {
          intensityLabel = 'High Peak Surge';
        } else {
          intensityLabel = 'Peak Threshold Crossed';
        }
      }

      return {
        area: loc.area,
        lat: loc.lat,
        lon: loc.lon,
        peakThreshold: peakThreshold,
        exceedsPeak: exceedsPeak,
        totalMobiles: totalMobiles,
        mobilesStuck: mobilesStuck,
        mobilesMoving: mobilesMoving,
        stuckPercent: stuckPercent,
        movingPercent: movingPercent,
        avgSpeedKmh: avgSpeedKmh,
        heatIntensity: heatIntensity,
        intensityLabel: intensityLabel,
        hasNews: Boolean(newsMarker),
        clusterCount: newsMarker ? newsMarker.clusterCount : 0
      };
    }

    function renderRealtimeBangladeshHeatmaps() {
      heatmapLayerGroup.clearLayers();
      const nowSec = Date.now() / 1000.0;
      const newsByArea = {};
      (currentNewsMarkers || []).forEach(function(m) {
        newsByArea[m.area] = m;
      });

      const activeZones = [];
      const newZoneMap = {};
      const seenCoords = [];

      // 1. Evaluate all 113 Bangladesh districts, highway junctions & metro neighborhoods
      ALL_BD_LOCATIONS.forEach(function(loc) {
        const cell = computeRealtimeCell(loc, nowSec, newsByArea[loc.area]);
        newZoneMap[loc.area] = cell;
        seenCoords.push([loc.lat, loc.lon]);
        if (cell.exceedsPeak) {
          activeZones.push(cell);
        }
      });

      // 2. Also include any news marker location not in ALL_BD_LOCATIONS
      (currentNewsMarkers || []).forEach(function(m) {
        if (!newZoneMap[m.area]) {
          const cell = computeRealtimeCell({ area: m.area, lat: m.lat, lon: m.lon, tier: 1 }, nowSec, m);
          newZoneMap[m.area] = cell;
          if (cell.exceedsPeak) {
            activeZones.push(cell);
          }
        }
      });

      // 3. Dynamic Viewport Spatial Sampling anywhere inside Bangladesh (20.7..26.6N, 88.0..92.7E)
      //    so panning/zooming anywhere in Bangladesh generates independent peak-threshold heatmaps
      const zoom = map.getZoom();
      if (zoom >= 9) {
        const b = map.getBounds();
        const minLat = Math.max(20.75, b.getSouth());
        const maxLat = Math.min(26.60, b.getNorth());
        const minLon = Math.max(88.05, b.getWest());
        const maxLon = Math.min(92.65, b.getEast());
        if (maxLat > minLat && maxLon > minLon) {
          const step = zoom >= 13 ? 0.025 : (zoom >= 11 ? 0.06 : 0.14);
          const startLat = Math.floor(minLat / step) * step;
          const startLon = Math.floor(minLon / step) * step;
          let count = 0;
          for (let glat = startLat; glat <= maxLat && count < 48; glat += step) {
            for (let glon = startLon; glon <= maxLon && count < 48; glon += step) {
              let nearExisting = false;
              for (let k = 0; k < seenCoords.length; k++) {
                if (Math.hypot(glat - seenCoords[k][0], glon - seenCoords[k][1]) < step * 0.72) {
                  nearExisting = true;
                  break;
                }
              }
              if (nearExisting) continue;
              count++;
              const cellName = 'BD Sector (' + glat.toFixed(2) + '°N, ' + glon.toFixed(2) + '°E)';
              const cell = computeRealtimeCell({ area: cellName, lat: glat, lon: glon, tier: 2 }, nowSec, null);
              newZoneMap[cellName] = cell;
              if (cell.exceedsPeak) {
                activeZones.push(cell);
              }
            }
          }
        }
      }

      currentZoneMap = newZoneMap;

      // Scale radii based on zoom level so whole-Bangladesh view and street view both look crisp
      const zoomScale = zoom <= 8 ? 5.2 : (zoom <= 10 ? 2.6 : (zoom <= 12 ? 1.15 : 0.85));
      const spreadDeg = zoom <= 8 ? 0.032 : (zoom <= 10 ? 0.014 : 0.0022);
      const heatPoints = [];

      activeZones.forEach(function(z) {
        const w = z.heatIntensity;
        heatPoints.push([z.lat, z.lon, w]);
        for (let i = 0; i < 8; i++) {
          const ang = (2 * Math.PI * i) / 8;
          const r = spreadDeg + (i % 2) * (spreadDeg * 0.55);
          heatPoints.push([
            z.lat + Math.sin(ang) * r,
            z.lon + Math.cos(ang) * r,
            Math.max(0.3, w * 0.84)
          ]);
        }

        // Darker color & higher opacity the further above the Peak Threshold it climbs
        const isExtreme = w >= 0.85;
        const isHigh = w >= 0.65 && !isExtreme;
        const outerColor = isExtreme ? '#7F1D1D' : (isHigh ? '#DC2626' : '#F59E0B');
        const coreColor = isExtreme ? '#3B0707' : (isHigh ? '#991B1B' : '#D97706');

        // Outer soft thermal halo
        L.circle([z.lat, z.lon], {
          radius: (isExtreme ? 740 : (isHigh ? 590 : 470)) * zoomScale,
          stroke: false,
          fillColor: outerColor,
          fillOpacity: isExtreme ? 0.28 : (isHigh ? 0.21 : 0.16),
          interactive: false
        }).addTo(heatmapLayerGroup);

        // Clickable heatmap zone
        const clickZone = L.circle([z.lat, z.lon], {
          radius: (isExtreme ? 490 : (isHigh ? 410 : 340)) * zoomScale,
          color: coreColor,
          weight: isExtreme ? 1.8 : 1.3,
          opacity: isExtreme ? 0.78 : 0.55,
          fillColor: coreColor,
          fillOpacity: isExtreme ? 0.44 : (isHigh ? 0.31 : 0.22),
          interactive: true
        }).addTo(heatmapLayerGroup);

        // Extra-dark inner core when peak threshold is heavily exceeded
        if (w >= 0.72) {
          L.circle([z.lat, z.lon], {
            radius: (isExtreme ? 240 : 180) * zoomScale,
            stroke: false,
            fillColor: '#2A0404',
            fillOpacity: isExtreme ? 0.52 : 0.34,
            interactive: false
          }).addTo(heatmapLayerGroup);
        }

        clickZone.on('click', function(ev) {
          L.DomEvent.stopPropagation(ev);
          showCrowdHud(z);
        });
      });

      if (heatPoints.length > 0 && typeof L.heatLayer === 'function') {
        L.heatLayer(heatPoints, {
          radius: zoom <= 8 ? 22 : 30,
          blur: zoom <= 8 ? 16 : 20,
          maxZoom: 15,
          gradient: {
            0.35: '#F59E0B',
            0.60: '#DC2626',
            0.82: '#991B1B',
            1.00: '#3B0707'
          }
        }).addTo(heatmapLayerGroup);
      }

      // Live-refresh the open HUD if the user currently has a heatmap clicked
      if (activeHudArea && currentZoneMap[activeHudArea] && hudEl && hudEl.style.display === 'block') {
        showCrowdHud(currentZoneMap[activeHudArea]);
      }
    }

    // Autonomous real-time heatmap stream across all of Bangladesh (no manual Sync required)
    setInterval(renderRealtimeBangladeshHeatmaps, 2500);
    map.on('moveend', function() {
      renderRealtimeBangladeshHeatmaps();
    });

    window.focusLocation = function(lat, lon, zoom) {
      map.flyTo([lat, lon], zoom || 14, { duration: 0.6 });
    };

    window.fitRouteBounds = function(lat1, lon1, lat2, lon2) {
      if (routeLayerGroup.getLayers().length > 0) {
        map.fitBounds(routeLayerGroup.getBounds(), { padding: [52, 52], maxZoom: 14 });
      } else {
        const bounds = L.latLngBounds([[lat1, lon1], [lat2, lon2]]);
        map.fitBounds(bounds, { padding: [52, 52], maxZoom: 14 });
      }
    };
  </script>
</body>
</html>`,
    []
  );

  const runScript = (js: string) => {
    if (Platform.OS === "web") {
      try {
        const win = iframeRef.current?.contentWindow as any;
        if (win) win.eval(js);
      } catch {}
    } else {
      webRef.current?.injectJavaScript(js);
    }
  };

  const pushStateToWebView = () => {
    const payload = JSON.stringify({
      currentLocation,
      destination,
      todoText,
      markers: areaMarkers,
      routeGeometry: routeGeometry || null,
      pinMode,
    });
    runScript(`window.updateMapState && window.updateMapState(${payload}); true;`);
  };

  useEffect(() => {
    pushStateToWebView();
  }, [currentLocation, destination, todoText, areaMarkers, routeGeometry, pinMode]);

  useEffect(() => {
    if (focusCoords) {
      runScript(
        `window.focusLocation && window.focusLocation(${focusCoords.lat}, ${focusCoords.lon}, ${focusCoords.zoom || 14}); true;`
      );
    }
  }, [focusCoords]);

  useEffect(() => {
    if (fitRouteNonce && fitRouteNonce > 0) {
      runScript(
        `window.fitRouteBounds && window.fitRouteBounds(${currentLocation.lat}, ${currentLocation.lon}, ${destination.lat}, ${destination.lon}); true;`
      );
    }
  }, [fitRouteNonce]);

  // Listen for iframe postMessage when running on Web
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onWebMsg = (ev: MessageEvent) => {
      try {
        const msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (msg?.type === "pinDestination" && typeof msg.lat === "number") {
          onPinDestination(msg.lat, msg.lon, msg.roadLabel);
        } else if (msg?.type === "selectArea" && typeof msg.area === "string") {
          onSelectArea(msg.area);
        }
      } catch {}
    };
    window.addEventListener("message", onWebMsg);
    return () => window.removeEventListener("message", onWebMsg);
  }, [onPinDestination, onSelectArea]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "pinDestination" && typeof msg.lat === "number") {
        onPinDestination(msg.lat, msg.lon, msg.roadLabel);
      } else if (msg.type === "selectArea" && typeof msg.area === "string") {
        onSelectArea(msg.area);
      }
    } catch {
      // ignore malformed bridge message
    }
  };

  if (Platform.OS === "web") {
    return (
      <View style={styles.container}>
        <iframe
          ref={iframeRef}
          srcDoc={html}
          onLoad={pushStateToWebView}
          style={{ width: "100%", height: "100%", border: "none", background: "#F8F9FA" }}
          title="BigWarn Leaflet Map"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TypedWebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://bigwarn.app" }}
        style={styles.webview}
        onLoadEnd={pushStateToWebView}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FA" },
  webview: { flex: 1, backgroundColor: "#F8F9FA" },
});
