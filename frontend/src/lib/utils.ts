import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { NewsArticle } from "@/types/news";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeVal(ts?: string | null): number {
  if (!ts) return 0;
  const t = Date.parse(ts);
  return isNaN(t) ? 0 : t;
}

export function lagMinutes(item: NewsArticle): number | null {
  const pub = timeVal(item.published || item.updated);
  const ing = timeVal(item.ingested_at);
  if (!pub || !ing) return null;
  return Math.round((ing - pub) / 60000);
}

export function fmtTime(iso?: string | null, curDay?: string | null): string {
  if (!iso) return "";
  if (iso.length < 16) return iso;
  const d = iso.slice(0, 10);
  const t = iso.slice(11, 16);
  return d && curDay && d !== curDay ? `${d.slice(5)} ${t}` : t;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

