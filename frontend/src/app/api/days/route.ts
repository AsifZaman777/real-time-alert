import { NextResponse } from "next/server";
import { listAvailableDays } from "@/lib/server-stream";
import { fetchFromRemoteBackend } from "@/lib/proxy-backend";

export const dynamic = "force-dynamic";

export async function GET() {
  const remote = await fetchFromRemoteBackend("/api/v1/days");
  if (remote) return NextResponse.json(remote);
  return NextResponse.json(listAvailableDays());
}
