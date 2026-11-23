import fs from "fs";
import path from "path";

export function hasLocalStreamFiles(): boolean {
  const root = path.resolve(process.cwd(), "..");
  const dir = path.join(root, "backend", "data", "logs");
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => /^news_stream_\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
}

export function getRemoteBackendUrl(): string | null {
  const envUrl = (
    process.env.BIGWARN_FEED_URL ||
    process.env.BIGWARN_API_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  return envUrl || null;
}

export async function fetchFromRemoteBackend(endpointPath: string): Promise<any | null> {
  const base = getRemoteBackendUrl();
  if (!base) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const headers: Record<string, string> = {};
    const token = (process.env.BIGWARN_FEED_TOKEN || "").trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${base}${endpointPath}`, {
      cache: "no-store",
      signal: controller.signal,
      headers,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
