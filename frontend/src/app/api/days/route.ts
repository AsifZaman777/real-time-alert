import { NextRequest, NextResponse } from "next/server";
import { listAvailableDays } from "@/lib/server-stream";
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
  const remote = await fetchFromRemoteBackend("/api/v1/days");
  if (remote) return NextResponse.json(remote);
  return NextResponse.json(listAvailableDays());
}
