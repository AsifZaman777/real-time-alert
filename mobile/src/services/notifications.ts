import { GoldAlert } from "../types/alert";

const EVENT_LABELS: Record<string, string> = {
  gunfire: "Firing / Bomb Blast",
  murder: "Murder / Violent Crime",
  blockade: "Road Blockade",
  strike: "Strike / Hartal",
  clash: "Violent Clash",
  fire: "Fire / Arson",
  procession: "Protest March",
  accident: "Road Accident",
  waterlogging: "Waterlogging",
  power_outage: "Power Outage",
};

export function formatEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] || eventType.replace(/_/g, " ").toUpperCase();
}

export function formatNewsTimestamp(
  published?: string | null,
  ingestedAt?: string | null
): string {
  const raw = published || ingestedAt;
  if (!raw) return "Unknown time";
  try {
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return raw;

    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const day = dt.getDate();
    const mon = months[dt.getMonth()];
    const year = dt.getFullYear();

    let hours = dt.getHours();
    const mins = String(dt.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;

    const diffMin = Math.round((Date.now() - dt.getTime()) / 60000);
    let rel = "";
    if (diffMin >= 0 && diffMin < 60) {
      rel = diffMin <= 1 ? " • Just now" : ` • ${diffMin}m ago`;
    } else if (diffMin >= 60 && diffMin < 1440) {
      rel = ` • ${Math.floor(diffMin / 60)}h ago`;
    }

    return `${day} ${mon} ${year}, ${hours}:${mins} ${ampm}${rel}`;
  } catch {
    return raw;
  }
}

export function buildRouteAnomalyMessage(alert: GoldAlert): {
  title: string;
  body: string;
} {
  const label = formatEventLabel(alert.event_type);
  const distText =
    typeof alert.distance_to_route_km === "number"
      ? `${alert.distance_to_route_km} km from your route`
      : "along your route";

  return {
    title: `Route Alert: ${label}`,
    body: `${label} near ${alert.area} (${distText}) • ${alert.veracity_summary} (${alert.veracity_percent}%)`,
  };
}
