"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  ArrowRight,
  Compass,
  Download,
  Lock,
  LogOut,
  MapPin,
  Share,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

interface PublicAppPortalProps {
  authConfigured: boolean;
  isAuthenticated: boolean;
  adminId?: string | null;
}

type DetectedPlatform = "android" | "ios" | "other";

export function PublicAppPortal({
  authConfigured,
  isAuthenticated,
  adminId,
}: PublicAppPortalProps) {
  const router = useRouter();
  const [platform, setPlatform] = useState<DetectedPlatform>("other");
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [loginId, setLoginId] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const iosStoreUrl = (process.env.NEXT_PUBLIC_IOS_DOWNLOAD_URL || "").trim();

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) {
      setPlatform("ios");
    } else if (/Android/i.test(ua)) {
      setPlatform("android");
    } else {
      setPlatform("other");
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: loginId, password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(data.error || "Sign in failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setLoginError("Network error while signing in.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen bg-[#121312] text-[#ecebe6]">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
        {/* Top Bar with Admin Login / Console Shortcut */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/icon.svg"
              alt="BigWarn Icon"
              className="h-9 w-9 rounded-xl border border-[#2e312e] shadow"
            />
            <div>
              <div className="font-bold text-sm sm:text-base text-[#ecebe6] leading-tight">
                BigWarn Edge
              </div>
              <div className="text-[11px] text-[#9a988f]">
                Bangladesh Real-Time Road Disruption &amp; Safe Routing
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                <Link href="/">
                  <Button
                    size="sm"
                    className="bg-[#4fc59a] hover:opacity-90 text-[#121312] font-bold gap-1.5"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Open Admin Console ({adminId || "admin"})</span>
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLogout}
                  className="border-[#2e312e] text-[#9a988f] hover:text-[#ecebe6] gap-1"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sign Out</span>
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAdminLogin((v) => !v)}
                className="border-[#2e312e] bg-[#1c1e1c] text-[#ecebe6] hover:border-[#4fc59a] gap-1.5"
              >
                <Lock className="h-3.5 w-3.5 text-[#4fc59a]" />
                <span>Admin Sign In</span>
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible Admin Login Form (Protected ID + Password) */}
        {showAdminLogin && !isAuthenticated && (
          <Card className="border-[#4fc59a]/40 bg-[#181a18] shadow-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-[#4fc59a]" />
                <span>Admin Operations Console Login</span>
              </CardTitle>
              <p className="text-xs text-[#9a988f]">
                Sign in with your BigWarn Admin ID and Password to inspect the live news stream, Medallion Lakehouse (ELT), crowd telemetry table, and portal logs.
              </p>
            </CardHeader>
            <CardContent>
              {!authConfigured && (
                <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
                  Admin authentication env vars are not set on this server yet. Add{" "}
                  <code className="font-mono text-amber-100">BIGWARN_ADMIN_ID</code> and{" "}
                  <code className="font-mono text-amber-100">BIGWARN_ADMIN_PASSWORD</code> in Vercel Environment Variables.
                </div>
              )}
              <form onSubmit={handleLogin} className="grid gap-3 sm:grid-cols-3 items-end">
                <div>
                  <label className="block text-[11px] font-mono text-[#9a988f] mb-1">
                    Admin ID
                  </label>
                  <input
                    type="text"
                    required
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                    className="w-full rounded-lg border border-[#2e312e] bg-[#121312] px-3 py-2 text-xs text-[#ecebe6] focus:border-[#4fc59a] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-[#9a988f] mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter admin password"
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-[#2e312e] bg-[#121312] px-3 py-2 text-xs text-[#ecebe6] focus:border-[#4fc59a] focus:outline-none"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#4fc59a] hover:opacity-90 text-[#121312] font-bold"
                >
                  {submitting ? "Signing in..." : "Unlock Admin Console"}
                </Button>
              </form>
              {loginError && (
                <p className="mt-2.5 text-xs text-red-400 font-medium">{loginError}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Public Recommendation Cards: Android APK + iOS PWA */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Android Card */}
          <Card
            className={`border-[#2e312e] bg-[#181a18] shadow-xl flex flex-col justify-between ${
              platform === "android" ? "ring-2 ring-emerald-500/60" : ""
            }`}
          >
            <CardHeader className="pb-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className="font-mono text-[10.5px] border-emerald-500/40 text-emerald-300"
                >
                  Android 8.0+ • Native App
                </Badge>
                {platform === "android" && (
                  <Badge className="bg-emerald-600 text-white text-[10px]">
                    Recommended for your phone
                  </Badge>
                )}
              </div>
              <CardTitle className="text-lg font-extrabold flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-emerald-400" />
                <span>Download for Android (APK)</span>
              </CardTitle>
              <p className="text-xs text-[#9a988f] leading-relaxed">
                Full native Android build with BLE, Wi-Fi &amp; 4G crowd sensing, Bangla/English UI, and live road navigation.
              </p>
            </CardHeader>

            <CardContent className="space-y-4">
              <a
                href="/downloads/bigwarn-edge.apk"
                download="bigwarn-edge.apk"
                className="block w-full"
              >
                <Button className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-950/40">
                  <Download className="h-4 w-4" />
                  <span>Download Android APK (v1.1.0)</span>
                </Button>
              </a>

              <div className="rounded-xl border border-[#2e312e] bg-[#121312] p-3.5 text-xs space-y-1.5">
                <div className="font-semibold text-[#ecebe6]">
                  How to install on Samsung / Android
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[#9a988f]">
                  <li>Tap <b className="text-[#ecebe6]">Download Android APK</b> above.</li>
                  <li>
                    Open <code className="text-[#4fc59a]">bigwarn-edge.apk</code> from Downloads or My Files.
                  </li>
                  <li>Allow <b className="text-[#ecebe6]">Install unknown apps</b> if prompted, then tap Install.</li>
                </ol>
              </div>
            </CardContent>
          </Card>

          {/* Apple / iOS PWA Card */}
          <Card
            className={`border-[#2e312e] bg-[#181a18] shadow-xl flex flex-col justify-between ${
              platform === "ios" ? "ring-2 ring-sky-500/60" : ""
            }`}
          >
            <CardHeader className="pb-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className="font-mono text-[10.5px] border-sky-500/40 text-sky-300"
                >
                  Apple iPhone / iPad • iOS PWA
                </Badge>
                {platform === "ios" && (
                  <Badge className="bg-sky-600 text-white text-[10px]">
                    Recommended for your iPhone
                  </Badge>
                )}
              </div>
              <CardTitle className="text-lg font-extrabold flex items-center gap-2">
                <Compass className="h-5 w-5 text-sky-400" />
                <span>Use on iPhone (Web App PWA)</span>
              </CardTitle>
              <p className="text-xs text-[#9a988f] leading-relaxed">
                Apple does not install Android APK files directly from browsers. iPhone &amp; iPad users launch the dedicated BigWarn iOS Web App (PWA) and pin it to their Home Screen.
              </p>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Link href="/pwa" className="block w-full">
                  <Button className="w-full gap-2 bg-sky-600 hover:bg-sky-500 text-white font-bold shadow-lg shadow-sky-950/40">
                    <span>Open BigWarn iOS Web App (PWA)</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>

                {iosStoreUrl && (
                  <a
                    href={iosStoreUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full"
                  >
                    <Button
                      variant="outline"
                      className="w-full border-sky-500/40 text-sky-300 hover:bg-sky-950/40 font-semibold"
                    >
                      Install Native iOS Build (TestFlight / App Store)
                    </Button>
                  </a>
                )}
              </div>

              <div className="rounded-xl border border-[#2e312e] bg-[#121312] p-3.5 text-xs space-y-1.5">
                <div className="font-semibold text-[#ecebe6] flex items-center gap-1.5">
                  <Share className="h-3.5 w-3.5 text-sky-400" />
                  <span>Add to iPhone Home Screen (3 steps)</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[#9a988f]">
                  <li>Tap <b className="text-[#ecebe6]">Open BigWarn iOS Web App</b> above in <b className="text-[#ecebe6]">Safari</b>.</li>
                  <li>Tap Safari’s <b className="text-[#ecebe6]">Share (↑)</b> button at the bottom bar.</li>
                  <li>Choose <b className="text-[#ecebe6]">Add to Home Screen</b> &rarr; Open like a native app!</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Consumer App Capabilities Summary */}
        <div className="grid gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-[#2e312e] bg-[#181a18] p-3.5 space-y-1">
            <MapPin className="h-4 w-4 text-sky-400" />
            <h3 className="font-bold text-[#ecebe6]">Pin &amp; Unpin Any Route</h3>
            <p className="text-[#9a988f] leading-relaxed">
              Tap Pin to inspect road blockades to your destination, and tap Unpin anytime to remove the pin and browse freely.
            </p>
          </div>
          <div className="rounded-xl border border-[#2e312e] bg-[#181a18] p-3.5 space-y-1">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h3 className="font-bold text-[#ecebe6]">Live Hazard Heatmaps</h3>
            <p className="text-[#9a988f] leading-relaxed">
              Active 3-hour road disruption zones and crowd density alerts update automatically in real time.
            </p>
          </div>
          <div className="rounded-xl border border-[#2e312e] bg-[#181a18] p-3.5 space-y-1">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h3 className="font-bold text-[#ecebe6]">Multi-Source Verification</h3>
            <p className="text-[#9a988f] leading-relaxed">
              Every road threat badge is scored across independent newspaper confirmations to filter out rumors.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
