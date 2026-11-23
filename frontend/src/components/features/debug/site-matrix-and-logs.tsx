"use client";

import React, { useState } from "react";
import type { DebugPayload, NewsArticle } from "@/types/news";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  items: NewsArticle[];
  debugData: DebugPayload;
  onSelectSource: (source: string) => void;
  onRefreshDebug: () => void;
}

export function SiteMatrixAndLogs({
  items,
  debugData,
  onSelectSource,
  onRefreshDebug,
}: Props) {
  const [matrixQuery, setMatrixQuery] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState<"all" | "err" | "info" | "new">(
    "all"
  );

  // Aggregate per-newspaper statistics
  const bySource = new Map<
    string,
    {
      source: string;
      site_key: string;
      lang: string;
      count: number;
      words: number;
      bodyOk: number;
      pubOk: number;
      disruptions: number;
      lastIngested: string;
    }
  >();

  items.forEach((i) => {
    let s = bySource.get(i.source);
    if (!s) {
      s = {
        source: i.source,
        site_key: i.site_key || "",
        lang: (i.lang || "en").toUpperCase(),
        count: 0,
        words: 0,
        bodyOk: 0,
        pubOk: 0,
        disruptions: 0,
        lastIngested: "",
      };
      bySource.set(i.source, s);
    }
    s.count++;
    const wc = i.word_count || (i.body ? i.body.split(/\s+/).length : 0);
    s.words += wc;
    if (wc >= 30) s.bodyOk++;
    if (i.published) s.pubOk++;
    if ((i.event_types && i.event_types.length) || i.is_disruption)
      s.disruptions++;
    if ((i.ingested_at || "") > s.lastIngested)
      s.lastIngested = i.ingested_at || "";
  });

  const rows = Array.from(bySource.values())
    .filter(
      (r) =>
        !matrixQuery ||
        `${r.source} ${r.site_key}`
          .toLowerCase()
          .includes(matrixQuery.toLowerCase())
    )
    .sort((a, b) => b.count - a.count);

  const filteredLogs = (debugData.log_lines || []).filter((ln) => {
    if (logLevel === "err" && !ln.includes("! ") && !ln.includes("? "))
      return false;
    if (logLevel === "info" && !ln.includes("INFO |")) return false;
    if (logLevel === "new" && !ln.includes("NEW |")) return false;
    if (logQuery && !ln.toLowerCase().includes(logQuery.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Site Health & Extraction Quality Matrix */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                📊 Newspaper & Portal Health Matrix ({rows.length} Active Today)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Click any newspaper row to filter the Stream Inspector by that
                source.
              </p>
            </div>
            <Input
              placeholder="Filter newspaper or site_key…"
              value={matrixQuery}
              onChange={(e) => setMatrixQuery(e.target.value)}
              className="w-full sm:max-w-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile Phone Card View (< md) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:hidden">
            {rows.map((r) => {
              const avgW = r.count ? Math.round(r.words / r.count) : 0;
              const bodyPct = r.count
                ? Math.round((r.bodyOk / r.count) * 100)
                : 0;
              const pubPct = r.count
                ? Math.round((r.pubOk / r.count) * 100)
                : 0;
              return (
                <div
                  key={r.source}
                  onClick={() => onSelectSource(r.source)}
                  className="cursor-pointer rounded-xl border border-border bg-card/60 p-3 text-xs space-y-2 hover:border-primary"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-primary truncate">
                      {r.source}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline">{r.lang}</Badge>
                      <span className="font-mono font-bold text-foreground">
                        {r.count} art.
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>Avg: {avgW}w</span>
                    <span>Disruptions: {r.disruptions}</span>
                    <span>Body: {bodyPct}%</span>
                    <span>Pub: {pubPct}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table View (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-2.5">Newspaper / Portal</th>
                  <th className="p-2.5">Key</th>
                  <th className="p-2.5">Lang</th>
                  <th className="p-2.5 text-right">Emitted Today</th>
                  <th className="p-2.5 text-right">Avg Words</th>
                  <th className="p-2.5 text-right">Body OK %</th>
                  <th className="p-2.5 text-right">Pub Date %</th>
                  <th className="p-2.5 text-right">Disruptions</th>
                  <th className="p-2.5 text-right">Seen: Today</th>
                  <th className="p-2.5 text-right">Seen: Old</th>
                  <th className="p-2.5 text-right">Last Ingested</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const seen = debugData.seen_stats?.[r.site_key] || {};
                  const avgW = r.count ? Math.round(r.words / r.count) : 0;
                  const bodyPct = r.count
                    ? Math.round((r.bodyOk / r.count) * 100)
                    : 0;
                  const pubPct = r.count
                    ? Math.round((r.pubOk / r.count) * 100)
                    : 0;
                  return (
                    <tr
                      key={r.source}
                      onClick={() => onSelectSource(r.source)}
                      className="cursor-pointer border-b border-border/70 hover:bg-accent/50"
                    >
                      <td className="p-2.5 font-semibold text-primary">
                        {r.source}
                      </td>
                      <td className="p-2.5 font-mono text-muted-foreground">
                        {r.site_key || "-"}
                      </td>
                      <td className="p-2.5">
                        <Badge variant="outline">{r.lang}</Badge>
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold">
                        {r.count}
                      </td>
                      <td className="p-2.5 text-right font-mono">{avgW}w</td>
                      <td className="p-2.5 text-right">
                        <Badge
                          variant={bodyPct >= 80 ? "success" : "warning"}
                        >
                          {bodyPct}%
                        </Badge>
                      </td>
                      <td className="p-2.5 text-right">
                        <Badge variant={pubPct >= 80 ? "success" : "warning"}>
                          {pubPct}%
                        </Badge>
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {r.disruptions}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {seen.today || 0}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {seen.old || 0}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {r.lastIngested.slice(11, 19) || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Live Scraper Log Console */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              🖥️ Live Scraper Log Console (`news_stream_{debugData.date}.log`)
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <Input
                placeholder="Search log lines…"
                value={logQuery}
                onChange={(e) => setLogQuery(e.target.value)}
                className="w-full sm:w-56"
              />
              <select
                value={logLevel}
                onChange={(e) => setLogLevel(e.target.value as any)}
                className="h-9 flex-1 sm:flex-none rounded-md border border-input bg-card px-2.5 text-xs"
              >
                <option value="all">All Log Lines</option>
                <option value="err">⚠️ Warnings / Errors (!)</option>
                <option value="info">ℹ️ Round Status (INFO)</option>
                <option value="new">🟢 Emitted Articles (NEW)</option>
              </select>
              <Button variant="outline" size="sm" onClick={onRefreshDebug}>
                ↻ Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-96 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
            {filteredLogs.length === 0 ? (
              <div className="text-zinc-500">No matching log lines.</div>
            ) : (
              filteredLogs.map((ln, idx) => {
                const isErr = ln.includes("! ") || ln.includes("? ");
                const isNew = ln.includes("NEW |");
                const isRound = ln.includes("INFO | -- round");
                return (
                  <div
                    key={idx}
                    className={
                      isErr
                        ? "font-semibold text-red-400"
                        : isNew
                        ? "text-emerald-400"
                        : isRound
                        ? "text-sky-400"
                        : "text-zinc-300"
                    }
                  >
                    {ln}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

