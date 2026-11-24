import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { fetchFromRemoteBackend, getRemoteBackendUrl } from "@/lib/proxy-backend";
import { AREA_COORDS } from "@/lib/server-stream";

export const dynamic = "force-dynamic";

interface LocalBleScannerRecord {
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
  wifi_mobile_count: number;
  wifi_ap_count: number;
  cell_rsrp_dbm: number;
  cell_rsrq_db: number;
  cell_load_percent: number;
  total_crowd_around_me: number;
  static_devices: number;
  moving_devices: number;
  static_percent: number;
  moving_percent: number;
  mobility_state: "STATIC" | "SLOW_MOVING" | "MOVING";
  crowd_pattern: string;
  avg_rssi_dbm: number;
  scan_radius_m: number;
  density_per_100m2: number;
  peak_threshold: number;
  exceeds_peak: boolean;
  ts: number;
  last_ping_iso: string;
  age_seconds?: number;
}

const MAJOR_HUBS = new Set([
  "Mirpur-10", "Motijheel", "Farmgate", "Shahbagh", "Gulistan",
  "New Market", "Karwan Bazar", "Jatrabari", "Mohakhali", "Uttara",
  "Paltan", "Chattogram", "Sadarghat", "Old Dhaka", "Gabtoli",
  "Sayedabad", "Science Lab", "Malibagh", "Rampura", "Badda",
  "Mohammadpur", "Dhanmondi", "Banani", "Gulshan", "Gazipur",
  "Narayanganj", "Sylhet", "Rajshahi", "Khulna", "Cumilla",
]);

function getLocalStoragePath(): string {
  const root = path.resolve(process.cwd(), "..");
  return path.join(
    root,
    "backend",
    "lakehouse",
    "storage",
    "gold",
    "verified_ble_crowd_pings.json"
  );
}

function loadLocalScanners(): Record<string, LocalBleScannerRecord> {
  const p = getLocalStoragePath();
  const nowS = Date.now() / 1000;
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      const valid: Record<string, LocalBleScannerRecord> = {};
      for (const [k, v] of Object.entries(raw || {})) {
        const rec = v as LocalBleScannerRecord;
        // Strict 30-second live TTL & reject legacy synthetic "BLE_5.0 + 4G" ghost rows
        if (
          rec &&
          nowS - (rec.ts || 0) <= 30 &&
          rec.network_type !== "BLE_5.0 + 4G"
        ) {
          valid[k] = rec;
        }
      }
      return valid;
    }
  } catch {}
  return {};
}

function saveLocalScanners(map: Record<string, LocalBleScannerRecord>): void {
  const p = getLocalStoragePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf-8");
  } catch {}
}

function snapArea(lat: number, lon: number): { area: string; city: string } {
  let bestArea = "Mirpur-10";
  let bestCity = "Dhaka";
  let bestD = 999999;
  for (const [area, meta] of Object.entries(AREA_COORDS)) {
    const d = Math.hypot(lat - meta.lat, lon - meta.lon) * 111.32;
    if (d < bestD) {
      bestD = d;
      bestArea = area;
      bestCity = meta.city || "Dhaka";
    }
  }
  if (bestD <= 20) return { area: bestArea, city: bestCity };
  return {
    area: `BD Sector (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`,
    city: "Bangladesh",
  };
}

function classifyPattern(
  totalCrowd: number,
  staticPct: number,
  speedKmh: number,
  peakThreshold: number,
  cellLoadPercent: number = 0
): { mobility_state: "STATIC" | "SLOW_MOVING" | "MOVING"; crowd_pattern: string } {
  const isDense = totalCrowd >= peakThreshold || cellLoadPercent >= 65;
  const isVeryDense =
    totalCrowd >= Math.round(peakThreshold * 1.45) || cellLoadPercent >= 82;
  if (staticPct >= 68 || speedKmh < 3.5) {
    return {
      mobility_state: "STATIC",
      crowd_pattern: isVeryDense
        ? "Dense Static Gathering / Standstill Blockade"
        : isDense
        ? "High-Density Static Crowd / Bottleneck"
        : totalCrowd >= 15 || cellLoadPercent >= 45
        ? "Stationary Commuter Cluster / Queue"
        : "Localized Static Presence",
    };
  }
  if (staticPct >= 42 || speedKmh < 10.0) {
    return {
      mobility_state: "SLOW_MOVING",
      crowd_pattern: isDense
        ? "Slow-Moving Crowd Surge / Procession"
        : "Slow Crawling Traffic Corridor",
    };
  }
  return {
    mobility_state: "MOVING",
    crowd_pattern: isDense
      ? "High-Volume Moving Transit Flow"
      : "Normal Free-Flowing Movement",
  };
}

function recordLocalPing(params: {
  device_id?: string;
  device_label?: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  accuracy_m?: number;
  ble_count: number;
  ble_static_count?: number;
  ble_moving_count?: number;
  wifi_mobile_count?: number;
  wifi_ap_count?: number;
  wifi_static_count?: number;
  wifi_moving_count?: number;
  cell_rsrp_dbm?: number;
  cell_rsrq_db?: number;
  cell_load_percent?: number;
  avg_rssi_dbm?: number;
  scan_radius_m?: number;
  network_type?: string;
}) {
  const { area, city } = snapArea(params.lat, params.lon);
  const isMajor = MAJOR_HUBS.has(area);
  const peakThreshold = isMajor ? 45 : 25;
  const cleanId =
    (params.device_id || "").trim() ||
    `ble-node-${area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const isLegacy = params.network_type === "BLE_5.0 + 4G";
  const bleCount = isLegacy ? 0 : Math.max(0, Math.round(params.ble_count || 0));
  const wifiMobileCount = isLegacy
    ? 0
    : Math.max(0, Math.round(params.wifi_mobile_count || 0));
  const wifiApCount = isLegacy
    ? 0
    : Math.max(0, Math.round(params.wifi_ap_count || 0));
  const cellRsrpDbm = Math.round(params.cell_rsrp_dbm ?? -85);
  const cellRsrqDb = Math.round(params.cell_rsrq_db ?? -9);
  const cellLoadPercent = Math.max(
    0,
    Math.min(100, Math.round(params.cell_load_percent || 0))
  );
  const speed = Math.max(0, Math.round((params.speed_kmh || 0) * 10) / 10);

  const selfStatic = speed < 3.5 ? 1 : 0;
  const bleStatic =
    typeof params.ble_static_count === "number"
      ? Math.max(0, Math.round(params.ble_static_count))
      : speed < 3.5
      ? bleCount
      : Math.round(bleCount * 0.35);
  const bleMoving = Math.max(0, bleCount - bleStatic);

  const wifiStatic =
    typeof params.wifi_static_count === "number"
      ? Math.max(0, Math.round(params.wifi_static_count))
      : speed < 3.5
      ? wifiMobileCount
      : Math.round(wifiMobileCount * 0.35);
  const wifiMoving = Math.max(0, wifiMobileCount - wifiStatic);

  const staticDevices = selfStatic + bleStatic + wifiStatic;
  const movingDevices = 1 - selfStatic + bleMoving + wifiMoving;

  const totalAroundMe = Math.max(1, staticDevices + movingDevices);
  const staticPct = Math.round((staticDevices / totalAroundMe) * 100);
  const movingPct = 100 - staticPct;
  const { mobility_state, crowd_pattern } = classifyPattern(
    totalAroundMe,
    staticPct,
    speed,
    peakThreshold,
    cellLoadPercent
  );
  const radiusM = params.scan_radius_m || 50;
  const density =
    Math.round(((totalAroundMe / (Math.PI * radiusM * radiusM)) * 100) * 100) /
    100;
  const nowS = Date.now() / 1000;
  const nowIso = new Date(Date.now() + 6 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+06:00");

  const rec: LocalBleScannerRecord = {
    device_id: cleanId,
    device_label: params.device_label || `App Scanner (${cleanId.slice(-6)})`,
    area,
    city,
    lat: Number(params.lat.toFixed(6)),
    lon: Number(params.lon.toFixed(6)),
    speed_kmh: speed,
    accuracy_m: params.accuracy_m || 18,
    network_type: params.network_type || "NATIVE_MULTI_RADIO",
    ble_count: bleCount,
    wifi_mobile_count: wifiMobileCount,
    wifi_ap_count: wifiApCount,
    cell_rsrp_dbm: cellRsrpDbm,
    cell_rsrq_db: cellRsrqDb,
    cell_load_percent: cellLoadPercent,
    total_crowd_around_me: totalAroundMe,
    static_devices: staticDevices,
    moving_devices: movingDevices,
    static_percent: staticPct,
    moving_percent: movingPct,
    mobility_state,
    crowd_pattern,
    avg_rssi_dbm: params.avg_rssi_dbm || -64,
    scan_radius_m: radiusM,
    density_per_100m2: density,
    peak_threshold: peakThreshold,
    exceeds_peak: totalAroundMe >= peakThreshold,
    ts: nowS,
    last_ping_iso: nowIso,
  };

  const store = loadLocalScanners();
  store[cleanId] = rec;
  saveLocalScanners(store);
  return rec;
}

function buildLocalSnapshot() {
  const store = loadLocalScanners();
  const nowS = Date.now() / 1000;
  const scanners = Object.values(store)
    .map((s) => ({
      ...s,
      age_seconds: Math.max(0, Math.round(nowS - s.ts)),
    }))
    .sort((a, b) => b.ts - a.ts);

  const byArea = new Map<string, LocalBleScannerRecord[]>();
  scanners.forEach((sc) => {
    const list = byArea.get(sc.area) || [];
    list.push(sc);
    byArea.set(sc.area, list);
  });

  const heatmaps = Array.from(byArea.entries()).map(([area, nodes]) => {
    const avgLat = nodes.reduce((s, n) => s + n.lat, 0) / nodes.length;
    const avgLon = nodes.reduce((s, n) => s + n.lon, 0) / nodes.length;
    const scannerCount = nodes.length;
    const maxBle = Math.max(...nodes.map((n) => n.ble_count || 0), 0);
    const maxWifiMobile = Math.max(
      ...nodes.map((n) => n.wifi_mobile_count || 0),
      0
    );
    const maxWifiAp = Math.max(...nodes.map((n) => n.wifi_ap_count || 0), 0);
    const avgCellLoad = Math.round(
      nodes.reduce((s, n) => s + (n.cell_load_percent || 0), 0) / nodes.length
    );
    const avgRsrq = Math.round(
      nodes.reduce((s, n) => s + (n.cell_rsrq_db || -9), 0) / nodes.length
    );
    const avgRsrp = Math.round(
      nodes.reduce((s, n) => s + (n.cell_rsrp_dbm || -85), 0) / nodes.length
    );
    const totalMobiles = Math.max(
      scannerCount,
      scannerCount + maxBle + maxWifiMobile
    );
    const rawStatic = nodes.reduce((s, n) => s + n.static_devices, 0);
    const rawTotal = Math.max(
      1,
      nodes.reduce((s, n) => s + n.total_crowd_around_me, 0)
    );
    const stuckPct = Math.round((rawStatic / rawTotal) * 100);
    const movingPct = 100 - stuckPct;
    const mobilesStuck = Math.round((totalMobiles * stuckPct) / 100);
    const mobilesMoving = Math.max(0, totalMobiles - mobilesStuck);
    const avgSpeed =
      Math.round(
        (nodes.reduce((s, n) => s + n.speed_kmh, 0) / nodes.length) * 10
      ) / 10;
    const avgRssi = Math.round(
      nodes.reduce((s, n) => s + n.avg_rssi_dbm, 0) / nodes.length
    );
    const peakThreshold = MAJOR_HUBS.has(area) ? 45 : 25;
    const { mobility_state, crowd_pattern } = classifyPattern(
      totalMobiles,
      stuckPct,
      avgSpeed,
      peakThreshold,
      avgCellLoad
    );
    const exceedsPeak =
      totalMobiles >= peakThreshold || avgCellLoad >= 65;
    const excessRatio = Math.max(
      0,
      (totalMobiles - peakThreshold) / peakThreshold
    );
    const heatIntensity = Math.min(
      1.0,
      Math.round(
        (0.42 +
          Math.min(0.38, (totalMobiles / peakThreshold) * 0.28) +
          (stuckPct / 100) * 0.24 +
          (avgCellLoad / 100) * 0.14 +
          excessRatio * 0.22) *
          100
      ) / 100
    );

    return {
      area,
      city: nodes[0].city,
      lat: Number(avgLat.toFixed(6)),
      lon: Number(avgLon.toFixed(6)),
      is_verified: true,
      verification_basis: `Multi-Radio Scan (${scannerCount} app user${
        scannerCount !== 1 ? "s" : ""
      } • +${maxBle} BLE • +${maxWifiMobile} Wi-Fi [BT Off] • 4G Load ${avgCellLoad}%)`,
      scanner_nodes_count: scannerCount,
      ble_peers_count: maxBle,
      wifi_mobile_peers_count: maxWifiMobile,
      wifi_fixed_ap_count: maxWifiAp,
      cell_load_percent: avgCellLoad,
      cell_rsrq_db: avgRsrq,
      cell_rsrp_dbm: avgRsrp,
      total_mobiles: totalMobiles,
      mobiles_stuck: mobilesStuck,
      mobiles_moving: mobilesMoving,
      stuck_percent: stuckPct,
      moving_percent: movingPct,
      avg_speed_kmh: avgSpeed,
      mobility_state,
      crowd_pattern,
      avg_rssi_dbm: avgRssi,
      density_per_100m2: Math.max(...nodes.map((n) => n.density_per_100m2)),
      peak_threshold: peakThreshold,
      exceeds_peak: exceedsPeak,
      heat_intensity: heatIntensity,
      intensity_label: `${mobility_state} (${totalMobiles} Devices)`,
      last_ping_iso: nodes[0].last_ping_iso,
    };
  });

  return {
    status: "ok",
    updated_at: new Date().toISOString(),
    summary: {
      active_scanner_apps: scanners.length,
      total_ble_detected: heatmaps.reduce((s, h) => s + h.ble_peers_count, 0),
      total_wifi_mobile_detected: heatmaps.reduce(
        (s, h) => s + (h.wifi_mobile_peers_count || 0),
        0
      ),
      avg_cell_load_percent:
        heatmaps.length > 0
          ? Math.round(
              heatmaps.reduce((s, h) => s + (h.cell_load_percent || 0), 0) /
                heatmaps.length
            )
          : 0,
      total_crowd_devices: heatmaps.reduce((s, h) => s + h.total_mobiles, 0),
      total_static_devices: heatmaps.reduce((s, h) => s + h.mobiles_stuck, 0),
      total_moving_devices: heatmaps.reduce((s, h) => s + h.mobiles_moving, 0),
      active_zones_count: heatmaps.length,
      static_hotspots_count: heatmaps.filter(
        (h) => h.mobility_state === "STATIC"
      ).length,
    },
    scanners,
    heatmaps,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("action") === "ping") {
    const lat = Number(searchParams.get("lat") || 23.8069);
    const lon = Number(searchParams.get("lon") || 90.3687);
    const speed_kmh = Number(searchParams.get("speed_kmh") || 0.0);
    const ble_count = Number(searchParams.get("ble_count") || 0);
    const wifi_mobile_count = Number(
      searchParams.get("wifi_mobile_count") || 0
    );
    const wifi_ap_count = Number(searchParams.get("wifi_ap_count") || 0);
    const cell_load_percent = Number(
      searchParams.get("cell_load_percent") || 0
    );
    const device_id = searchParams.get("device_id") || undefined;
    const device_label = searchParams.get("device_label") || undefined;
    recordLocalPing({
      device_id,
      device_label,
      lat,
      lon,
      speed_kmh,
      ble_count,
      wifi_mobile_count,
      wifi_ap_count,
      cell_load_percent,
    });
    await fetchFromRemoteBackend(
      `/api/v1/crowd/ping?${searchParams.toString()}`
    );
  }

  const remote = await fetchFromRemoteBackend("/api/v1/crowd/heatmap");
  const local = buildLocalSnapshot();

  if (remote && Array.isArray(remote.heatmaps)) {
    // Filter out any legacy synthetic "BLE_5.0 + 4G" or stale (> 30s) ghost records from an un-updated remote server
    const cleanRemoteScanners = (remote.scanners || []).filter((s: any) => {
      const age = typeof s.age_seconds === "number" ? s.age_seconds : 0;
      const isLegacySynthetic = s.network_type === "BLE_5.0 + 4G";
      return age <= 30 && !isLegacySynthetic;
    });

    const mergedScannersMap = new Map<string, any>();
    cleanRemoteScanners.forEach((s: any) =>
      mergedScannersMap.set(s.device_id, s)
    );
    local.scanners.forEach((s) => {
      if (!mergedScannersMap.has(s.device_id)) {
        mergedScannersMap.set(s.device_id, s);
      }
    });

    const rawScanners = Array.from(mergedScannersMap.values());
    // Cross-detect nearby opened BigWarn phones within 50m of each other & fuse BLE + Wi-Fi (BT-Off) peers
    const scanners = rawScanners.map((sc: any) => {
      let nearbyOpenAppsStatic = 0;
      let nearbyOpenAppsMoving = 0;
      rawScanners.forEach((other: any) => {
        if (other.device_id === sc.device_id) return;
        const dKm =
          Math.hypot(sc.lat - other.lat, sc.lon - other.lon) * 111.32;
        if (dKm <= 0.05) {
          if ((other.speed_kmh || 0) < 3.5) nearbyOpenAppsStatic += 1;
          else nearbyOpenAppsMoving += 1;
        }
      });
      const hwBle = sc.ble_count || 0;
      const hwWifiMobile = sc.wifi_mobile_count || 0;
      const nearbyApps = nearbyOpenAppsStatic + nearbyOpenAppsMoving;
      const extraOpenApps = Math.max(0, nearbyApps - hwBle);
      const selfStatic = (sc.speed_kmh || 0) < 3.5 ? 1 : 0;
      const hwStatic = Math.max(
        0,
        (sc.static_devices || 1) - selfStatic
      );
      const hwMoving = Math.max(
        0,
        hwBle + hwWifiMobile - hwStatic
      );
      const staticDevs =
        selfStatic +
        hwStatic +
        (extraOpenApps > 0 ? nearbyOpenAppsStatic : 0);
      const movingDevs =
        1 -
        selfStatic +
        hwMoving +
        (extraOpenApps > 0 ? nearbyOpenAppsMoving : 0);
      const totalAround = Math.max(1, staticDevs + movingDevs);
      const staticPct = Math.round((staticDevs / totalAround) * 100);
      return {
        ...sc,
        ble_count: Math.max(hwBle, nearbyApps),
        bt_classic_count: sc.bt_classic_count || 0,
        wifi_mobile_count: hwWifiMobile,
        wifi_hotspot_count: sc.wifi_hotspot_count || 0,
        wifi_p2p_count: sc.wifi_p2p_count || 0,
        wifi_lan_count: sc.wifi_lan_count || 0,
        wifi_ap_count: sc.wifi_ap_count || 0,
        cell_rsrp_dbm: sc.cell_rsrp_dbm ?? -85,
        cell_rsrq_db: sc.cell_rsrq_db ?? -9,
        cell_load_percent: sc.cell_load_percent || 0,
        cell_tower_count: sc.cell_tower_count || 0,
        cell_network_type: sc.cell_network_type || "4G_LTE",
        total_crowd_around_me: totalAround,
        static_devices: staticDevs,
        moving_devices: movingDevs,
        static_percent: staticPct,
        moving_percent: 100 - staticPct,
      };
    });

    // Rebuild area heatmaps strictly from active non-legacy scanners
    const byArea = new Map<string, any[]>();
    scanners.forEach((sc: any) => {
      const list = byArea.get(sc.area) || [];
      list.push(sc);
      byArea.set(sc.area, list);
    });
    const heatmaps = Array.from(byArea.entries()).map(([area, nodes]) => {
      const avgLat = nodes.reduce((s, n) => s + n.lat, 0) / nodes.length;
      const avgLon = nodes.reduce((s, n) => s + n.lon, 0) / nodes.length;
      const scannerCount = nodes.length;
      const maxBle = Math.max(...nodes.map((n) => n.ble_count || 0), 0);
      const maxWifiMobile = Math.max(
        ...nodes.map((n) => n.wifi_mobile_count || 0),
        0
      );
      const maxWifiHs = Math.max(
        ...nodes.map((n) => n.wifi_hotspot_count || 0),
        0
      );
      const maxWifiP2p = Math.max(
        ...nodes.map((n) => n.wifi_p2p_count || 0),
        0
      );
      const maxWifiLan = Math.max(
        ...nodes.map((n) => n.wifi_lan_count || 0),
        0
      );
      const maxWifiAp = Math.max(...nodes.map((n) => n.wifi_ap_count || 0), 0);
      const cellNetType = nodes[0].cell_network_type || "4G_LTE";
      const avgCellLoad = Math.round(
        nodes.reduce((s, n) => s + (n.cell_load_percent || 0), 0) / nodes.length
      );
      const avgRsrq = Math.round(
        nodes.reduce((s, n) => s + (n.cell_rsrq_db ?? -9), 0) / nodes.length
      );
      const avgRsrp = Math.round(
        nodes.reduce((s, n) => s + (n.cell_rsrp_dbm ?? -85), 0) / nodes.length
      );
      const totalMobiles = Math.max(
        scannerCount,
        scannerCount + maxBle + maxWifiMobile
      );
      const rawStatic = nodes.reduce((s, n) => s + (n.static_devices || 0), 0);
      const rawTotal = Math.max(
        1,
        nodes.reduce((s, n) => s + (n.total_crowd_around_me || 1), 0)
      );
      const stuckPct = Math.round((rawStatic / rawTotal) * 100);
      const mobilesStuck = Math.round((totalMobiles * stuckPct) / 100);
      const mobilesMoving = Math.max(0, totalMobiles - mobilesStuck);
      const avgSpeed =
        Math.round(
          (nodes.reduce((s, n) => s + (n.speed_kmh || 0), 0) / nodes.length) *
            10
        ) / 10;
      const peakThreshold = MAJOR_HUBS.has(area) ? 45 : 25;
      const { mobility_state, crowd_pattern } = classifyPattern(
        totalMobiles,
        stuckPct,
        avgSpeed,
        peakThreshold,
        avgCellLoad
      );
      return {
        area,
        city: nodes[0].city || "Dhaka",
        lat: Number(avgLat.toFixed(6)),
        lon: Number(avgLon.toFixed(6)),
        is_verified: true,
        verification_basis: `Multi-Radio Scan (${scannerCount} opened app user${
          scannerCount !== 1 ? "s" : ""
        } • +${maxBle} BLE • +${maxWifiMobile} Wi-Fi [BT Off] • 4G Load ${avgCellLoad}%)`,
        scanner_nodes_count: scannerCount,
        ble_peers_count: maxBle,
        wifi_mobile_count: maxWifiMobile,
        wifi_mobile_peers_count: maxWifiMobile,
        wifi_hotspot_count: maxWifiHs,
        wifi_p2p_count: maxWifiP2p,
        wifi_lan_count: maxWifiLan,
        wifi_fixed_ap_count: maxWifiAp,
        cell_load_percent: avgCellLoad,
        cell_rsrq_db: avgRsrq,
        cell_rsrp_dbm: avgRsrp,
        cell_network_type: cellNetType,
        total_mobiles: totalMobiles,
        mobiles_stuck: mobilesStuck,
        mobiles_moving: mobilesMoving,
        stuck_percent: stuckPct,
        moving_percent: 100 - stuckPct,
        avg_speed_kmh: avgSpeed,
        mobility_state,
        crowd_pattern,
        avg_rssi_dbm: nodes[0].avg_rssi_dbm || -70,
        density_per_100m2: nodes[0].density_per_100m2 || 0.04,
        peak_threshold: peakThreshold,
        exceeds_peak: totalMobiles >= peakThreshold || avgCellLoad >= 65,
        heat_intensity: mobility_state === "STATIC" ? 0.78 : 0.55,
        intensity_label: `${mobility_state} (${totalMobiles} Devices)`,
      };
    });

    return NextResponse.json({
      status: "ok",
      updated_at: remote.updated_at || local.updated_at,
      summary: {
        active_scanner_apps: scanners.length,
        total_ble_detected: heatmaps.reduce(
          (s, h) => s + (h.ble_peers_count || 0),
          0
        ),
        total_wifi_mobile_detected: heatmaps.reduce(
          (s, h) => s + (h.wifi_mobile_peers_count || 0),
          0
        ),
        avg_cell_load_percent:
          heatmaps.length > 0
            ? Math.round(
                heatmaps.reduce((s, h) => s + (h.cell_load_percent || 0), 0) /
                  heatmaps.length
              )
            : 0,
        total_crowd_devices: heatmaps.reduce(
          (s, h) => s + (h.total_mobiles || 0),
          0
        ),
        total_static_devices: heatmaps.reduce(
          (s, h) => s + (h.mobiles_stuck || 0),
          0
        ),
        total_moving_devices: heatmaps.reduce(
          (s, h) => s + (h.mobiles_moving || 0),
          0
        ),
        active_zones_count: heatmaps.length,
        static_hotspots_count: heatmaps.filter(
          (h) => h.mobility_state === "STATIC"
        ).length,
      },
      scanners,
      heatmaps,
    });
  }

  return NextResponse.json(local);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rec = recordLocalPing({
      device_id: body.device_id,
      device_label: body.device_label,
      lat: Number(body.lat || 23.8069),
      lon: Number(body.lon || 90.3687),
      speed_kmh: Number(body.speed_kmh ?? 0.0),
      accuracy_m: Number(body.accuracy_m || 18),
      ble_count: Number(body.ble_count ?? 0),
      ble_static_count:
        typeof body.ble_static_count === "number"
          ? body.ble_static_count
          : undefined,
      ble_moving_count:
        typeof body.ble_moving_count === "number"
          ? body.ble_moving_count
          : undefined,
      wifi_mobile_count: Number(body.wifi_mobile_count ?? 0),
      wifi_ap_count: Number(body.wifi_ap_count ?? 0),
      wifi_static_count:
        typeof body.wifi_static_count === "number"
          ? body.wifi_static_count
          : undefined,
      wifi_moving_count:
        typeof body.wifi_moving_count === "number"
          ? body.wifi_moving_count
          : undefined,
      cell_rsrp_dbm: Number(body.cell_rsrp_dbm ?? -85),
      cell_rsrq_db: Number(body.cell_rsrq_db ?? -9),
      cell_load_percent: Number(body.cell_load_percent ?? 0),
      avg_rssi_dbm: Number(body.avg_rssi_dbm || -64),
      scan_radius_m: Number(body.scan_radius_m || 50),
      network_type: body.network_type || "NATIVE_MULTI_RADIO",
    });

    const base = getRemoteBackendUrl();
    if (base) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = (process.env.BIGWARN_FEED_TOKEN || "").trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      fetch(`${base}/api/v1/crowd/ping`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }).catch(() => {});
    }

    return NextResponse.json({
      status: "ok",
      verified: true,
      scanner: rec,
      snapshot: buildLocalSnapshot(),
    });
  } catch {
    return NextResponse.json(
      { status: "error", verified: false },
      { status: 400 }
    );
  }
}
