export interface AlertArticle {
  headline: string;
  source: string;
  lang: string;
  url: string;
  published?: string;
  ingested_at?: string;
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
  sample_headline: string;
  articles: AlertArticle[];
  on_route?: boolean;
  route_match_reason?: string;
  distance_to_route_km?: number;
  distance_to_dest_km?: number;
  distance_to_user_km?: number;
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

export interface RouteAlertResponse {
  date: string;
  layers: LakehouseLayerStats;
  route: {
    cur_lat: number;
    cur_lon: number;
    dest_lat: number;
    dest_lon: number;
    todo: string;
    corridor_radius_km: number;
    route_distance_km: number;
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
  layers: LakehouseLayerStats;
  total_alerts: number;
  alerts: GoldAlert[];
}

export interface Coordinates {
  lat: number;
  lon: number;
  label?: string;
}
