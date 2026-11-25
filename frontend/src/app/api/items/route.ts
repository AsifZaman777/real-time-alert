import { NextRequest, NextResponse } from "next/server";
import { readDayItems, todayDhaka } from "@/lib/server-stream";
import { fetchFromRemoteBackend } from "@/lib/proxy-backend";
import {
  getAdminSessionFromRequest,
  unauthorizedAdminResponse,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!getAdminSessionFromRequest(req)) {
    return unauthorizedAdminResponse();
  }
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || searchParams.get("day") || todayDhaka();
  const after = Math.max(0, parseInt(searchParams.get("after") || "0", 10) || 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse("bad date", { status: 400 });
  }
  const remote = await fetchFromRemoteBackend(`/api/v1/items?date=${date}&after=${after}`);
  if (remote) return NextResponse.json(remote);
  return NextResponse.json(readDayItems(date, after));
}
