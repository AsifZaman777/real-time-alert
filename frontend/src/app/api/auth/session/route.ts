import { NextRequest, NextResponse } from "next/server";
import {
  getAdminSessionFromRequest,
  isAdminAuthConfigured,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = getAdminSessionFromRequest(req);
  return NextResponse.json(
    {
      authenticated: Boolean(session),
      configured: isAdminAuthConfigured(),
      adminId: session?.adminId || null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
