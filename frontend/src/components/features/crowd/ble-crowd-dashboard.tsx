"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface BleScannerRow {
  device_id: string;
  device_label: string;
  area: string;
  city: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  accuracy_m: number;
  network_type: string;
  ble_count: number;
  bt_classic_count?: number;
  wifi_mobile_count?: number;
  wifi_hotspot_count?: number;
  wifi_p2p_count?: number;
  wifi_lan_count?: number;
  wifi_ap_count?: number;
  filtered_routers_count?: number;
  filtered_audio_count?: number;
  filtered_other_count?: number;
  detected_models?: string[];
  cell_rsrp_dbm?: number;
  cell_rsrq_db?: number;
  cell_load_percent?: number;
  cell_tower_count?: number;
  cell_network_type?: string;
  total_crowd_around_me: number;
  static_devices: number;
  moving_devices: number;
  static_percent: number;
  moving_percent: number;
  mobility_state: "STATIC" | "SLOW_MOVING" | "MOVING" | string;
  crowd_pattern: string;
  avg_rssi_dbm: number;
  scan_radius_m: number;
  density_per_100m2: number;
  peak_threshold: number;
  exceeds_peak: boolean;
  last_ping_iso: string;
  age_seconds?: number;
}

export interface BleHeatmapZone {
  area: string;
  city: string;
  lat: number;
  lon: number;
  is_verified: boolean;
  verification_basis: string;
  scanner_nodes_count: number;
  ble_peers_count: number;
  wifi_mobile_peers_count?: number;
  wifi_fixed_ap_count?: number;
  filtered_routers_count?: number;
  filtered_audio_count?: number;
  filtered_other_count?: number;
  detected_models?: string[];
  cell_load_percent?: number;
  cell_rsrq_db?: number;
  cell_rsrp_dbm?: number;
  total_mobiles: number;
  mobiles_stuck: number;
  mobiles_moving: number;
  stuck_percent: number;
  moving_percent: number;
  avg_speed_kmh: number;
  mobility_state: "STATIC" | "SLOW_MOVING" | "MOVING" | string;
  crowd_pattern: string;
  avg_rssi_dbm: number;
  density_per_100m2: number;
  peak_threshold: number;
  exceeds_peak: boolean;
  heat_intensity: number;
  intensity_label: string;
  last_ping_iso?: string;
}

export interface BleCrowdSnapshot {
  status: string;
  updated_at: string;
  summary: {
    active_scanner_apps: number;
    total_ble_detected: number;
    total_wifi_mobile_detected?: number;
    avg_cell_load_percent?: number;
    total_crowd_devices: number;
    total_static_devices: number;
    total_moving_devices: number;
    active_zones_count: number;
    static_hotspots_count: number;
  };
  scanners: BleScannerRow[];
  heatmaps: BleHeatmapZone[];
}

type DeviceKind = "phone" | "router" | "audio" | "tv_pc";

function parseDetectedModelEntry(raw: string): {
  kind: DeviceKind;
  label: string;
  title: string;
} {
  const clean = String(raw || "").trim();
  let kind: DeviceKind = "phone";
  if (clean.includes("[Filtered Router]")) kind = "router";
  else if (clean.includes("[Filtered Earbud/Watch]") || clean.includes("[Filtered Audio]")) kind = "audio";
  else if (clean.includes("[Filtered TV/PC]") || clean.includes("Filtered")) kind = "tv_pc";

  const label = clean
    .replace(/\[Filtered\s+(?:Router|Earbud\/Watch|Audio|TV\/PC)\]\s*/gi, "")
    .trim();

  return { kind, label: label || clean, title: clean };
}

function DeviceModelsBreakdown({
  scanner,
  expanded,
  onToggleExpand,
  maxPreview = 8,
  compact = false,
}: {
  scanner: BleScannerRow;
  expanded: boolean;
  onToggleExpand: () => void;
  maxPreview?: number;
  compact?: boolean;
}) {
  const models = Array.isArray(scanner.detected_models)
    ? scanner.detected_models.filter(Boolean)
    : [];
  const parsed = models.map(parseDetectedModelEntry);
  const phones = parsed.filter((m) => m.kind === "phone");
  const filtered = parsed.filter((m) => m.kind !== "phone");

  const filtRouters = scanner.filtered_routers_count || 0;
  const filtAudio = scanner.filtered_audio_count || 0;
  const filtOther = scanner.filtered_other_count || 0;
  const filtTotal = filtRouters + filtAudio + filtOther;

  const shownPhones = expanded ? phones : phones.slice(0, maxPreview);
  const remainingSlots = Math.max(0, maxPreview - shownPhones.length);
  const shownFiltered = expanded
    ? filtered
    : filtered.slice(0, Math.max(2, remainingSlots));
  const hiddenCount =
    phones.length - shownPhones.length + (filtered.length - shownFiltered.length);

  if (parsed.length === 0 && filtTotal === 0) {
    const peerCount =
      (scanner.ble_count || 0) + (scanner.wifi_mobile_count || 0);
    return (
      <span className="text-[11px] font-mono text-[#9a988f]">
        {peerCount > 0
          ? `${peerCount} unnamed peer(s) detected`
          : "No nearby devices advertised"}
      </span>
    );
  }

  const badgeTone = (kind: DeviceKind) => {
    switch (kind) {
      case "phone":
        return "bg-sky-950/75 text-sky-200 border border-sky-700/60";
      case "router":
        return "bg-[#242724] text-[#c2c0b6] border border-[#3a3e3a]";
      case "audio":
        return "bg-amber-950/40 text-amber-200/90 border border-amber-800/40";
      case "tv_pc":
        return "bg-purple-950/40 text-purple-200/90 border border-purple-800/40";
    }
  };

  return (
    <div className={compact ? "space-y-1.5" : "space-y-1.5 min-w-[260px]"}>
      {shownPhones.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
            Counted Phones ({phones.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {shownPhones.map((item, idx) => (
              <span
                key={`ph-${idx}`}
                title={item.title}
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-mono leading-tight whitespace-nowrap ${badgeTone(
                  item.kind
                )}`}
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {(filtTotal > 0 || shownFiltered.length > 0) && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-[#9a988f]">
            Filtered Out: {filtRouters} Router • {filtAudio} Earbud/Watch •{" "}
            {filtOther} TV/PC
          </div>
          {shownFiltered.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {shownFiltered.map((item, idx) => (
                <span
                  key={`fl-${idx}`}
                  title={item.title}
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono leading-tight whitespace-nowrap ${badgeTone(
                    item.kind
                  )}`}
                >
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="text-[10.5px] font-mono text-sky-400 hover:text-sky-300 underline underline-offset-2"
        >
          {expanded ? "Show fewer devices" : `+${hiddenCount} more device(s)`}
        </button>
      )}
    </div>
  );
}

export function BleCrowdDashboard() {
  const [snapshot, setSnapshot] = useState<BleCrowdSnapshot | null>(null);
  const [expandedDevices, setExpandedDevices] = useState<Record<string, boolean>>({});
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const toggleExpandedDevice = useCallback((deviceId: string) => {
    setExpandedDevices((prev) => ({
      ...prev,
      [deviceId]: !prev[deviceId],
    }));
  }, []);

  const fetchCrowdSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/crowd", { cache: "no-store" });
      if (res.ok) {
        const data: BleCrowdSnapshot = await res.json();
        setSnapshot(data);
      }
    } catch {}
  }, []);

  // Poll active mobile app users' BLE crowd telemetry every 5 seconds (read-only on web)
  useEffect(() => {
    fetchCrowdSnapshot();
    const timer = setInterval(fetchCrowdSnapshot, 5000);
    return () => clearInterval(timer);
  }, [fetchCrowdSnapshot]);

  const mapHtml = useMemo(
    () => `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
  <style>
    html, body, #map {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background: #F8F9FA;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .leaflet-tile-pane {
      filter: brightness(1.03) contrast(0.96) saturate(0.88);
    }
    .ble-badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 9px; border-radius: 999px;
      font-size: 11px; font-weight: 800; color: #FFFFFF;
      border: 2px solid #FFFFFF;
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.28);
      white-space: nowrap;
      transform: translate(-50%, -50%);
    }
    .ble-pulse-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #FFFFFF;
      animation: blink 1.1s infinite ease-in-out;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.75); }
    }
    #hud {
      position: fixed; left: 16px; bottom: 16px;
      width: min(330px, calc(100vw - 32px));
      background: rgba(255, 255, 255, 0.97);
      border: 1.5px solid #CBD5E1;
      border-radius: 16px; padding: 12px 14px;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.22);
      z-index: 1000; display: none; color: #0F172A;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="hud"></div>
  <script>
    const map = L.map('map', { zoomControl: true }).setView([23.7700, 90.3950], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    const heatGroup = L.featureGroup().addTo(map);
    const markerGroup = L.featureGroup().addTo(map);
    const hud = document.getElementById('hud');

    function esc(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showHud(z) {
      if (!hud || !z) return;
      const isStatic = z.mobility_state === 'STATIC' || (z.stuck_percent || 0) >= 65;
      const badgeBg = isStatic ? '#450A0A' : (z.mobility_state === 'SLOW_MOVING' ? '#FEF3C7' : '#DCFCE7');
      const badgeCol = isStatic ? '#FECACA' : (z.mobility_state === 'SLOW_MOVING' ? '#B45309' : '#15803D');
      const stateText = isStatic ? '🔴 STATIC CROWD' : (z.mobility_state === 'SLOW_MOVING' ? '🟡 SLOW CROWD' : '🟢 MOVING FLOW');

      hud.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
        + '<span style="font-size:14.5px;font-weight:800;">📡 ' + esc(z.area) + '</span>'
        + '<span style="font-size:10px;font-weight:800;padding:2.5px 8px;border-radius:999px;background:' + badgeBg + ';color:' + badgeCol + ';">' + stateText + '</span>'
        + '</div>'
        + '<div style="font-size:11px;font-weight:700;background:#F1F5F9;padding:6px 8px;border-radius:8px;margin-bottom:8px;">'
        +   '<div>' + esc(z.crowd_pattern) + '</div>'
        +   '<div style="font-size:10px;color:#475569;margin-top:2px;">' + esc(z.verification_basis) + '</div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px;text-align:center;">'
        +   '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:6px;">'
        +     '<div style="font-size:14px;font-weight:800;">' + z.total_mobiles + '</div>'
        +     '<div style="font-size:9.5px;color:#64748B;font-weight:700;">Total Crowd</div>'
        +   '</div>'
        +   '<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:6px;">'
        +     '<div style="font-size:13.5px;font-weight:800;color:#DC2626;">' + z.mobiles_stuck + ' (' + z.stuck_percent + '%)</div>'
        +     '<div style="font-size:9.5px;color:#B91C1C;font-weight:700;">Static / Stuck</div>'
        +   '</div>'
        +   '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:6px;">'
        +     '<div style="font-size:13.5px;font-weight:800;color:#15803D;">' + z.mobiles_moving + ' (' + z.moving_percent + '%)</div>'
        +     '<div style="font-size:9.5px;color:#166534;font-weight:700;">Moving</div>'
        +   '</div>'
        + '</div>'
        + '<div style="height:7px;background:#22C55E;border-radius:999px;overflow:hidden;margin-bottom:6px;">'
        +   '<div style="height:100%;width:' + Math.min(100, Math.max(5, z.stuck_percent)) + '%;background:' + (isStatic ? '#7F1D1D' : '#EF4444') + ';"></div>'
        + '</div>'
        + '<div style="display:flex;justify-content:space-between;font-size:10.5px;font-weight:700;color:#475569;">'
        +   '<span>Avg Speed: ' + z.avg_speed_kmh + ' km/h</span>'
        +   '<span>+' + (z.ble_peers_count || 0) + ' BLE • +' + (z.wifi_mobile_peers_count || 0) + ' Wi-Fi • 4G ' + (z.cell_load_percent || 0) + '%</span>'
        + '</div>';
      hud.style.display = 'block';
    }

    map.on('click', function() {
      if (hud) hud.style.display = 'none';
    });

    function getCrowdTier(count) {
      const n = Number(count || 0);
      if (n >= 150) return { outer: '#7F1D1D', core: '#450A0A', outerOp: 0.40, coreOp: 0.65, weight: 1.0, rOuter: 680, rCore: 440 };
      if (n >= 100) return { outer: '#DC2626', core: '#991B1B', outerOp: 0.34, coreOp: 0.54, weight: 0.80, rOuter: 620, rCore: 400 };
      if (n >= 50)  return { outer: '#EA580C', core: '#C2410C', outerOp: 0.28, coreOp: 0.44, weight: 0.60, rOuter: 560, rCore: 360 };
      if (n >= 20)  return { outer: '#F59E0B', core: '#D97706', outerOp: 0.22, coreOp: 0.34, weight: 0.40, rOuter: 490, rCore: 320 };
      return         { outer: '#FDE68A', core: '#F59E0B', outerOp: 0.14, coreOp: 0.22, weight: 0.20, rOuter: 410, rCore: 260 };
    }

    window.updateBleMap = function(heatmaps) {
      heatGroup.clearLayers();
      markerGroup.clearLayers();
      const pts = [];

      (heatmaps || []).forEach(function(z) {
        const tier = getCrowdTier(z.total_mobiles || 1);
        const outerCol = tier.outer;
        const coreCol = tier.core;

        pts.push([z.lat, z.lon, tier.weight]);

        L.circle([z.lat, z.lon], {
          radius: tier.rOuter,
          stroke: false,
          fillColor: outerCol,
          fillOpacity: tier.outerOp,
          interactive: false
        }).addTo(heatGroup);

        const cZone = L.circle([z.lat, z.lon], {
          radius: tier.rCore,
          color: coreCol,
          weight: 1.6,
          opacity: 0.78,
          fillColor: coreCol,
          fillOpacity: tier.coreOp,
          interactive: true
        }).addTo(heatGroup);

        cZone.on('click', function(ev) {
          L.DomEvent.stopPropagation(ev);
          showHud(z);
        });

        const badgeHtml = '<div class="ble-badge" style="background:' + coreCol + ';color:' + ((z.total_mobiles || 0) >= 50 ? '#FFFFFF' : '#0F172A') + ';">'
          + '<span class="ble-pulse-dot" style="background:' + ((z.total_mobiles || 0) >= 50 ? '#FFFFFF' : '#0F172A') + ';"></span>'
          + '<span>' + esc(z.area) + ' • ' + z.total_mobiles + '</span>'
          + '</div>';

        const m = L.marker([z.lat, z.lon], {
          icon: L.divIcon({ className: '', html: badgeHtml, iconSize: [0, 0] })
        }).addTo(markerGroup);

        m.on('click', function(ev) {
          L.DomEvent.stopPropagation(ev);
          showHud(z);
        });
      });

      if (pts.length > 0 && typeof L.heatLayer === 'function') {
        L.heatLayer(pts, {
          radius: 36,
          blur: 24,
          max: 1.0,
          minOpacity: 0.16,
          maxZoom: 15,
          gradient: { 0.18: '#FDE68A', 0.38: '#F59E0B', 0.58: '#EA580C', 0.78: '#DC2626', 1.0: '#450A0A' }
        }).addTo(heatGroup);
      }
    };

    window.focusBleZone = function(lat, lon, z) {
      map.flyTo([lat, lon], 14, { duration: 0.6 });
      if (z) showHud(z);
    };
  </script>
</body>
</html>`,
    []
  );

  const pushHeatmapsToIframe = useCallback(() => {
    if (!snapshot) return;
    try {
      const win = iframeRef.current?.contentWindow as any;
      if (win && typeof win.updateBleMap === "function") {
        win.updateBleMap(snapshot.heatmaps || []);
      }
    } catch {}
  }, [snapshot]);

  useEffect(() => {
    pushHeatmapsToIframe();
  }, [pushHeatmapsToIframe]);

  const handleFocusZone = (lat: number, lon: number, area: string) => {
    const zone = snapshot?.heatmaps.find((h) => h.area === area);
    try {
      const win = iframeRef.current?.contentWindow as any;
      if (win && typeof win.focusBleZone === "function") {
        win.focusBleZone(lat, lon, zone || null);
      }
    } catch {}
  };

  const summary = snapshot?.summary || {
    active_scanner_apps: 0,
    total_ble_detected: 0,
    total_wifi_mobile_detected: 0,
    avg_cell_load_percent: 0,
    total_crowd_devices: 0,
    total_static_devices: 0,
    total_moving_devices: 0,
    active_zones_count: 0,
    static_hotspots_count: 0,
  };

  const staticPctGlobal =
    summary.total_crowd_devices > 0
      ? Math.round(
          (summary.total_static_devices / summary.total_crowd_devices) * 100
        )
      : 0;
  const movingPctGlobal =
    summary.total_crowd_devices > 0 ? 100 - staticPctGlobal : 0;

  return (
    <div className="space-y-6">
      {/* 1. Top Live Multi-Radio Crowd-Sourcing Observatory Header (Read-Only View of Active Mobile App Users) */}
      <div className="rounded-xl border border-[#2e312e] bg-[#181a18] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500" />
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#ecebe6] m-0">
                📡 Multi-Radio Proximity Crowd-Sourcing (BLE + Wi-Fi [BT Off] + 4G Cell Load) &amp; Live Mobility Heatmap
              </h2>
              <p className="text-xs text-[#9a988f] m-0">
                Live telemetry streamed from active BigWarn mobile app users scanning nearby BLE devices (40m), Wi-Fi mobile peers with Bluetooth OFF (50m), 4G cell tower congestion, and GPS velocity.
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchCrowdSnapshot}
          >
            ↻ Refresh Live Feed
          </Button>
        </div>
      </div>

      {/* 2. Top 4 BLE + Wi-Fi + 4G Crowd Telemetry KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-sky-400 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-[#9a988f] uppercase">
              📱 Open App Multi-Radio Scanners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold font-mono text-sky-400">
              {summary.active_scanner_apps}
            </div>
            <div className="text-[11px] text-[#9a988f] mt-1">
              Across <b className="text-[#ecebe6]">{summary.active_zones_count}</b>{" "}
              area(s) • 4G Load:{" "}
              <b className="text-sky-300">{summary.avg_cell_load_percent || 0}%</b>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-400 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-[#9a988f] uppercase">
              📡 Surrounding Crowd Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold font-mono text-amber-400">
              {summary.total_crowd_devices}
            </div>
            <div className="text-[11px] text-[#9a988f] mt-1">
              +<b className="text-[#ecebe6]">{summary.total_ble_detected}</b> BLE • +
              <b className="text-amber-300">
                {summary.total_wifi_mobile_detected || 0}
              </b>{" "}
              Wi-Fi (BT Off)
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-[#9a988f] uppercase">
              🔴 Static / Stuck Crowd
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold font-mono text-red-400">
              {summary.total_static_devices}{" "}
              <span className="text-sm font-normal text-[#9a988f]">
                ({staticPctGlobal}%)
              </span>
            </div>
            <div className="text-[11px] text-[#9a988f] mt-1">
              <b className="text-red-300">{summary.static_hotspots_count}</b>{" "}
              static hotspot zone(s) (&lt; 3.5 km/h)
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-[#9a988f] uppercase">
              🟢 Moving Crowd Flow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold font-mono text-emerald-400">
              {summary.total_moving_devices}{" "}
              <span className="text-sm font-normal text-[#9a988f]">
                ({movingPctGlobal}%)
              </span>
            </div>
            <div className="text-[11px] text-[#9a988f] mt-1">
              Active moving BLE peers (&ge; 3.5 km/h)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Interactive Bangladesh BLE Crowd Heatmap Map */}
      <Card className="bg-[#181a18] border-[#2e312e]">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm sm:text-base">
                🗺️ Live Bangladesh BLE Crowd Heatmap (Click Any Heatmap to Inspect Static vs. Moving Crowd)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Dark Crimson / Maroon indicates a dense STATIC crowd; Amber / Green indicates a MOVING flow.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="inline-flex items-center gap-1 rounded-full bg-red-950/80 border border-red-700/60 px-2.5 py-0.5 text-red-200">
                <span className="h-2 w-2 rounded-full bg-red-500" /> Dark Maroon = Static Crowd
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/80 border border-amber-700/60 px-2.5 py-0.5 text-amber-200">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Amber = Slow / Moving
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[420px] w-full rounded-xl overflow-hidden border border-[#2e312e]">
            <iframe
              ref={iframeRef}
              srcDoc={mapHtml}
              onLoad={pushHeatmapsToIframe}
              className="w-full h-full border-0"
              title="BigWarn BLE Crowd Heatmap"
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. Live Table: Crowd Around Opened App Users (Location, BLE Count, Static vs Moving, Crowd Pattern) */}
      <Card className="bg-[#181a18] border-[#2e312e]">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm sm:text-base">
                📋 Live BLE Crowd Telemetry Table — Crowd Around Opened App User
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Real-time breakdown of the BLE crowd detected around each opened mobile app user, their location, static vs. moving ratio, and crowd pattern. Click any row to focus the heatmap.
              </p>
            </div>
            <Badge variant="outline" className="font-mono">
              {snapshot?.scanners.length || 0} Opened App User(s)
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile Phone Card View (< md) */}
          <div className="space-y-3 md:hidden">
            {(snapshot?.scanners || []).map((sc) => {
              const isStatic = sc.mobility_state === "STATIC";
              const isSlow = sc.mobility_state === "SLOW_MOVING";
              return (
                <div
                  key={sc.device_id}
                  onClick={() => handleFocusZone(sc.lat, sc.lon, sc.area)}
                  className="cursor-pointer rounded-xl border border-[#2e312e] bg-[#121312] p-3 text-xs space-y-2 hover:border-sky-400"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-sky-400">
                      📍 {sc.area} ({sc.city})
                    </span>
                    <Badge
                      variant={
                        isStatic
                          ? "destructive"
                          : isSlow
                          ? "warning"
                          : "success"
                      }
                    >
                      {isStatic
                        ? "🔴 STATIC"
                        : isSlow
                        ? "🟡 SLOW"
                        : "🟢 MOVING"}
                    </Badge>
                  </div>

                  <div className="text-[#ecebe6] font-semibold">
                    {sc.crowd_pattern}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center font-mono pt-1">
                    <div className="rounded-lg bg-[#181a18] p-2 border border-[#2e312e]">
                      <div className="text-sm font-bold text-amber-400">
                        {sc.total_crowd_around_me}
                      </div>
                      <div className="text-[10px] text-[#9a988f]">
                        Crowd Around Opened App User
                      </div>
                    </div>
                    <div className="rounded-lg bg-red-950/30 p-2 border border-red-900/40">
                      <div className="text-sm font-bold text-red-400">
                        {sc.static_devices} ({sc.static_percent}%)
                      </div>
                      <div className="text-[10px] text-red-300">Static</div>
                    </div>
                    <div className="rounded-lg bg-emerald-950/30 p-2 border border-emerald-900/40">
                      <div className="text-sm font-bold text-emerald-400">
                        {sc.moving_devices} ({sc.moving_percent}%)
                      </div>
                      <div className="text-[10px] text-emerald-300">Moving</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-[11px] text-[#9a988f] font-mono pt-1">
                    <span>Opened App User: {sc.device_label}</span>
                    <span>
                      +{sc.ble_count} BLE • +{sc.wifi_mobile_count || 0} Wi-Fi
                    </span>
                    <span>4G Load: {sc.cell_load_percent || 0}%</span>
                    <span>Speed: {sc.speed_kmh} km/h</span>
                  </div>
                  <div className="pt-1.5 border-t border-[#2e312e]/70">
                    <DeviceModelsBreakdown
                      scanner={sc}
                      expanded={Boolean(expandedDevices[sc.device_id])}
                      onToggleExpand={() => toggleExpandedDevice(sc.device_id)}
                      maxPreview={6}
                      compact
                    />
                  </div>
                </div>
              );
            })}
            {(!snapshot?.scanners || snapshot.scanners.length === 0) && (
              <div className="p-6 text-center text-xs text-[#9a988f] rounded-xl border border-[#2e312e] bg-[#121312]">
                No opened mobile app users are currently transmitting multi-radio scans. Open the BigWarn app on an Android phone with Location, Wi-Fi &amp; Bluetooth enabled to stream the live crowd around that opened app user.
              </div>
            )}
          </div>

          {/* Desktop Table View (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#2e312e] bg-[#121312] text-[#9a988f]">
                  <th className="p-2.5">Opened App User</th>
                  <th className="p-2.5">Location</th>
                  <th className="p-2.5 text-right">Crowd</th>
                  <th className="p-2.5 text-right">Radio &amp; 4G Load</th>
                  <th className="p-2.5 min-w-[270px]">Detected Devices &amp; Filtered Noise</th>
                  <th className="p-2.5">Static vs. Moving</th>
                  <th className="p-2.5">Mobility &amp; Pattern</th>
                  <th className="p-2.5 text-right">Last Ping</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.scanners || []).map((sc) => {
                  const isStatic = sc.mobility_state === "STATIC";
                  const isSlow = sc.mobility_state === "SLOW_MOVING";
                  return (
                    <tr
                      key={sc.device_id}
                      onClick={() => handleFocusZone(sc.lat, sc.lon, sc.area)}
                      className="cursor-pointer border-b border-[#2e312e]/70 hover:bg-[#222522] align-top"
                    >
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-semibold text-[#ecebe6] flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                          {sc.device_label}
                        </div>
                        <div className="font-mono text-[10.5px] text-[#9a988f]">
                          id: {sc.device_id}
                        </div>
                      </td>

                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-bold text-sky-400">
                          📍 {sc.area}{" "}
                          <span className="text-[11px] font-normal text-[#9a988f]">
                            ({sc.city})
                          </span>
                        </div>
                        <div className="font-mono text-[10.5px] text-[#9a988f]">
                          {sc.lat.toFixed(4)}°N, {sc.lon.toFixed(4)}°E
                        </div>
                      </td>

                      <td className="p-2.5 text-right font-mono whitespace-nowrap">
                        <span className="text-sm font-extrabold text-amber-400">
                          {sc.total_crowd_around_me}
                        </span>
                        <div className="text-[10px] text-[#9a988f]">
                          peak: {sc.peak_threshold}
                        </div>
                      </td>

                      <td className="p-2.5 text-right font-mono whitespace-nowrap">
                        <div className="font-bold text-sky-300">
                          +{sc.ble_count} BLE (Phones)
                        </div>
                        <div className="text-[10.5px] font-semibold text-amber-300">
                          +{sc.wifi_mobile_count || 0} Wi-Fi
                          {(sc.wifi_p2p_count || sc.wifi_lan_count || sc.wifi_hotspot_count)
                            ? ` (P2P:${sc.wifi_p2p_count || 0} LAN:${sc.wifi_lan_count || 0} HS:${sc.wifi_hotspot_count || 0})`
                            : ""}
                        </div>
                        <div className="text-[10px] text-[#9a988f] mt-0.5">
                          {sc.cell_network_type || "4G"}: {sc.cell_load_percent || 0}% ({sc.cell_rsrp_dbm ?? -85} dBm)
                        </div>
                        <div className="text-[10px] text-[#9a988f]">
                          {sc.avg_rssi_dbm} dBm • {sc.density_per_100m2}/100m²
                        </div>
                      </td>

                      <td className="p-2.5 max-w-[380px]">
                        <DeviceModelsBreakdown
                          scanner={sc}
                          expanded={Boolean(expandedDevices[sc.device_id])}
                          onToggleExpand={() => toggleExpandedDevice(sc.device_id)}
                          maxPreview={8}
                        />
                      </td>

                      <td className="p-2.5 min-w-[165px]">
                        <div className="flex justify-between font-mono text-[11px] mb-1">
                          <span className="text-red-400 font-semibold">
                            Static: {sc.static_devices} ({sc.static_percent}%)
                          </span>
                          <span className="text-emerald-400 font-semibold">
                            Moving: {sc.moving_devices} ({sc.moving_percent}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-emerald-500/80 overflow-hidden">
                          <div
                            className="h-full bg-red-500"
                            style={{ width: `${sc.static_percent}%` }}
                          />
                        </div>
                      </td>

                      <td className="p-2.5 min-w-[180px] space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant={
                              isStatic
                                ? "destructive"
                                : isSlow
                                ? "warning"
                                : "success"
                            }
                          >
                            {isStatic
                              ? "🔴 STATIC / STUCK"
                              : isSlow
                              ? "🟡 SLOW CRAWL"
                              : "🟢 MOVING"}
                          </Badge>
                          <span className="font-mono text-[11px] font-semibold text-[#ecebe6]">
                            {sc.speed_kmh} km/h
                          </span>
                        </div>
                        <div className="font-medium text-[11.5px] text-[#ecebe6]">
                          {sc.crowd_pattern}
                        </div>
                      </td>

                      <td className="p-2.5 text-right font-mono text-[11px] text-emerald-400 whitespace-nowrap">
                        {sc.age_seconds !== undefined && sc.age_seconds <= 5
                          ? "LIVE now"
                          : `${sc.age_seconds || 0}s ago`}
                      </td>
                    </tr>
                  );
                })}
                {(!snapshot?.scanners || snapshot.scanners.length === 0) && (
                  <tr>
                    <td
                      colSpan={8}
                      className="p-8 text-center text-xs text-[#9a988f]"
                    >
                      No opened mobile app users are currently transmitting BLE scans. Open the BigWarn app on an Android phone with Bluetooth &amp; GPS enabled to stream the live BLE crowd around that opened app user.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
