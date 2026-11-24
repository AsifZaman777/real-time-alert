import { NextRequest, NextResponse } from "next/server";
import { buildLakehouseSnapshot, todayDhaka } from "@/lib/server-stream";
import { fetchFromRemoteBackend } from "@/lib/proxy-backend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || searchParams.get("day") || todayDhaka();
  if (date !== "latest" && date !== "48h" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse("bad date", { status: 400 });
  }

  const [remoteDay, remoteLatest, archiveStatus] = await Promise.all([
    fetchFromRemoteBackend(`/api/v1/lakehouse?date=${date}`),
    date === "latest"
      ? Promise.resolve(null)
      : fetchFromRemoteBackend("/api/v1/lakehouse?date=latest"),
    fetchFromRemoteBackend("/api/v1/archive/status"),
  ]);

  const basePayload = remoteDay || buildLakehouseSnapshot(date === "latest" || date === "48h" ? todayDhaka() : date);
  const fullWindow = remoteDay && date === "latest" ? remoteDay : remoteLatest;

  return NextResponse.json({
    ...basePayload,
    cloud_lakehouse: basePayload.cloud_lakehouse || fullWindow?.cloud_lakehouse,
    rolling_48h_window: fullWindow?.window || basePayload.window,
    rolling_48h_layers: fullWindow?.layers || basePayload.layers,
    rolling_48h_gold_alerts: fullWindow?.gold_alerts || basePayload.gold_alerts,
    archive_status: archiveStatus || undefined,
  });
}
