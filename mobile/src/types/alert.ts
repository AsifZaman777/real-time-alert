export interface AlertArticle {
  headline: string;
  source: string;
  lang: string;
  url: string;
  published?: string;
  ingested_at?: string;
}

export interface CrowdMetrics {
  is_verified?: boolean;
  verification_basis?: string;
  verified_gps_devices?: number;
  verified_news_sources?: number;
  verified_articles?: number;
  total_mobiles?: number;
  peak_threshold?: number;
  exceeds_peak?: boolean;
  mobiles_stuck?: number;
  mobiles_moving?: number;
  stuck_percent?: number;
  moving_percent?: number;
  avg_speed_kmh?: number;
  heat_intensity?: number;
  intensity_label?: string;
  heat_points?: number[][];
}

export interface VerifiedHeatmapZone extends CrowdMetrics {
  area: string;
  city?: string;
  lat: number;
  lon: number;
  scanner_nodes_count?: number;
  ble_peers_count?: number;
  mobility_state?: "STATIC" | "SLOW_MOVING" | "MOVING" | string;
  crowd_pattern?: string;
  avg_rssi_dbm?: number;
  density_per_100m2?: number;
  cluster_count?: number;
  sources?: string[];
  has_news?: boolean;
}

export interface GoldAlert {
  cluster_id: string;
  date: string;
  area: string;
  city: string;
  lat: number;
  lon: number;
  event_type: string;
  severity: "CRITICAL" | "HIGH" | "MODERATE";
  color: string;
  credibility_score: number;
  veracity_percent: number;
  veracity_tier: "HIGH" | "MEDIUM" | "LOW";
  veracity_status: string;
  veracity_summary: string;
  source_count: number;
  sources: string[];
  languages: string[];
  time_windows: string[];
  first_reported?: string;
  last_updated?: string;
  age_minutes?: number;
  is_recent_3h?: boolean;
  is_pre_news_crowd?: boolean;
  alert_origin?: "PRE_NEWS_CROWD" | "NEWS_AND_CROWD" | string;
  crowd_metrics?: CrowdMetrics;
  sample_headline: string;
  articles: AlertArticle[];
  on_route?: boolean;
  route_match_reason?: string;
  affected_road?: string;
  avoid_Wait_advice?: string;
  distance_to_route_km?: number;
  distance_to_dest_km?: number;
  distance_to_user_km?: number;
  road_snap_lat?: number;
  road_snap_lon?: number;
  danger_road_coords?: number[][];
}

export interface DangerRoadSegment {
  cluster_id: string;
  area: string;
  road_name: string;
  event_type: string;
  severity: string;
  color: string;
  headline: string;
  veracity_percent: number;
  veracity_summary: string;
  tooltip_lat: number;
  tooltip_lon: number;
  event_lat?: number;
  event_lon?: number;
  coords: number[][];
}

export interface LakehouseLayerStats {
  bronze: {
    record_count: number;
    sources_active: number;
  };
  silver: {
    record_count: number;
    deduplicated_count: number;
  };
  gold: {
    alert_clusters: number;
    confirmed_multi_source: number;
  };
}

export interface CitySummary {
  city: string;
  alert_count: number;
  lat: number;
  lon: number;
}

export interface RouteAlertResponse {
  date: string;
  city_filter?: string;
  available_cities?: CitySummary[];
  layers: LakehouseLayerStats;
  route: {
    cur_lat: number;
    cur_lon: number;
    dest_lat: number;
    dest_lon: number;
    todo: string;
    corridor_radius_km: number;
    route_distance_km: number;
    duration_min?: number;
    road_names?: string[];
    polyline?: number[][];
    alt_polyline?: number[][];
    alt_distance_km?: number | null;
    alt_duration_min?: number | null;
    danger_segments?: DangerRoadSegment[];
  };
  route_risk_level: "BLOCKED" | "HIGH_RISK" | "CAUTION" | "CLEAR";
  route_alert_count: number;
  total_city_alerts: number;
  suppressed_count: number;
  route_alerts: GoldAlert[];
  map_alerts?: GoldAlert[];
}

export interface MapAlertResponse {
  date: string;
  city_filter?: string;
  available_cities?: CitySummary[];
  layers: LakehouseLayerStats;
  total_alerts: number;
  alerts: GoldAlert[];
}

export interface Coordinates {
  lat: number;
  lon: number;
  label?: string;
}
