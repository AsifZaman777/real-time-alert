import { NextRequest, NextResponse } from "next/server";
import { fetchFromRemoteBackend } from "@/lib/proxy-backend";
import { buildLakehouseSnapshot, todayDhaka } from "@/lib/server-stream";

export const dynamic = "force-dynamic";

function sanitizeAlertCluster(a: any) {
  return {
    cluster_id: String(a?.cluster_id || ""),
    area: String(a?.area || ""),
    city: String(a?.city || ""),
    lat: Number(a?.lat || 0),
    lon: Number(a?.lon || 0),
    event_type: String(a?.event_type || ""),
    severity: String(a?.severity || "MODERATE"),
    color: String(a?.color || "#EA580C"),
    veracity_percent: Number(a?.veracity_percent || 0),
    veracity_status: String(a?.veracity_status || ""),
    sample_headline: String(a?.sample_headline || ""),
    affected_road: a?.affected_road ? String(a.affected_road) : undefined,
    last_updated: a?.last_updated ? String(a.last_updated) : undefined,
    is_recent_3h: Boolean(a?.is_recent_3h ?? (Number(a?.age_minutes ?? 999) <= 180)),
    on_route: Boolean(a?.on_route),
    distance_to_route_km:
      typeof a?.distance_to_route_km === "number" ? a.distance_to_route_km : undefined,
  };
}

function sanitizeHeatmap(h: any) {
  return {
    area: String(h?.area || ""),
    city: String(h?.city || ""),
    lat: Number(h?.lat || 0),
    lon: Number(h?.lon || 0),
    total_mobiles: Number(h?.total_mobiles || 0),
    mobiles_stuck: Number(h?.mobiles_stuck || 0),
    mobiles_moving: Number(h?.mobiles_moving || 0),
    stuck_percent: Number(h?.stuck_percent || 0),
    avg_speed_kmh: Number(h?.avg_speed_kmh || 0),
    mobility_state: String(h?.mobility_state || "STATIC"),
    crowd_pattern: String(h?.crowd_pattern || ""),
    heat_intensity: Number(h?.heat_intensity || 0.2),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const curLat = searchParams.get("cur_lat");
  const curLon = searchParams.get("cur_lon");
  const destLat = searchParams.get("dest_lat");
  const destLon = searchParams.get("dest_lon");
  const todo = searchParams.get("todo") || "";
  const hasRoute = Boolean(curLat && curLon && destLat && destLon);

  const [alertPayload, heatPayload] = await Promise.all([
    hasRoute
      ? fetchFromRemoteBackend(
          `/api/v1/alerts/route?date=latest&cur_lat=${encodeURIComponent(
            curLat!
          )}&cur_lon=${encodeURIComponent(curLon!)}&dest_lat=${encodeURIComponent(
            destLat!
          )}&dest_lon=${encodeURIComponent(
            destLon!
          )}&todo=${encodeURIComponent(todo)}&radius_km=2.5&include_map=1`
        )
      : fetchFromRemoteBackend("/api/v1/alerts/map?date=latest"),
    fetchFromRemoteBackend("/api/v1/crowd/heatmap"),
  ]);

  let mapAlertsRaw: any[] = [];
  let routeAlertsRaw: any[] = [];
  let routeRisk = "CLEAR";
  let routeGeometry: any = null;

  if (alertPayload) {
    mapAlertsRaw = Array.isArray(alertPayload.map_alerts)
      ? alertPayload.map_alerts
      : Array.isArray(alertPayload.alerts)
      ? alertPayload.alerts
      : [];
    routeAlertsRaw = Array.isArray(alertPayload.route_alerts)
      ? alertPayload.route_alerts
      : [];
    routeRisk = String(alertPayload.route_risk_level || "CLEAR");
    routeGeometry = alertPayload.route
      ? {
          polyline: alertPayload.route.polyline || [],
          alt_polyline: alertPayload.route.alt_polyline || [],
          route_distance_km: alertPayload.route.route_distance_km || 0,
          duration_min: alertPayload.route.duration_min || 0,
          danger_segments: (alertPayload.route.danger_segments || []).map((d: any) => ({
            area: String(d?.area || ""),
            road_name: String(d?.road_name || ""),
            event_type: String(d?.event_type || ""),
            headline: String(d?.headline || ""),
            tooltip_lat: Number(d?.tooltip_lat || 0),
            tooltip_lon: Number(d?.tooltip_lon || 0),
            event_lat: Number(d?.event_lat || 0),
            event_lon: Number(d?.event_lon || 0),
            coords: Array.isArray(d?.coords) ? d.coords : [],
          })),
        }
      : null;
  } else {
    const snap = buildLakehouseSnapshot(todayDhaka());
    mapAlertsRaw = snap.gold_alerts || [];
  }

  const heatmaps = Array.isArray(heatPayload?.heatmaps)
    ? heatPayload.heatmaps.map(sanitizeHeatmap)
    : [];

  return NextResponse.json(
    {
      status: "ok",
      route_risk_level: routeRisk,
      route: routeGeometry,
      route_alerts: routeAlertsRaw.map(sanitizeAlertCluster),
      map_alerts: mapAlertsRaw.map(sanitizeAlertCluster),
      heatmaps,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
