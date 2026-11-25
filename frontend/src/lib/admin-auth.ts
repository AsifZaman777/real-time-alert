import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const ADMIN_COOKIE_NAME = "bigwarn_admin_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AdminSession {
  adminId: string;
  expiresAtMs: number;
}

function safeEqualText(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function getConfiguredAdminId(): string {
  return (process.env.BIGWARN_ADMIN_ID || "admin").trim();
}

export function getConfiguredAdminPassword(): string {
  return (process.env.BIGWARN_ADMIN_PASSWORD || "").trim();
}

export function isAdminAuthConfigured(): boolean {
  return getConfiguredAdminPassword().length > 0;
}

function getSigningSecret(): string | null {
  const pw = getConfiguredAdminPassword();
  if (!pw) return null;
  const custom = (process.env.BIGWARN_AUTH_SECRET || "").trim();
  const base = custom || `${getConfiguredAdminId()}::${pw}::bigwarn-session-key`;
  return crypto.createHash("sha256").update(base, "utf8").digest("hex");
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

export function verifyAdminCredentials(id: string, password: string): boolean {
  if (!isAdminAuthConfigured()) return false;
  const expectedId = getConfiguredAdminId();
  const expectedPw = getConfiguredAdminPassword();
  return safeEqualText(id.trim(), expectedId) && safeEqualText(password, expectedPw);
}

export function createSessionToken(adminId: string): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
  const encodedPayload = Buffer.from(JSON.stringify({ sub: adminId, exp }), "utf8").toString(
    "base64url"
  );
  const sig = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${sig}`;
}

export function verifySessionToken(token?: string | null): AdminSession | null {
  if (!token || typeof token !== "string") return null;
  const secret = getSigningSecret();
  if (!secret) return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return null;
  const encodedPayload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encodedPayload || !sig) return null;

  const expectedSig = signPayload(encodedPayload, secret);
  if (!safeEqualText(sig, expectedSig)) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as { sub?: string; exp?: number };
    if (
      typeof decoded.sub !== "string" ||
      typeof decoded.exp !== "number" ||
      decoded.exp <= Date.now()
    ) {
      return null;
    }
    if (!safeEqualText(decoded.sub, getConfiguredAdminId())) return null;
    return { adminId: decoded.sub, expiresAtMs: decoded.exp };
  } catch {
    return null;
  }
}

export function getAdminSessionFromRequest(req: NextRequest): AdminSession | null {
  const raw = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  return verifySessionToken(raw);
}

export function getAdminSessionFromCookies(): AdminSession | null {
  try {
    const raw = cookies().get(ADMIN_COOKIE_NAME)?.value;
    return verifySessionToken(raw);
  } catch {
    return null;
  }
}

export function hasValidFeedBearerToken(req: NextRequest): boolean {
  const expected = (process.env.BIGWARN_FEED_TOKEN || "").trim();
  if (!expected) return false;
  const auth = (req.headers.get("authorization") || "").trim();
  if (!auth.startsWith("Bearer ")) return false;
  return safeEqualText(auth.slice(7).trim(), expected);
}

export function isHttpsRequest(req: NextRequest): boolean {
  const proto = (req.headers.get("x-forwarded-proto") || "").toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  return req.nextUrl.protocol === "https:";
}

export function attachSessionCookie(
  res: NextResponse,
  token: string,
  req?: NextRequest
): void {
  const secure = req ? isHttpsRequest(req) : process.env.NODE_ENV === "production";
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse, req?: NextRequest): void {
  const secure = req ? isHttpsRequest(req) : process.env.NODE_ENV === "production";
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
}

export function unauthorizedAdminResponse() {
  return NextResponse.json(
    { error: "admin_authentication_required" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}
