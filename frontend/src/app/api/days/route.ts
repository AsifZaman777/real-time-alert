import { NextResponse } from "next/server";
import { listAvailableDays } from "@/lib/server-stream";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listAvailableDays());
}

