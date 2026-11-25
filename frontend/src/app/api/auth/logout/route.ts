import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.json(
    { ok: true, authenticated: false },
    { headers: { "Cache-Control": "no-store" } }
  );
  clearSessionCookie(res, req);
  return res;
}
