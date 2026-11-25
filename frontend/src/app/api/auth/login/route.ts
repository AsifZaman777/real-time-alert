import { NextRequest, NextResponse } from "next/server";
import {
  attachSessionCookie,
  createSessionToken,
  getConfiguredAdminId,
  isAdminAuthConfigured,
  verifyAdminCredentials,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Admin login is not configured yet. Set BIGWARN_ADMIN_ID and BIGWARN_ADMIN_PASSWORD in Vercel Environment Variables.",
      },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!id || !password || !verifyAdminCredentials(id, password)) {
      return NextResponse.json(
        { ok: false, error: "Invalid Admin ID or Password." },
        { status: 401 }
      );
    }

    const adminId = getConfiguredAdminId();
    const token = createSessionToken(adminId);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Session signing failed." },
        { status: 500 }
      );
    }

    const res = NextResponse.json(
      { ok: true, authenticated: true, adminId },
      { headers: { "Cache-Control": "no-store" } }
    );
    attachSessionCookie(res, token, req);
    return res;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid login payload." },
      { status: 400 }
    );
  }
}
