import { NextRequest, NextResponse } from "next/server";
import { readDayItems, todayDhaka } from "@/lib/server-stream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || todayDhaka();
  const after = Math.max(0, parseInt(searchParams.get("after") || "0", 10) || 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse("bad date", { status: 400 });
  }
  return NextResponse.json(readDayItems(date, after));
}

