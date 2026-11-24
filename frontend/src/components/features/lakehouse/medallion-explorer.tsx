"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LakehouseSnapshot, NewsArticle } from "@/types/news";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  snapshot: LakehouseSnapshot | null;
  items?: NewsArticle[];
  onSelectArea?: (area: string) => void;
}

interface LiveHistoryPoint {
  timeLabel: string;
  bronze: number;
  silver: number;
  goldArticles: number;
  goldClusters: number;
}

export function MedallionExplorer({ snapshot, items = [], onSelectArea }: Props) {
  const [liveHistory, setLiveHistory] = useState<LiveHistoryPoint[]>([]);
  const [lastUpdatedClock, setLastUpdatedClock] = useState<string>("");

  const goldArticleCount = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.gold_alerts.reduce(
      (sum, cl) => sum + (cl.articles?.length || cl.source_count || 1),
      0
    );
  }, [snapshot]);

  // Append a live data point every time the snapshot updates
  useEffect(() => {
    if (!snapshot) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const label = `${hh}:${mm}:${ss}`;
    setLastUpdatedClock(label);

    const bCount = snapshot.layers.bronze.record_count;
    const sCount = snapshot.layers.silver.record_count;
    const gClusters = snapshot.layers.gold.alert_clusters;

    setLiveHistory((prev) => {
      const nextPt: LiveHistoryPoint = {
        timeLabel: label,
        bronze: bCount,
        silver: sCount,
        goldArticles: goldArticleCount,
        goldClusters: gClusters,
      };
      const next = [...prev, nextPt];
      return next.slice(-14);
    });
  }, [snapshot, goldArticleCount]);

  // Compute time-of-day (hourly) distribution across Bronze, Silver, and Gold from actual timestamps
  const hourlyTimeline = useMemo(() => {
    const buckets = new Map<
      string,
      { label: string; bronze: number; silver: number; gold: number }
    >();

    const extractHourKey = (iso?: string | null): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, "0");
        return `${hh}:00`;
      }
      const m = String(iso).match(/T(\d{2}):/);
      return m ? `${m[1]}:00` : null;
    };

    items.forEach((art) => {
      const hk = extractHourKey(art.published || art.published_at || art.ingested_at);
      if (!hk) return;
      const entry = buckets.get(hk) || { label: hk, bronze: 0, silver: 0, gold: 0 };
      entry.bronze += 1;
      if (art.is_disruption || (art.event_types && art.event_types.length > 0)) {
        entry.silver += 1;
      }
      buckets.set(hk, entry);
    });

    (snapshot?.gold_alerts || []).forEach((cl) => {
      (cl.articles || []).forEach((a) => {
        const hk = extractHourKey(a.published || a.ingested_at || cl.last_updated);
        if (!hk) return;
        const entry = buckets.get(hk) || { label: hk, bronze: 0, silver: 0, gold: 0 };
        entry.gold += 1;
        buckets.set(hk, entry);
      });
    });

    const sorted = Array.from(buckets.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    if (sorted.length > 0) return sorted.slice(-12);

    // Fallback to live polling history if items list is empty
    return liveHistory.map((h) => ({
      label: h.timeLabel.slice(0, 5),
      bronze: h.bronze,
      silver: h.silver,
      gold: h.goldArticles,
    }));
  }, [items, snapshot, liveHistory]);

  // Event-type distribution across Gold & Silver
  const eventBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { event: string; goldClusters: number; goldArticles: number }
    >();
    (snapshot?.gold_alerts || []).forEach((cl) => {
      const ev = cl.event_type || "disruption";
      const cur = map.get(ev) || { event: ev, goldClusters: 0, goldArticles: 0 };
      cur.goldClusters += 1;
      cur.goldArticles += cl.articles?.length || cl.source_count || 1;
      map.set(ev, cur);
    });
    return Array.from(map.values()).sort(
      (a, b) => b.goldArticles - a.goldArticles || b.goldClusters - a.goldClusters
    );
  }, [snapshot]);

  // Veracity tier breakdown in Gold
  const veracityBreakdown = useMemo(() => {
    const alerts = snapshot?.gold_alerts || [];
    const verified3Plus = alerts.filter((a) => a.source_count >= 3).length;
    const confirmed2 = alerts.filter((a) => a.source_count === 2).length;
    const single1 = alerts.filter((a) => a.source_count <= 1).length;
    return { verified3Plus, confirmed2, single1, total: alerts.length };
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Loading Medallion Lakehouse ELT state…
      </div>
    );
  }

  const { bronze, silver, gold } = snapshot.layers;

  const bronzeCount = bronze.record_count;
  const silverCount = silver.record_count;
  const silverDedupCount = silver.deduplicated_count;
  const goldClusterCount = gold.alert_clusters;
  const goldConfirmedCount = gold.confirmed_multi_source;

  const maxLayerValue = Math.max(
    1,
    bronzeCount,
    silverCount,
    silverDedupCount,
    goldArticleCount,
    goldClusterCount
  );

  const silverYieldPct =
    bronzeCount > 0 ? Math.min(100, Math.round((silverCount / bronzeCount) * 1000) / 10) : 0;
  const dedupYieldPct =
    silverCount > 0
      ? Math.min(100, Math.round((silverDedupCount / silverCount) * 1000) / 10)
      : 0;
  const goldArticleRatioPct =
    bronzeCount > 0
      ? Math.min(100, Math.round((goldArticleCount / bronzeCount) * 1000) / 10)
      : 0;
  const goldVerifiedPct =
    goldClusterCount > 0
      ? Math.min(100, Math.round((goldConfirmedCount / goldClusterCount) * 1000) / 10)
      : 0;

  // Donut Chart Geometry (Bronze vs Silver vs Gold articles)
  const totalPool = Math.max(1, bronzeCount + silverCount + goldArticleCount);
  const rDonut = 58;
  const cDonut = Math.PI * 2 * rDonut;
  const bronzeArc = (bronzeCount / totalPool) * cDonut;
  const silverArc = (silverCount / totalPool) * cDonut;
  const goldArc = (goldArticleCount / totalPool) * cDonut;

  // Vertical Bar Chart Columns
  const barColumns = [
    {
      key: "bronze_raw",
      label: "Bronze Raw",
      sub: "All Articles",
      value: bronzeCount,
      color: "#F59E0B",
      bgClass: "bg-amber-500",
      textClass: "text-amber-400",
    },
    {
      key: "silver_disruptions",
      label: "Silver Threats",
      sub: "Filtered Articles",
      value: silverCount,
      color: "#38BDF8",
      bgClass: "bg-sky-400",
      textClass: "text-sky-400",
    },
    {
      key: "silver_dedup",
      label: "Silver Unique",
      sub: "Deduplicated",
      value: silverDedupCount,
      color: "#818CF8",
      bgClass: "bg-indigo-400",
      textClass: "text-indigo-400",
    },
    {
      key: "gold_articles",
      label: "Gold Articles",
      sub: "In Alert Clusters",
      value: goldArticleCount,
      color: "#34D399",
      bgClass: "bg-emerald-400",
      textClass: "text-emerald-400",
    },
    {
      key: "gold_clusters",
      label: "Gold Clusters",
      sub: "Area Alert Topics",
      value: goldClusterCount,
      color: "#10B981",
      bgClass: "bg-emerald-500",
      textClass: "text-emerald-400",
    },
    {
      key: "gold_verified",
      label: "Gold Verified",
      sub: "2+ News Portals",
      value: goldConfirmedCount,
      color: "#22C55E",
      bgClass: "bg-green-500",
      textClass: "text-green-400",
    },
  ];

  // SVG Line/Area Chart points for hourlyTimeline
  const chartW = 540;
  const chartH = 165;
  const padL = 38;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const maxTimelineY = Math.max(
    1,
    ...hourlyTimeline.map((d) => Math.max(d.bronze, d.silver, d.gold))
  );

  const buildPolyline = (getter: (d: (typeof hourlyTimeline)[number]) => number) => {
    if (hourlyTimeline.length === 0) return "";
    if (hourlyTimeline.length === 1) {
      const y = padT + plotH - (getter(hourlyTimeline[0]) / maxTimelineY) * plotH;
      return `${padL},${y.toFixed(1)} ${padL + plotW},${y.toFixed(1)}`;
    }
    return hourlyTimeline
      .map((d, i) => {
        const x = padL + (i / (hourlyTimeline.length - 1)) * plotW;
        const y = padT + plotH - (getter(d) / maxTimelineY) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const buildAreaPath = (getter: (d: (typeof hourlyTimeline)[number]) => number) => {
    const linePts = buildPolyline(getter);
    if (!linePts) return "";
    const baselineY = (padT + plotH).toFixed(1);
    const firstX = padL.toFixed(1);
    const lastX = (padL + plotW).toFixed(1);
    return `M ${firstX},${baselineY} L ${linePts.replace(/ /g, " L ")} L ${lastX},${baselineY} Z`;
  };

  return (
    <div className="space-y-6">
      {/* Live Dashboard Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2e312e] bg-[#181a18] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-[#ecebe6] m-0">
              Live Medallion ELT Analytics Dashboard (Bronze → Silver → Gold)
            </h2>
            <p className="text-xs text-[#9a988f] m-0">
              Real-time article counts, ELT funnel conversion yields, and multi-layer distribution charts
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span className="rounded-md bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-amber-300 font-semibold">
            🥉 Bronze: {bronzeCount.toLocaleString()}
          </span>
          <span className="rounded-md bg-sky-500/15 border border-sky-500/30 px-2.5 py-1 text-sky-300 font-semibold">
            🥈 Silver: {silverCount.toLocaleString()}
          </span>
          <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-emerald-300 font-semibold">
            🥇 Gold: {goldArticleCount.toLocaleString()} arts ({goldClusterCount} clusters)
          </span>
          {lastUpdatedClock && (
            <span className="text-[11px] text-[#9a988f]">
              Synced {lastUpdatedClock}
            </span>
          )}
        </div>
      </div>

      {/* 1. Top 3 Medallion Layer KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-amber-500 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <Badge variant="warning">🥉 BRONZE LAYER (E → L)</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {bronze.format}
              </span>
            </div>
            <CardTitle className="mt-1 font-mono text-sm">
              {bronze.table}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <div className="text-2xl font-extrabold font-mono text-amber-400">
                  {bronzeCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-[#9a988f]">
                  Raw Ingested Articles
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-sm font-bold text-[#ecebe6]">
                  {bronze.sources_active} / 45
                </div>
                <div className="text-[11px] text-[#9a988f]">Active Portals</div>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#262926] overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: "100%" }} />
            </div>
            <div className="flex justify-between font-mono text-[11px] text-[#ecebe6]">
              <span>100% Raw Stream</span>
              <span>Corpus: {bronze.total_words.toLocaleString()} words</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-sky-400 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">🥈 SILVER LAYER (Spark T1)</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                OSM Geocoded
              </span>
            </div>
            <CardTitle className="mt-1 font-mono text-sm">
              {silver.table}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <div className="text-2xl font-extrabold font-mono text-sky-400">
                  {silverCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-[#9a988f]">
                  Filtered Disruption Articles
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-sm font-bold text-indigo-300">
                  {silverDedupCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-[#9a988f]">Unique Stories</div>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#262926] overflow-hidden">
              <div
                className="h-full bg-sky-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(4, silverYieldPct)}%` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[11px] text-[#ecebe6]">
              <span>{silverYieldPct}% of Bronze</span>
              <span>Dedup Rate: {dedupYieldPct}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <Badge variant="success">🥇 GOLD LAYER (Spark T2)</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                Corroborated Alerts
              </span>
            </div>
            <CardTitle className="mt-1 font-mono text-sm">
              {gold.table}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <div className="text-2xl font-extrabold font-mono text-emerald-400">
                  {goldArticleCount.toLocaleString()}{" "}
                  <span className="text-sm font-normal text-[#9a988f]">
                    articles
                  </span>
                </div>
                <div className="text-[11px] text-[#9a988f]">
                  Grouped into{" "}
                  <b className="text-[#ecebe6]">{goldClusterCount}</b> Area Alert
                  Clusters
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-sm font-bold text-emerald-300">
                  {goldConfirmedCount}
                </div>
                <div className="text-[11px] text-[#9a988f]">2+ Portals</div>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#262926] overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(4, goldArticleRatioPct)}%` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[11px] text-[#ecebe6]">
              <span>{goldArticleRatioPct}% of Bronze</span>
              <span>Multi-Source: {goldVerifiedPct}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2. Charts Row 1: Column Bar Chart (Bronze vs Silver vs Gold Counts) + Donut Composition Chart */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left: Grouped Vertical Column Chart & ELT Funnel Bars (7 cols) */}
        <Card className="lg:col-span-7 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm sm:text-base">
                  📊 Live Article & Cluster Count by Medallion Layer
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Direct comparison of article volume across Bronze, Silver, and Gold stages
                </p>
              </div>
              <Badge variant="outline" className="font-mono text-[11px]">
                Live Snapshot ({snapshot.date})
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Vertical Column Bar Graph */}
            <div className="rounded-xl border border-[#2e312e] bg-[#121312] p-4">
              <div className="grid grid-cols-6 gap-2 sm:gap-3 items-end h-[175px] pt-6 pb-2 border-b border-[#2e312e]">
                {barColumns.map((col) => {
                  const heightPct = Math.max(
                    6,
                    Math.round((col.value / maxLayerValue) * 100)
                  );
                  return (
                    <div
                      key={col.key}
                      className="flex flex-col items-center justify-end h-full group"
                    >
                      <span
                        className={`font-mono text-[11px] sm:text-xs font-bold mb-1.5 ${col.textClass}`}
                      >
                        {col.value.toLocaleString()}
                      </span>
                      <div className="w-full max-w-[44px] h-[125px] flex items-end justify-center bg-[#1c1f1c] rounded-t-md overflow-hidden p-0.5">
                        <div
                          className="w-full rounded-t transition-all duration-500"
                          style={{
                            height: `${heightPct}%`,
                            backgroundColor: col.color,
                            boxShadow: `0 0 12px ${col.color}44`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-6 gap-2 sm:gap-3 pt-2 text-center">
                {barColumns.map((col) => (
                  <div key={col.key} className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#ecebe6] truncate">
                      {col.label}
                    </div>
                    <div className="text-[9.5px] text-[#9a988f] truncate">
                      {col.sub}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Horizontal ELT Reduction Funnel Bars */}
            <div className="space-y-2.5 text-xs">
              <div className="font-semibold text-[#ecebe6] text-xs">
                🔄 Medallion ELT Filtering & Reduction Funnel
              </div>
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-amber-400 font-semibold">
                    1. Bronze Raw Articles Ingested
                  </span>
                  <span className="text-[#ecebe6]">
                    {bronzeCount.toLocaleString()} articles (100%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-[#121312] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-sky-400 font-semibold">
                    2. Silver Threat-Filtered & Geocoded Articles
                  </span>
                  <span className="text-[#ecebe6]">
                    {silverCount.toLocaleString()} articles ({silverYieldPct}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-[#121312] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-600 to-sky-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(4, silverYieldPct)}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-emerald-400 font-semibold">
                    3. Gold Corroborated Articles ({goldClusterCount} Area Alert Clusters)
                  </span>
                  <span className="text-[#ecebe6]">
                    {goldArticleCount.toLocaleString()} articles ({goldArticleRatioPct}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-[#121312] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(4, goldArticleRatioPct)}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: SVG Donut Composition Chart & Gold Veracity Breakdown (5 cols) */}
        <Card className="lg:col-span-5 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm sm:text-base">
              🍩 Layer Share & Gold Veracity Breakdown
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Proportional distribution of articles across Bronze, Silver, and Gold
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-around gap-4 rounded-xl border border-[#2e312e] bg-[#121312] p-4">
              {/* SVG Multi-Segment Donut Chart */}
              <div className="relative flex items-center justify-center">
                <svg width="150" height="150" viewBox="0 0 150 150" className="-rotate-90">
                  <circle
                    cx="75"
                    cy="75"
                    r={rDonut}
                    fill="transparent"
                    stroke="#1f231f"
                    strokeWidth="16"
                  />
                  {/* Bronze Segment */}
                  <circle
                    cx="75"
                    cy="75"
                    r={rDonut}
                    fill="transparent"
                    stroke="#F59E0B"
                    strokeWidth="16"
                    strokeDasharray={`${bronzeArc} ${cDonut}`}
                    strokeDashoffset={0}
                  />
                  {/* Silver Segment */}
                  <circle
                    cx="75"
                    cy="75"
                    r={rDonut}
                    fill="transparent"
                    stroke="#38BDF8"
                    strokeWidth="16"
                    strokeDasharray={`${silverArc} ${cDonut}`}
                    strokeDashoffset={-bronzeArc}
                  />
                  {/* Gold Segment */}
                  <circle
                    cx="75"
                    cy="75"
                    r={rDonut}
                    fill="transparent"
                    stroke="#10B981"
                    strokeWidth="16"
                    strokeDasharray={`${goldArc} ${cDonut}`}
                    strokeDashoffset={-(bronzeArc + silverArc)}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-mono text-lg font-extrabold text-[#ecebe6]">
                    {bronzeCount.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-[#9a988f] uppercase tracking-wider">
                    Bronze Base
                  </span>
                </div>
              </div>

              {/* Donut Legend */}
              <div className="space-y-2.5 text-xs w-full sm:w-auto">
                <div className="flex items-center justify-between sm:justify-start gap-3">
                  <span className="inline-block h-3 w-3 rounded-sm bg-amber-500 shrink-0" />
                  <div>
                    <div className="font-semibold text-[#ecebe6]">
                      🥉 Bronze: {bronzeCount.toLocaleString()} articles
                    </div>
                    <div className="text-[10.5px] text-[#9a988f]">
                      {Math.round((bronzeCount / totalPool) * 100)}% of total layer records
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-start gap-3">
                  <span className="inline-block h-3 w-3 rounded-sm bg-sky-400 shrink-0" />
                  <div>
                    <div className="font-semibold text-[#ecebe6]">
                      🥈 Silver: {silverCount.toLocaleString()} articles
                    </div>
                    <div className="text-[10.5px] text-[#9a988f]">
                      {silverDedupCount.toLocaleString()} deduplicated disruption events
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-start gap-3">
                  <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500 shrink-0" />
                  <div>
                    <div className="font-semibold text-[#ecebe6]">
                      🥇 Gold: {goldArticleCount.toLocaleString()} articles
                    </div>
                    <div className="text-[10.5px] text-[#9a988f]">
                      {goldClusterCount} corroborated area clusters
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Gold Veracity Tier Distribution */}
            <div className="rounded-xl border border-[#2e312e] bg-[#121312] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#ecebe6]">
                  🛡️ Gold Cluster Veracity Tier Distribution
                </span>
                <span className="font-mono text-[11px] text-[#9a988f]">
                  {veracityBreakdown.total} clusters
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center font-mono">
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2">
                  <div className="text-base font-extrabold text-emerald-400">
                    {veracityBreakdown.verified3Plus}
                  </div>
                  <div className="text-[10px] text-emerald-300/90 font-sans">
                    Verified (3+ Papers)
                  </div>
                </div>
                <div className="rounded-lg bg-sky-500/10 border border-sky-500/30 p-2">
                  <div className="text-base font-extrabold text-sky-400">
                    {veracityBreakdown.confirmed2}
                  </div>
                  <div className="text-[10px] text-sky-300/90 font-sans">
                    Confirmed (2 Papers)
                  </div>
                </div>
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2">
                  <div className="text-base font-extrabold text-amber-400">
                    {veracityBreakdown.single1}
                  </div>
                  <div className="text-[10px] text-amber-300/90 font-sans">
                    Single Source (1 Paper)
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Charts Row 2: Live Time-Series Area Graph (Bronze vs Silver vs Gold) + Disruption Category Graph */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left: SVG Multi-Series Time-Series Area & Line Graph (7 cols) */}
        <Card className="lg:col-span-7 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm sm:text-base">
                  📈 Bronze vs. Silver vs. Gold Article Flow Over Time
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Hourly / live article ingestion curve across the three Medallion stages
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="h-2 w-2 rounded-full bg-amber-400" /> Bronze
                </span>
                <span className="flex items-center gap-1 text-sky-400">
                  <span className="h-2 w-2 rounded-full bg-sky-400" /> Silver
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Gold
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-[#2e312e] bg-[#121312] p-3">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-[180px] overflow-visible"
              >
                <defs>
                  <linearGradient id="bronzeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="silverGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.30" />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
                  const y = padT + plotH * (1 - frac);
                  const val = Math.round(maxTimelineY * frac);
                  return (
                    <g key={idx}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={padL + plotW}
                        y2={y}
                        stroke="#262926"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={padL - 6}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="9.5"
                        fill="#9a988f"
                        fontFamily="monospace"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Area Fills */}
                {hourlyTimeline.length > 0 && (
                  <>
                    <path d={buildAreaPath((d) => d.bronze)} fill="url(#bronzeGrad)" />
                    <path d={buildAreaPath((d) => d.silver)} fill="url(#silverGrad)" />
                    <path d={buildAreaPath((d) => d.gold)} fill="url(#goldGrad)" />

                    {/* Lines */}
                    <polyline
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth="2.2"
                      points={buildPolyline((d) => d.bronze)}
                    />
                    <polyline
                      fill="none"
                      stroke="#38BDF8"
                      strokeWidth="2.2"
                      points={buildPolyline((d) => d.silver)}
                    />
                    <polyline
                      fill="none"
                      stroke="#10B981"
                      strokeWidth="2.4"
                      points={buildPolyline((d) => d.gold)}
                    />

                    {/* Data Dots & X-Axis Labels */}
                    {hourlyTimeline.map((d, i) => {
                      const x =
                        hourlyTimeline.length === 1
                          ? padL + plotW / 2
                          : padL + (i / (hourlyTimeline.length - 1)) * plotW;
                      const yB = padT + plotH - (d.bronze / maxTimelineY) * plotH;
                      const yS = padT + plotH - (d.silver / maxTimelineY) * plotH;
                      const yG = padT + plotH - (d.gold / maxTimelineY) * plotH;
                      return (
                        <g key={d.label + i}>
                          <circle cx={x} cy={yB} r="3" fill="#F59E0B" />
                          <circle cx={x} cy={yS} r="3" fill="#38BDF8" />
                          <circle cx={x} cy={yG} r="3.2" fill="#10B981" />
                          {(i % Math.max(1, Math.floor(hourlyTimeline.length / 6)) === 0 ||
                            i === hourlyTimeline.length - 1) && (
                            <text
                              x={x}
                              y={chartH - 8}
                              textAnchor="middle"
                              fontSize="9.5"
                              fill="#9a988f"
                              fontFamily="monospace"
                            >
                              {d.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </>
                )}
              </svg>
            </div>
          </CardContent>
        </Card>

        {/* Right: Gold Articles & Clusters by Event Type Bar Chart (5 cols) */}
        <Card className="lg:col-span-5 bg-[#181a18] border-[#2e312e]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm sm:text-base">
              🔥 Gold Articles & Clusters by Disruption Type
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Breakdown of corroborated Gold articles across threat categories
            </p>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-[#2e312e] bg-[#121312] p-3.5 space-y-2.5 max-h-[195px] overflow-y-auto">
              {eventBreakdown.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  No active Gold disruption categories for this date yet.
                </div>
              ) : (
                eventBreakdown.slice(0, 7).map((ev) => {
                  const maxEvArts = Math.max(
                    1,
                    eventBreakdown[0]?.goldArticles || 1
                  );
                  const pct = Math.max(
                    8,
                    Math.round((ev.goldArticles / maxEvArts) * 100)
                  );
                  return (
                    <div key={ev.event} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-semibold text-[#ecebe6] uppercase">
                          ⚠️ {ev.event.replace(/_/g, " ")}
                        </span>
                        <span className="text-emerald-400">
                          {ev.goldArticles} arts ({ev.goldClusters}{" "}
                          {ev.goldClusters === 1 ? "cluster" : "clusters"})
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#1c1f1c] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4. Gold Corroborated Area Alerts Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                🥇 Gold Table: Multi-Source Corroborated Area Disruption Alerts
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Each row represents an aggregated `(Area, Disruption Type)` topic
                scored by Spark across English & Bangla newspapers.
              </p>
            </div>
            <Badge variant="outline" className="font-mono">
              {snapshot.gold_alerts.length} Active Area Clusters ({goldArticleCount} Articles)
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile Phone Card View (< md) */}
          <div className="space-y-3 md:hidden">
            {snapshot.gold_alerts.map((cl) => (
              <div
                key={cl.cluster_id}
                className="rounded-xl border border-border bg-card/60 p-3 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={() => onSelectArea && onSelectArea(cl.area)}
                    className="font-bold text-sm text-primary hover:underline text-left"
                  >
                    📍 {cl.area}
                  </button>
                  <Badge variant="destructive">⚠️ {cl.event_type}</Badge>
                </div>

                <a
                  href={cl.articles[0]?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block font-medium text-foreground hover:underline leading-snug"
                >
                  {cl.sample_headline}
                </a>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant={cl.source_count >= 2 ? "success" : "warning"}
                    >
                      {Math.round(cl.credibility_score * 100)}% score
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      ({cl.source_count}{" "}
                      {cl.source_count === 1 ? "paper" : "papers"} •{" "}
                      {cl.articles?.length || cl.source_count} articles)
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {cl.lat.toFixed(3)}°N, {cl.lon.toFixed(3)}°E
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {cl.sources.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            {snapshot.gold_alerts.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No disruption clusters detected for this date yet.
              </div>
            )}
          </div>

          {/* Desktop Table View (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-2.5">Area (OSM Topic)</th>
                  <th className="p-2.5">Disruption Type</th>
                  <th className="p-2.5">Veracity / Confidence</th>
                  <th className="p-2.5">Reporting Sources</th>
                  <th className="p-2.5">Time Windows</th>
                  <th className="p-2.5">Lead Corroborated Headline</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.gold_alerts.map((cl) => (
                  <tr
                    key={cl.cluster_id}
                    className="border-b border-border/70 hover:bg-accent/40"
                  >
                    <td className="p-2.5">
                      <button
                        onClick={() => onSelectArea && onSelectArea(cl.area)}
                        className="font-semibold text-primary hover:underline"
                      >
                        📍 {cl.area}
                      </button>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {cl.lat.toFixed(4)}°N, {cl.lon.toFixed(4)}°E
                      </div>
                    </td>
                    <td className="p-2.5">
                      <Badge variant="destructive">⚠️ {cl.event_type}</Badge>
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={
                            cl.source_count >= 2 ? "success" : "warning"
                          }
                        >
                          {Math.round(cl.credibility_score * 100)}% score
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          ({cl.source_count}{" "}
                          {cl.source_count === 1 ? "paper" : "papers"} •{" "}
                          {cl.articles?.length || cl.source_count} arts)
                        </span>
                      </div>
                    </td>
                    <td className="p-2.5">
                      <div className="flex flex-wrap gap-1">
                        {cl.sources.map((s) => (
                          <Badge key={s} variant="secondary">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-2.5 font-mono text-[11px]">
                      {cl.time_windows.length
                        ? cl.time_windows.join(", ")
                        : "Ongoing"}
                    </td>
                    <td className="max-w-md p-2.5">
                      <a
                        href={cl.articles[0]?.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline"
                      >
                        {cl.sample_headline}
                      </a>
                    </td>
                  </tr>
                ))}
                {snapshot.gold_alerts.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-muted-foreground"
                    >
                      No disruption clusters detected for this date yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
