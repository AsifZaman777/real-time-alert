export type DisruptionEventType =
  | "blockade"
  | "strike"
  | "procession"
  | "clash"
  | "fire"
  | "waterlogging"
  | "accident"
  | "power_outage";

export interface NewsArticle {
  event?: string;
  ingested_at: string;
  crawled_at?: string;
  source: string;
  site_key?: string;
  lang?: "en" | "bn";
  language?: "en" | "bn" | string;
  url: string;
  headline: string;
  title?: string;
  description: string;
  body_preview?: string;
  body?: string;
  body_text?: string;
  word_count?: number;
  keywords?: string[];
  author?: string;
  section?: string;
  published: string | null;
  published_at?: string | null;
  published_at_raw?: string | null;
  lag_minutes?: number | null;
  updated?: string | null;
  duplicate_of?: string | null;
  is_disruption?: boolean;
  disruption_detected?: boolean;
  event_types?: DisruptionEventType[];
  disruption_tags?: string[];
  locations?: string[];
  time_windows?: string[];
  _seq?: number;
}

export interface ConfiguredSource {
  key: string;
  name: string;
  lang: "en" | "bn";
  home: string;
  host: string;
  feeds: string[];
  seeds_count: number;
}

export interface DebugPayload {
  date: string;
  log_lines: string[];
  seen_stats: Record<string, Record<string, number>>;
  configured_sources?: ConfiguredSource[];
}

export interface CrowdMetrics {
  gathering_size: number;
  baseline_size: number;
  surge_ratio: number;
  avg_speed_kmh: number;
  gathering_radius_m: number;
  citizen_reports: number;
  confirm_votes: number;
  clear_votes: number;
  crowd_weight_bonus: number;
  crowd_weight_percent: number;
  pre_news_lead_minutes: number;
  crowd_status: string;
  is_pre_news_crowd: boolean;
}

export interface GoldAlertCluster {
  cluster_id: string;
  date: string;
  area: string;
  city: string;
  lat: number;
  lon: number;
  event_type: DisruptionEventType | string;
  credibility_score: number;
  veracity_status: string;
  source_count: number;
  sources: string[];
  languages: string[];
  time_windows: string[];
  first_reported: string | null;
  last_updated: string | null;
  is_pre_news_crowd?: boolean;
  crowd_metrics?: CrowdMetrics;
  sample_headline: string;
  articles: Array<{
    headline: string;
    source: string;
    lang: string;
    url: string;
    published: string | null;
    ingested_at: string;
  }>;
}

export interface LakehouseSnapshot {
  date: string;
  layers: {
    bronze: {
      table: string;
      format: string;
      record_count: number;
      total_words: number;
      sources_active: number;
    };
    silver: {
      table: string;
      format: string;
      record_count: number;
      deduplicated_count: number;
    };
    gold: {
      table: string;
      format: string;
      alert_clusters: number;
      confirmed_multi_source: number;
    };
  };
  gold_alerts: GoldAlertCluster[];
  area_metadata: Record<string, { lat: number; lon: number; city: string }>;
}

export interface EdgeTodoItem {
  id: string;
  title: string;
  destinationArea: string;
  viaAreas: string[];
  plannedTime: string;
  active: boolean;
}

export interface EdgeUserProfile {
  homeArea: string;
  currentArea: string;
  radiusKm: number;
  watchedEvents: DisruptionEventType[];
  todos: EdgeTodoItem[];
}

