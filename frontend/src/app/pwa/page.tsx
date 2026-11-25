"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LocateFixed, MapPin, RefreshCw, Share, ShieldCheck, X } from "lucide-react";

interface PwaAlert {
  cluster_id: string;
  area: string;
  city: string;
  lat: number;
  lon: number;
  event_type: string;
  severity: string;
  color: string;
  veracity_percent: number;
  veracity_status: string;
  sample_headline: string;
  affected_road?: string;
  last_updated?: string;
  is_recent_3h: boolean;
  on_route?: boolean;
  distance_to_route_km?: number;
}

interface PwaHeatmap {
  area: string;
  city: string;
  lat: number;
  lon: number;
  total_mobiles: number;
  mobiles_stuck: number;
  mobiles_moving: number;
  stuck_percent: number;
  avg_speed_kmh: number;
  mobility_state: string;
  crowd_pattern: string;
  heat_intensity: number;
}

interface PwaPayload {
  route_risk_level: string;
  route?: {
    polyline?: number[][];
    alt_polyline?: number[][];
    route_distance_km?: number;
    duration_min?: number;
    danger_segments?: any[];
  } | null;
  route_alerts: PwaAlert[];
  map_alerts: PwaAlert[];
  heatmaps: PwaHeatmap[];
}

const PRESET_DESTS: Record<string, { lat: number; lon: number; label: string }> = {
  Motijheel: { lat: 23.733, lon: 90.4172, label: "Motijheel" },
  "Mirpur-10": { lat: 23.8069, lon: 90.3687, label: "Mirpur-10" },
  Shahbagh: { lat: 23.7389, lon: 90.3955, label: "Shahbagh" },
  Uttara: { lat: 23.8759, lon: 90.3795, label: "Uttara" },
  Gulshan: { lat: 23.7925, lon: 90.4078, label: "Gulshan" },
  Farmgate: { lat: 23.7561, lon: 90.3872, label: "Farmgate" },
  Dhanmondi: { lat: 23.7461, lon: 90.3742, label: "Dhanmondi" },
};

export default function PwaMobileAppPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number }>({
    lat: 23.7461,
    lon: 90.3742,
  });
  const [dest, setDest] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [data, setData] = useState<PwaPayload | null>(null);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showIosInstallTip, setShowIosInstallTip] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent || "";
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const isStandalone = Boolean((window.navigator as any).standalone);
    if (isIos && !isStandalone) {
      setShowIosInstallTip(true);
    }
  }, []);

  const fetchPwaData = useCallback(async () => {
    setRefreshing(true);
    try {
      const qs = new URLSearchParams();
      if (dest) {
        qs.set("cur_lat", String(userLoc.lat));
        qs.set("cur_lon", String(userLoc.lon));
        qs.set("dest_lat", String(dest.lat));
        qs.set("dest_lon", String(dest.lon));
        qs.set("todo", dest.label);
      }
      const res = await fetch(`/api/pwa/alerts?${qs.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const json: PwaPayload = await res.json();
        setData(json);
      }
    } catch {
    } finally {
      setRefreshing(false);
    }
  }, [userLoc.lat, userLoc.lon, dest]);

  useEffect(() => {
    fetchPwaData();
    const timer = setInterval(fetchPwaData, 8000);
    return () => clearInterval(timer);
  }, [fetchPwaData]);

  const handleLocateMe = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setUserLoc({ lat, lon });
        try {
          (iframeRef.current?.contentWindow as any)?.focusLocation?.(lat, lon, 14);
        } catch {}
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  useEffect(() => {
    handleLocateMe();
  }, [handleLocateMe]);

  const mapHtml = useMemo(
    () => `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #F8F9FA; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .user-dot { width: 14px; height: 14px; border-radius: 50%; background: #1A73E8; border: 3px solid #FFF; box-shadow: 0 0 10px rgba(26,115,232,0.7); transform: translate(-50%, -50%); }
    .area-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; color: #FFF; font-size: 11px; font-weight: 800; border: 2px solid #FFF; box-shadow: 0 2px 6px rgba(0,0,0,0.28); transform: translate(-50%, -50%); white-space: nowrap; }
    #hud { position: fixed; left: 12px; right: 12px; bottom: 14px; background: rgba(255,255,255,0.97); border: 1.5px solid #CBD5E1; border-radius: 14px; padding: 10px 12px; box-shadow: 0 10px 24px rgba(15,23,42,0.2); z-index: 999; display: none; font-size: 12px; color: #0F172A; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="hud"></div>
  <script>
    const map = L.map('map', { zoomControl: false }).setView([23.78, 90.39], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(map);
    const routeGroup = L.featureGroup().addTo(map);
    const heatGroup = L.featureGroup().addTo(map);
    const markerGroup = L.featureGroup().addTo(map);
    const hud = document.getElementById('hud');
    let userMarker = null;
    let destMarker = null;
    let currentPinMode = false;
    let routeReqId = 0;

    function esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function getCrowdTier(count) {
      const n = Number(count || 0);
      if (n >= 150) return { outer: '#7F1D1D', core: '#450A0A', op: 0.45, w: 1.0 };
      if (n >= 100) return { outer: '#DC2626', core: '#991B1B', op: 0.36, w: 0.8 };
      if (n >= 50)  return { outer: '#EA580C', core: '#C2410C', op: 0.28, w: 0.6 };
      if (n >= 20)  return { outer: '#F59E0B', core: '#D97706', op: 0.22, w: 0.4 };
      return         { outer: '#FDE68A', core: '#F59E0B', op: 0.14, w: 0.2 };
    }

    window.__unpin = function() {
      window.parent.postMessage({ type: 'unpin' }, '*');
    };

    window.__selectArea = function(area) {
      window.parent.postMessage({ type: 'selectArea', area: area }, '*');
    };

    map.on('click', function(e) {
      if (hud) hud.style.display = 'none';
      if (currentPinMode) {
        window.parent.postMessage({ type: 'dropPin', lat: e.latlng.lat, lon: e.latlng.lng }, '*');
      }
    });

    window.focusLocation = function(lat, lon, zoom) {
      map.flyTo([lat, lon], zoom || 14, { duration: 0.6 });
    };

    window.updatePwaMap = function(state) {
      currentPinMode = Boolean(state.pinMode);
      const u = state.userLoc;
      if (userMarker) userMarker.setLatLng([u.lat, u.lon]);
      else userMarker = L.marker([u.lat, u.lon], { icon: L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [0,0] }) }).addTo(map);

      if (!state.dest) {
        if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
        routeReqId++;
        routeGroup.clearLayers();
      } else {
        const label = esc(state.dest.label);
        if (destMarker) map.removeLayer(destMarker);
        const pinHtml = '<div style="transform:translate(-50%,-100%);text-align:center;">'
          + '<div style="background:#111827;color:#FFF;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:800;white-space:nowrap;margin-bottom:2px;">' + label + '</div>'
          + '<div style="width:16px;height:16px;border-radius:50%;background:#EA4335;border:3px solid #FFF;margin:0 auto;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div></div>';
        destMarker = L.marker([state.dest.lat, state.dest.lon], { icon: L.divIcon({ className: '', html: pinHtml, iconSize: [0,0] }) }).addTo(map);
        destMarker.bindPopup('<div style="text-align:center;"><div style="font-weight:800;margin-bottom:6px;">' + label + '</div><button onclick="window.__unpin()" style="border:none;background:#DC2626;color:#FFF;border-radius:7px;padding:5px 10px;font-weight:700;cursor:pointer;">✕ Remove Pin</button></div>');

        routeGroup.clearLayers();
        const poly = state.route && state.route.polyline && state.route.polyline.length >= 2
          ? state.route.polyline
          : [[u.lat, u.lon], [state.dest.lat, state.dest.lon]];
        L.polyline(poly, { color: '#2563EB', weight: 5.5, opacity: 0.9 }).addTo(routeGroup);
        (state.route && state.route.danger_segments || []).forEach(function(seg) {
          if (seg.coords && seg.coords.length >= 2) {
            L.polyline(seg.coords, { color: '#EF4444', weight: 7, opacity: 0.95 }).addTo(routeGroup);
          }
        });
      }

      heatGroup.clearLayers();
      const pts = [];
      (state.heatmaps || []).forEach(function(z) {
        const tier = getCrowdTier(z.total_mobiles);
        pts.push([z.lat, z.lon, tier.w]);
        const c = L.circle([z.lat, z.lon], { radius: 420, color: tier.core, weight: 1.5, fillColor: tier.outer, fillOpacity: tier.op }).addTo(heatGroup);
        c.on('click', function(ev) {
          L.DomEvent.stopPropagation(ev);
          hud.innerHTML = '<div style="display:flex;justify-content:space-between;font-weight:800;margin-bottom:4px;"><span>📡 ' + esc(z.area) + '</span><span>' + z.total_mobiles + ' devices</span></div>'
            + '<div style="font-size:11px;color:#475569;">Static: ' + z.mobiles_stuck + ' (' + z.stuck_percent + '%) • Moving: ' + z.mobiles_moving + ' • Avg: ' + z.avg_speed_kmh + ' km/h</div>';
          hud.style.display = 'block';
        });
      });
      if (pts.length > 0 && typeof L.heatLayer === 'function') {
        L.heatLayer(pts, { radius: 34, blur: 22, max: 1.0 }).addTo(heatGroup);
      }

      markerGroup.clearLayers();
      (state.alerts || []).forEach(function(a) {
        const bg = a.on_route ? '#DC2626' : (a.color || '#EA580C');
        const m = L.marker([a.lat, a.lon], {
          icon: L.divIcon({ className: '', html: '<div class="area-pill" style="background:' + bg + ';">' + esc(a.area) + '</div>', iconSize: [0,0] })
        }).addTo(markerGroup);
        m.on('click', function(ev) {
          L.DomEvent.stopPropagation(ev);
          window.__selectArea(a.area);
        });
      });
    };
  </script>
</body>
</html>`,
    []
  );

  const pushState = useCallback(() => {
    try {
      (iframeRef.current?.contentWindow as any)?.updatePwaMap?.({
        userLoc,
        dest,
        pinMode,
        route: data?.route || null,
        heatmaps: data?.heatmaps || [],
        alerts: data?.map_alerts || [],
      });
    } catch {}
  }, [userLoc, dest, pinMode, data]);

  useEffect(() => {
    pushState();
  }, [pushState]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data;
      if (!m || typeof m !== "object") return;
      if (m.type === "dropPin" && typeof m.lat === "number") {
        setDest({
          lat: m.lat,
          lon: m.lon,
          label: `Pinned (${m.lat.toFixed(3)}, ${m.lon.toFixed(3)})`,
        });
        setPinMode(false);
      } else if (m.type === "unpin") {
        setDest(null);
        setPinMode(false);
      } else if (m.type === "selectArea" && typeof m.area === "string") {
        setSelectedArea(m.area);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const selectedAlerts = (data?.map_alerts || []).filter((a) => a.area === selectedArea);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-slate-100 text-slate-900">
      <iframe
        ref={iframeRef}
        srcDoc={mapHtml}
        onLoad={pushState}
        className="h-full w-full border-0"
        title="BigWarn iOS PWA Map"
      />

      {/* Top Controls Card */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 mx-auto max-w-xl space-y-2">
        <div className="pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <span className="font-extrabold text-sm text-slate-900">BigWarn iOS PWA</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={fetchPwaData}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                <span>Sync</span>
              </button>
              <Link
                href="/"
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" />
                <span>App Portal</span>
              </Link>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select
              value={dest && PRESET_DESTS[dest.label] ? dest.label : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  setDest(null);
                  return;
                }
                setDest(PRESET_DESTS[v] || null);
                setPinMode(false);
              }}
              className="flex-1 min-w-[140px] rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800"
            >
              <option value="">No destination pinned (Radar view)</option>
              {Object.keys(PRESET_DESTS).map((name) => (
                <option key={name} value={name}>
                  Route to: {name}
                </option>
              ))}
            </select>

            <button
              onClick={() => setPinMode((p) => !p)}
              className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold ${
                pinMode
                  ? "border-blue-700 bg-blue-600 text-white"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>{pinMode ? "Cancel" : "Pin"}</span>
            </button>

            {dest && !pinMode && (
              <button
                onClick={() => setDest(null)}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700"
              >
                <X className="h-3.5 w-3.5" />
                <span>Unpin</span>
              </button>
            )}
          </div>

          {pinMode && (
            <div className="mt-2 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
              Tap anywhere on the map to drop your destination pin.
            </div>
          )}

          {dest && !pinMode && (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold">
              <span>
                Route Status:{" "}
                <b
                  className={
                    data?.route_risk_level === "BLOCKED"
                      ? "text-red-600"
                      : data?.route_risk_level === "CLEAR"
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }
                >
                  {data?.route_risk_level || "CLEAR"}
                </b>
                {data?.route?.route_distance_km ? ` • ${data.route.route_distance_km} km` : ""}
              </span>
              <span className="text-[11px] text-slate-500">
                {(data?.route_alerts || []).length} route alert(s)
              </span>
            </div>
          )}
        </div>

        {showIosInstallTip && (
          <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-xl border border-sky-300 bg-sky-50/95 px-3 py-2 text-xs text-sky-900 shadow">
            <div className="flex items-center gap-2">
              <Share className="h-4 w-4 text-sky-600 shrink-0" />
              <span>
                Install on iPhone: tap <b>Share (↑)</b> &rarr; <b>Add to Home Screen</b>
              </span>
            </div>
            <button onClick={() => setShowIosInstallTip(false)} className="text-sky-700 p-0.5">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom Right Locate Button */}
      <button
        onClick={handleLocateMe}
        className="absolute bottom-6 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-blue-600 shadow-lg"
        title="Center on my location"
      >
        <LocateFixed className="h-5 w-5" />
      </button>

      {/* Area Alert Modal */}
      {selectedArea && (
        <div className="absolute inset-x-3 bottom-4 z-30 mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-extrabold text-sm text-slate-900">📍 {selectedArea} Alerts</h3>
            <button
              onClick={() => setSelectedArea(null)}
              className="rounded-lg bg-slate-100 p-1 text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-52 space-y-2 overflow-y-auto text-xs">
            {selectedAlerts.length === 0 ? (
              <p className="text-slate-500">No active hazards reported here.</p>
            ) : (
              selectedAlerts.map((a) => (
                <div key={a.cluster_id} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span className="uppercase">{a.event_type}</span>
                    <span className="text-emerald-700">{a.veracity_percent}% verified</span>
                  </div>
                  <p className="mt-1 text-slate-700 font-medium">{a.sample_headline}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
