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
  peakThreshold: number
): { mobility_state: "STATIC" | "SLOW_MOVING" | "MOVING"; crowd_pattern: string } {
  const isDense = totalCrowd >= peakThreshold;
  const isVeryDense = totalCrowd >= Math.round(peakThreshold * 1.45);
  if (staticPct >= 68 || speedKmh < 3.5) {
    return {
      mobility_state: "STATIC",
      crowd_pattern: isVeryDense
        ? "Dense Static Gathering / Standstill Blockade"
        : isDense
        ? "High-Density Static Crowd / Bottleneck"
        : totalCrowd >= 15
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
  const bleCount = Math.max(0, Math.round(params.ble_count || 0));
  const speed = Math.max(0, Math.round((params.speed_kmh || 0) * 10) / 10);

  let staticDevices: number;
  let movingDevices: number;
  if (
    typeof params.ble_static_count === "number" &&
    typeof params.ble_moving_count === "number"
  ) {
    const selfStatic = speed < 3.5 ? 1 : 0;
    staticDevices = selfStatic + Math.max(0, Math.round(params.ble_static_count));
    movingDevices =
      1 - selfStatic + Math.max(0, Math.round(params.ble_moving_count));
  } else {
    const ratio = speed < 3.5 ? 0.82 : speed < 10 ? 0.54 : 0.22;
    const total = 1 + bleCount;
    staticDevices = Math.round(total * ratio);
    movingDevices = Math.max(0, total - staticDevices);
  }

  const totalAroundMe = Math.max(1, staticDevices + movingDevices);
  const staticPct = Math.round((staticDevices / totalAroundMe) * 100);
  const movingPct = 100 - staticPct;
  const { mobility_state, crowd_pattern } = classifyPattern(
    totalAroundMe,
    staticPct,
    speed,
    peakThreshold
  );
  const radiusM = params.scan_radius_m || 40;
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
    network_type: params.network_type || "BLE_5.0 + 4G",
    ble_count: bleCount,
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
    const rawBle = nodes.reduce((s, n) => s + n.ble_count, 0);
    const dedupBle =
      scannerCount === 1 ? rawBle : Math.round(rawBle * 0.75);
    const totalMobiles = scannerCount + dedupBle;
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
      peakThreshold
    );
    const exceedsPeak = totalMobiles >= peakThreshold;
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
      verification_basis: `BLE Proximity Scan (${scannerCount} active app user${
        scannerCount !== 1 ? "s" : ""
      } • ${dedupBle} nearby BLE devices)`,
      scanner_nodes_count: scannerCount,
      ble_peers_count: dedupBle,
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
      intensity_label: `${mobility_state} (${totalMobiles} BLE)`,
      last_ping_iso: nodes[0].last_ping_iso,
    };
  });

  return {
    status: "ok",
    updated_at: new Date().toISOString(),
    summary: {
      active_scanner_apps: scanners.length,
      total_ble_detected: heatmaps.reduce((s, h) => s + h.ble_peers_count, 0),
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
    const speed_kmh = Number(searchParams.get("speed_kmh") || 0.8);
    const ble_count = Number(searchParams.get("ble_count") || 38);
    const device_id = searchParams.get("device_id") || undefined;
    const device_label = searchParams.get("device_label") || undefined;
    recordLocalPing({ device_id, device_label, lat, lon, speed_kmh, ble_count });
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
    // Cross-detect nearby opened BigWarn phones within 50m of each other
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
      const totalBlePeers = Math.max(
        hwBle,
        nearbyOpenAppsStatic + nearbyOpenAppsMoving
      );
      const selfStatic = (sc.speed_kmh || 0) < 3.5 ? 1 : 0;
      const staticDevs = selfStatic + Math.max(0, totalBlePeers - nearbyOpenAppsMoving);
      const movingDevs = (1 - selfStatic) + nearbyOpenAppsMoving;
      const totalAround = Math.max(1, staticDevs + movingDevs);
      const staticPct = Math.round((staticDevs / totalAround) * 100);
      return {
        ...sc,
        ble_count: totalBlePeers,
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
      const totalMobiles = Math.max(scannerCount, 1 + maxBle);
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
        peakThreshold
      );
      return {
        area,
        city: nodes[0].city || "Dhaka",
        lat: Number(avgLat.toFixed(6)),
        lon: Number(avgLon.toFixed(6)),
        is_verified: true,
        verification_basis: `BLE Proximity Scan (${scannerCount} opened app user${
          scannerCount !== 1 ? "s" : ""
        })`,
        scanner_nodes_count: scannerCount,
        ble_peers_count: Math.max(0, totalMobiles - scannerCount),
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
        exceeds_peak: totalMobiles >= peakThreshold,
        heat_intensity: mobility_state === "STATIC" ? 0.78 : 0.55,
        intensity_label: `${mobility_state} (${totalMobiles} BLE)`,
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
      speed_kmh: Number(body.speed_kmh ?? 0.8),
      accuracy_m: Number(body.accuracy_m || 18),
      ble_count: Number(body.ble_count ?? 38),
      ble_static_count:
        typeof body.ble_static_count === "number"
          ? body.ble_static_count
          : undefined,
      ble_moving_count:
        typeof body.ble_moving_count === "number"
          ? body.ble_moving_count
          : undefined,
      avg_rssi_dbm: Number(body.avg_rssi_dbm || -64),
      scan_radius_m: Number(body.scan_radius_m || 40),
      network_type: body.network_type || "BLE_5.0 + 4G",
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
