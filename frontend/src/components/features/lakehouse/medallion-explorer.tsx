"use client";

import React from "react";
import type { LakehouseSnapshot } from "@/types/news";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  snapshot: LakehouseSnapshot | null;
  onSelectArea?: (area: string) => void;
}

export function MedallionExplorer({ snapshot, onSelectArea }: Props) {
  if (!snapshot) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Loading Medallion Lakehouse ELT state…
      </div>
    );
  }

  const { bronze, silver, gold } = snapshot.layers;

  return (
    <div className="space-y-6">
      {/* Medallion ELT Pipeline Architecture Banner */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-amber-600">
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
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>
              Immutable raw stream from <b>{bronze.sources_active}</b> portals
              buffered via Kafka / JSONL.
            </p>
            <div className="flex justify-between pt-2 font-mono text-foreground">
              <span>Raw Articles: {bronze.record_count}</span>
              <span>Corpus: {bronze.total_words.toLocaleString()} words</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-slate-400">
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
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>
              Filtered local disruptions, cross-paper de-duplicated & matched to
              OpenStreetMap coordinates.
            </p>
            <div className="flex justify-between pt-2 font-mono text-foreground">
              <span>Disruption Stories: {silver.record_count}</span>
              <span>Unique Events: {silver.deduplicated_count}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-600">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <Badge variant="success">🥇 GOLD LAYER (Spark T2)</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                Edge MQTT Topics
              </span>
            </div>
            <CardTitle className="mt-1 font-mono text-sm">
              {gold.table}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>
              Multi-source corroborated area alerts with veracity confidence
              scores pushed to edge phones.
            </p>
            <div className="flex justify-between pt-2 font-mono text-foreground">
              <span>Area Alert Topics: {gold.alert_clusters}</span>
              <span>Confirmed (2+ papers): {gold.confirmed_multi_source}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gold Corroborated Area Alerts Table */}
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
              {snapshot.gold_alerts.length} Active Area Clusters
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
                          {cl.source_count === 1 ? "paper" : "papers"})
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

