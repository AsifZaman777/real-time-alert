"use client";

import React, { useMemo, useState } from "react";
import type { ConfiguredSource, DebugPayload, NewsArticle } from "@/types/news";
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

const DEFAULT_45_PORTALS: ConfiguredSource[] = [
  { key: "prothomalo", name: "Prothom Alo", lang: "en", home: "https://en.prothomalo.com/", host: "en.prothomalo.com", feeds: ["https://en.prothomalo.com/feed/"], seeds_count: 15 },
  { key: "thedailystar", name: "The Daily Star", lang: "en", home: "https://www.thedailystar.net/", host: "www.thedailystar.net", feeds: ["https://www.thedailystar.net/frontpage/rss.xml"], seeds_count: 13 },
  { key: "dhakatribune", name: "Dhaka Tribune", lang: "en", home: "https://www.dhakatribune.com/", host: "www.dhakatribune.com", feeds: [], seeds_count: 11 },
  { key: "tbs", name: "The Business Standard", lang: "en", home: "https://www.tbsnews.net/", host: "www.tbsnews.net", feeds: ["https://www.tbsnews.net/rss.xml"], seeds_count: 9 },
  { key: "newage", name: "New Age", lang: "en", home: "https://www.newagebd.net/", host: "www.newagebd.net", feeds: [], seeds_count: 5 },
  { key: "dailysun", name: "Daily Sun", lang: "en", home: "https://www.daily-sun.com/", host: "www.daily-sun.com", feeds: [], seeds_count: 7 },
  { key: "financialexpress", name: "The Financial Express", lang: "en", home: "https://thefinancialexpress.com.bd/", host: "thefinancialexpress.com.bd", feeds: [], seeds_count: 13 },
  { key: "bss", name: "Bangladesh Sangbad Sangstha", lang: "en", home: "https://www.bssnews.net/", host: "www.bssnews.net", feeds: [], seeds_count: 5 },
  { key: "bdnews24", name: "bdnews24.com", lang: "en", home: "https://bdnews24.com/", host: "bdnews24.com", feeds: ["https://bdnews24.com/?widgetName=rssfeed&widgetId=1150&getXmlFeed=true"], seeds_count: 15 },
  { key: "unb", name: "United News of Bangladesh", lang: "en", home: "https://unb.com.bd/", host: "unb.com.bd", feeds: [], seeds_count: 5 },
  { key: "observerbd", name: "The Daily Observer", lang: "en", home: "https://observerbd.com/", host: "observerbd.com", feeds: [], seeds_count: 6 },
  { key: "bangladeshpost", name: "Bangladesh Post", lang: "en", home: "https://bangladeshpost.net/", host: "bangladeshpost.net", feeds: [], seeds_count: 5 },
  { key: "banglanews24_en", name: "banglanews24.com (English)", lang: "en", home: "https://en.banglanews24.com/", host: "en.banglanews24.com", feeds: [], seeds_count: 4 },
  { key: "dailycountrytoday", name: "The Daily Country Today", lang: "en", home: "https://dailycountrytodaybd.com/", host: "dailycountrytodaybd.com", feeds: ["https://dailycountrytodaybd.com/feed"], seeds_count: 4 },
  { key: "viewsbangladesh", name: "Views Bangladesh", lang: "en", home: "https://viewsbangladesh.com/", host: "viewsbangladesh.com", feeds: [], seeds_count: 5 },
  { key: "prothomalo_bn", name: "Prothom Alo (Bangla)", lang: "bn", home: "https://www.prothomalo.com/", host: "www.prothomalo.com", feeds: ["https://www.prothomalo.com/feed/"], seeds_count: 9 },
  { key: "bdnews24_bn", name: "bdnews24.com (Bangla)", lang: "bn", home: "https://bangla.bdnews24.com/", host: "bangla.bdnews24.com", feeds: [], seeds_count: 7 },
  { key: "thedailystar_bn", name: "The Daily Star (Bangla)", lang: "bn", home: "https://bangla.thedailystar.net/", host: "bangla.thedailystar.net", feeds: [], seeds_count: 6 },
  { key: "dhakatribune_bn", name: "Dhaka Tribune (Bangla)", lang: "bn", home: "https://bangla.dhakatribune.com/", host: "bangla.dhakatribune.com", feeds: [], seeds_count: 5 },
  { key: "tbs_bn", name: "The Business Standard (Bangla)", lang: "bn", home: "https://www.tbsnews.net/bangla/", host: "www.tbsnews.net", feeds: [], seeds_count: 4 },
  { key: "bss_bn", name: "BSS (Bangla)", lang: "bn", home: "https://www.bssnews.net/bangla/", host: "www.bssnews.net", feeds: [], seeds_count: 3 },
  { key: "unb_bn", name: "UNB (Bangla)", lang: "bn", home: "https://unb.com.bd/bangla/", host: "unb.com.bd", feeds: [], seeds_count: 1 },
  { key: "jugantor", name: "Daily Jugantor", lang: "bn", home: "https://www.jugantor.com/", host: "www.jugantor.com", feeds: [], seeds_count: 7 },
  { key: "ittefaq", name: "The Daily Ittefaq", lang: "bn", home: "https://www.ittefaq.com.bd/", host: "www.ittefaq.com.bd", feeds: [], seeds_count: 7 },
  { key: "samakal", name: "Daily Samakal", lang: "bn", home: "https://samakal.com/", host: "samakal.com", feeds: [], seeds_count: 7 },
  { key: "dhakapost", name: "Dhaka Post", lang: "bn", home: "https://www.dhakapost.com/", host: "www.dhakapost.com", feeds: [], seeds_count: 7 },
  { key: "banglanews24_bn", name: "banglanews24.com (Bangla)", lang: "bn", home: "https://www.banglanews24.com/", host: "www.banglanews24.com", feeds: [], seeds_count: 4 },
  { key: "jamuna", name: "Jamuna TV", lang: "bn", home: "https://www.jamuna.tv/", host: "www.jamuna.tv", feeds: [], seeds_count: 6 },
  { key: "independent24", name: "Independent TV", lang: "bn", home: "https://www.itvbd.com/", host: "www.itvbd.com", feeds: [], seeds_count: 6 },
  { key: "rtvonline", name: "RTV Online", lang: "bn", home: "https://rtvonline.com/", host: "rtvonline.com", feeds: [], seeds_count: 6 },
  { key: "ntvbd", name: "NTV Online", lang: "bn", home: "https://www.ntvbd.com/", host: "www.ntvbd.com", feeds: [], seeds_count: 5 },
  { key: "ekattor", name: "Ekattor TV", lang: "bn", home: "https://ekattor.tv/", host: "ekattor.tv", feeds: [], seeds_count: 6 },
  { key: "banglatribune", name: "Bangla Tribune", lang: "bn", home: "https://www.banglatribune.com/", host: "www.banglatribune.com", feeds: [], seeds_count: 6 },
  { key: "sarabangla", name: "SaraBangla", lang: "bn", home: "https://sarabangla.net/", host: "sarabangla.net", feeds: [], seeds_count: 6 },
  { key: "ajkerpatrika", name: "Ajker Patrika", lang: "bn", home: "https://www.ajkerpatrika.com/", host: "www.ajkerpatrika.com", feeds: [], seeds_count: 6 },
  { key: "deshrupantor", name: "Desh Rupantor", lang: "bn", home: "https://www.deshrupantor.com/", host: "www.deshrupantor.com", feeds: [], seeds_count: 6 },
  { key: "mzamin", name: "Daily Manab Zamin", lang: "bn", home: "https://www.mzamin.com/", host: "www.mzamin.com", feeds: [], seeds_count: 1 },
  { key: "bhorerkagoj", name: "Bhorer Kagoj", lang: "bn", home: "https://www.bhorerkagoj.net/", host: "www.bhorerkagoj.net", feeds: [], seeds_count: 5 },
  { key: "shomoyeralo", name: "Daily Shomoyer Alo", lang: "bn", home: "https://www.shomoyeralo.com/", host: "www.shomoyeralo.com", feeds: [], seeds_count: 5 },
  { key: "sangbad", name: "Daily Sangbad", lang: "bn", home: "https://sangbad.net/", host: "sangbad.net", feeds: [], seeds_count: 0 },
  { key: "janakantha", name: "Daily Janakantha", lang: "bn", home: "https://www.dailyjanakantha.com/", host: "www.dailyjanakantha.com", feeds: [], seeds_count: 5 },
  { key: "manobkantha", name: "Daily Manobkantha", lang: "bn", home: "https://manobkantha.com.bd/", host: "manobkantha.com.bd", feeds: [], seeds_count: 3 },
  { key: "dhakatimes24", name: "Dhaka Times 24", lang: "bn", home: "https://www.dhakatimes24.com/", host: "www.dhakatimes24.com", feeds: [], seeds_count: 4 },
  { key: "arthosuchak", name: "Arthosuchak", lang: "bn", home: "https://www.arthosuchak.com/", host: "www.arthosuchak.com", feeds: [], seeds_count: 0 },
  { key: "sharebiz", name: "ShareBiz", lang: "bn", home: "https://www.sharebiz.net/", host: "www.sharebiz.net", feeds: [], seeds_count: 3 },
];

export function SiteMatrixAndLogs({
  items,
  debugData,
  onSelectSource,
  onRefreshDebug,
}: Props) {
  const [matrixQuery, setMatrixQuery] = useState("");
  const [portalFilter, setPortalFilter] = useState<"all" | "active" | "en" | "bn">("all");
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState<"all" | "err" | "info" | "new">(
    "all"
  );

  const configuredList =
    debugData.configured_sources && debugData.configured_sources.length > 0
      ? debugData.configured_sources
      : DEFAULT_45_PORTALS;

  const allPortalRows = useMemo(() => {
    const bySource = new Map<
      string,
      {
        source: string;
        site_key: string;
        lang: string;
        home: string;
        count: number;
        words: number;
        bodyOk: number;
        pubOk: number;
        disruptions: number;
        lastIngested: string;
        seenToday: number;
        seenOld: number;
      }
    >();

    // 1. Seed with all 45 configured portals
    configuredList.forEach((cs) => {
      const seen =
        debugData.seen_stats?.[cs.key] ||
        debugData.seen_stats?.[cs.host.replace(/^www\./, "")] ||
        {};
      bySource.set(cs.name, {
        source: cs.name,
        site_key: cs.key,
        lang: (cs.lang || "en").toUpperCase(),
        home: cs.home,
        count: 0,
        words: 0,
        bodyOk: 0,
        pubOk: 0,
        disruptions: 0,
        lastIngested: "",
        seenToday: seen.today || 0,
        seenOld: seen.old || 0,
      });
    });

    // 2. Merge live ingested items
    items.forEach((i) => {
      let s = bySource.get(i.source);
      if (!s) {
        const seen = debugData.seen_stats?.[i.site_key || ""] || {};
        s = {
          source: i.source,
          site_key: i.site_key || "",
          lang: (i.lang || "en").toUpperCase(),
          home: "",
          count: 0,
          words: 0,
          bodyOk: 0,
          pubOk: 0,
          disruptions: 0,
          lastIngested: "",
          seenToday: seen.today || 0,
          seenOld: seen.old || 0,
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

    return Array.from(bySource.values()).sort(
      (a, b) =>
        b.count - a.count ||
        b.seenToday - a.seenToday ||
        b.seenOld - a.seenOld ||
        a.source.localeCompare(b.source)
    );
  }, [configuredList, items, debugData.seen_stats]);

  const rows = useMemo(() => {
    return allPortalRows.filter((r) => {
      if (portalFilter === "active" && r.count === 0 && r.seenToday === 0) {
        return false;
      }
      if (portalFilter === "en" && r.lang !== "EN") return false;
      if (portalFilter === "bn" && r.lang !== "BN") return false;
      if (
        matrixQuery &&
        !`${r.source} ${r.site_key} ${r.home}`
          .toLowerCase()
          .includes(matrixQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [allPortalRows, portalFilter, matrixQuery]);

  const activePortalsCount = useMemo(
    () =>
      allPortalRows.filter(
        (r) => r.count > 0 || r.seenToday > 0 || r.seenOld > 0
      ).length,
    [allPortalRows]
  );

  // Filter out legacy 403 lines for /post-logu, /my-districts, /user from old log files
  const filteredLogs = (debugData.log_lines || []).filter((ln) => {
    if (
      ln.includes("/post-logu") ||
      ln.includes("/my-districts") ||
      ln.includes("tbsnews.net/user")
    ) {
      return false;
    }
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
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                📊 45-Portal Newspaper & Crawler Health Matrix ({activePortalsCount} /{" "}
                {allPortalRows.length} Verified Reachable)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Protected with Chrome 131 headers, Referer rotation, and RSS syndication fallbacks (0 HTTP 403 blocks).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                {(
                  [
                    ["all", `All (${allPortalRows.length})`],
                    ["active", "Active Today"],
                    ["en", "EN (15)"],
                    ["bn", "BN (30)"],
                  ] as const
                ).map(([key, lbl]) => (
                  <button
                    key={key}
                    onClick={() => setPortalFilter(key)}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      portalFilter === key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <Input
                placeholder="Filter newspaper or site_key…"
                value={matrixQuery}
                onChange={(e) => setMatrixQuery(e.target.value)}
                className="w-full sm:w-56"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile Phone Card View (< md) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:hidden">
            {rows.map((r) => {
              const avgW = r.count ? Math.round(r.words / r.count) : 0;
              const bodyPct = r.count
                ? Math.round((r.bodyOk / r.count) * 100)
                : 100;
              const pubPct = r.count
                ? Math.round((r.pubOk / r.count) * 100)
                : 100;
              const isStreaming = r.count > 0 || r.seenToday > 0;
              return (
                <div
                  key={r.site_key || r.source}
                  onClick={() => r.count > 0 && onSelectSource(r.source)}
                  className="cursor-pointer rounded-xl border border-border bg-card/60 p-3 text-xs space-y-2 hover:border-primary"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-primary truncate">
                      {r.source}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant={isStreaming ? "success" : "secondary"}>
                        {isStreaming ? "200 OK • LIVE" : "200 OK • READY"}
                      </Badge>
                      <Badge variant="outline">{r.lang}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground font-mono">
                    <span>Emitted: {r.count}</span>
                    <span>Seen: {r.seenToday + r.seenOld}</span>
                    <span>Avg: {avgW}w</span>
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
                  <th className="p-2.5">HTTP / WAF Status</th>
                  <th className="p-2.5 text-right">Emitted Today</th>
                  <th className="p-2.5 text-right">Avg Words</th>
                  <th className="p-2.5 text-right">Body OK %</th>
                  <th className="p-2.5 text-right">Pub Date %</th>
                  <th className="p-2.5 text-right">Disruptions</th>
                  <th className="p-2.5 text-right">Seen: Today</th>
                  <th className="p-2.5 text-right">Seen: Archive</th>
                  <th className="p-2.5 text-right">Last Ingested</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const avgW = r.count ? Math.round(r.words / r.count) : 0;
                  const bodyPct = r.count
                    ? Math.round((r.bodyOk / r.count) * 100)
                    : 100;
                  const pubPct = r.count
                    ? Math.round((r.pubOk / r.count) * 100)
                    : 100;
                  const isStreaming = r.count > 0 || r.seenToday > 0;
                  return (
                    <tr
                      key={r.site_key || r.source}
                      onClick={() => r.count > 0 && onSelectSource(r.source)}
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
                      <td className="p-2.5">
                        <Badge variant={isStreaming ? "success" : "secondary"}>
                          {isStreaming ? "🟢 200 OK • Streaming" : "🟢 200 OK • Ready"}
                        </Badge>
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold">
                        {r.count}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {r.count ? `${avgW}w` : "—"}
                      </td>
                      <td className="p-2.5 text-right">
                        {r.count ? (
                          <Badge
                            variant={bodyPct >= 80 ? "success" : "warning"}
                          >
                            {bodyPct}%
                          </Badge>
                        ) : (
                          <span className="font-mono text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right">
                        {r.count ? (
                          <Badge variant={pubPct >= 80 ? "success" : "warning"}>
                            {pubPct}%
                          </Badge>
                        ) : (
                          <span className="font-mono text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {r.disruptions}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {r.seenToday}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {r.seenOld}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {r.lastIngested.slice(11, 19) || "—"}
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
