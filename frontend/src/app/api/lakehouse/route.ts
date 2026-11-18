import { NextRequest, NextResponse } from "next/server";
import { buildLakehouseSnapshot, todayDhaka } from "@/lib/server-stream";
import { fetchFromRemoteBackend } from "@/lib/proxy-backend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || searchParams.get("day") || todayDhaka();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse("bad date", { status: 400 });
  }
  const remote = await fetchFromRemoteBackend(`/api/v1/lakehouse?date=${date}`);
  if (remote) return NextResponse.json(remote);
  return NextResponse.json(buildLakehouseSnapshot(date));
}
