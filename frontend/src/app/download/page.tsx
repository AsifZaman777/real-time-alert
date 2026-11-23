"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  MapPin,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

export default function DownloadAppPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-3.5 py-4 sm:space-y-6 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Live Stream Console</span>
        </Link>
        <Badge variant="outline" className="font-mono text-[10.5px] sm:text-[11px]">
          Android 8.0+ • Samsung / All Android
        </Badge>
      </div>

      <Card className="border-primary/40 bg-gradient-to-b from-card to-background shadow-xl">
        <CardHeader className="space-y-3 pb-4">
          <div className="flex items-center gap-3">
            <img
              src="/icon.svg"
              alt="BigWarn Edge App Icon"
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl border border-border shadow-md shrink-0"
            />
            <div className="min-w-0">
              <CardTitle className="text-xl sm:text-2xl font-extrabold tracking-tight">
                BigWarn Edge Mobile App
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Real-Time Bangladesh Threat Navigation • OSRM Road Routing • Live Hazard Alerts
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Primary Download CTA */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="text-sm font-bold text-foreground">
                  BigWarn Edge v1.1.0 (Android APK)
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Connected to Live Cloud HTTPS Stream &amp; OpenStreetMap Leaflet Navigation.
              </p>
            </div>

            <a
              href="/downloads/bigwarn-edge.apk"
              download="bigwarn-edge.apk"
              className="w-full sm:w-auto"
            >
              <Button className="w-full sm:w-auto gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-950/50">
                <Download className="h-4 w-4" />
                <span>Download Android APK</span>
              </Button>
            </a>
          </div>

          {/* Feature Highlights */}
          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-lg border border-border bg-card/60 p-3 space-y-1">
              <MapPin className="h-4 w-4 text-sky-400" />
              <h3 className="font-bold text-foreground">Press &amp; Hold Pin</h3>
              <p className="text-muted-foreground leading-relaxed">
                Hold anywhere on the Leaflet map to drop a Google Maps-style pin and route along real streets.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card/60 p-3 space-y-1">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h3 className="font-bold text-foreground">3h Red Road Dots</h3>
              <p className="text-muted-foreground leading-relaxed">
                Only active threats from the last 3 hours appear as pulsing red dots with translucent tooltips.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card/60 p-3 space-y-1">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h3 className="font-bold text-foreground">45 BD Portals</h3>
              <p className="text-muted-foreground leading-relaxed">
                Corroborated multi-source veracity scoring across 15 English &amp; 30 Bangla newspapers.
              </p>
            </div>
          </div>

          {/* Installation Steps for Samsung / Android */}
          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2.5 text-xs">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <Smartphone className="h-4 w-4 text-primary" />
              <span>How to Install on Samsung / Android</span>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
              <li>
                Tap <b className="text-foreground">Download Android APK</b> above on your phone.
              </li>
              <li>
                Open the downloaded <code className="text-primary">bigwarn-edge.apk</code> file from your browser Downloads or Samsung My Files.
              </li>
              <li>
                If prompted, tap <b className="text-foreground">Settings</b> &rarr; allow <b className="text-foreground">Install unknown apps</b> for Chrome / Samsung Internet.
              </li>
              <li>
                Tap <b className="text-foreground">Install</b> &rarr; Open <b className="text-foreground">BigWarn Edge</b>!
              </li>
            </ol>
            <div className="flex items-center gap-1.5 pt-1 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Tip: Tap the Sync button in the top-right header anytime to reconnect after a network drop.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
