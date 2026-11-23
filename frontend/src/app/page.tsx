"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DebugPayload, LakehouseSnapshot, NewsArticle } from "@/types/news";
import { MedallionExplorer } from "@/components/features/lakehouse/medallion-explorer";
import { MobileEdgeSimulator } from "@/components/features/edge-pwa/mobile-edge-simulator";
import { SiteMatrixAndLogs } from "@/components/features/debug/site-matrix-and-logs";

type ActiveTab = "stream" | "lakehouse" | "matrix" | "edge";
type SortOption =
  | "updated"
  | "published"
  | "ingested"
  | "ingested_asc"
  | "words_desc"
  | "words_asc"
  | "lag_desc"
  | "lag_asc";

function getLagMinutes(art: NewsArticle): number | null {
  if (typeof art.lag_minutes === "number") return art.lag_minutes;
  const pub = art.published_at || art.published;
  const ing = art.crawled_at || art.ingested_at;
  if (!pub || !ing) return null;
  const p = new Date(pub).getTime();
  const i = new Date(ing).getTime();
  if (isNaN(p) || isNaN(i)) return null;
  return Math.round((i - p) / 60000);
}

function fmtShortTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.toISOString().slice(0, 10)} ${hh}:${mm}`;
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q || !text) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, idx) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark
            key={idx}
            className="bg-[#3b3820] text-[#ecebe6] px-0.5 rounded font-semibold"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("stream");
  const [days, setDays] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [items, setItems] = useState<NewsArticle[]>([]);
  const [lakehouse, setLakehouse] = useState<LakehouseSnapshot | null>(null);
  const [debugData, setDebugData] = useState<DebugPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [paused, setPaused] = useState<boolean>(false);

  // Python-dashboard matching filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortOption>("updated");
  const [selectedLang, setSelectedLang] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<string>("all");
  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [debugFilter, setDebugFilter] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);

  const activeFilterCount = [
    selectedLang !== "all",
    selectedEvent !== "all",
    selectedArea !== "all",
    selectedSection !== "all",
    debugFilter !== "all",
    selectedSource !== "all",
  ].filter(Boolean).length;

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Keyboard shortcut: `/` focuses search (just like Python dashboard)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 1. Load available days
  useEffect(() => {
    async function loadDays() {
      try {
        const res = await fetch("/api/days");
        if (!res.ok) return;
        const json = await res.json();
        const availableDays = (json.days || []) as string[];
        setDays(availableDays);
        if (availableDays.length > 0) {
          setSelectedDay(availableDays[0]);
        }
      } catch (e) {
        console.error("Error loading days:", e);
      }
    }
    loadDays();
  }, []);

  // 2. Refresh data for selected day
  const refreshDayData = async (day: string) => {
    if (!day) return;
    try {
      const [itemsRes, lakeRes, debugRes] = await Promise.all([
        fetch(`/api/items?date=${day}`),
        fetch(`/api/lakehouse?date=${day}`),
        fetch(`/api/debug?date=${day}`),
      ]);
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        setItems(data.items || []);
      }
      if (lakeRes.ok) {
        const data = await lakeRes.json();
        setLakehouse(data);
      }
      if (debugRes.ok) {
        const data = await debugRes.json();
        setDebugData(data);
      }
    } catch (err) {
      console.error("Error refreshing data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDay) {
      setLoading(true);
      refreshDayData(selectedDay);
    }
  }, [selectedDay]);

  useEffect(() => {
    if (paused || !selectedDay) return;
    const timer = setInterval(() => {
      refreshDayData(selectedDay);
    }, 6000);
    return () => clearInterval(timer);
  }, [paused, selectedDay]);

  // Dynamic facet lists
  const uniqueAreas = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((it) => {
      (it.locations || []).forEach((loc) =>
        counts.set(loc, (counts.get(loc) || 0) + 1)
      );
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const uniqueSections = useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => {
      if (it.section) s.add(it.section);
    });
    return Array.from(s).sort();
  }, [items]);

  const sourceCounts = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((it) => {
      if (it.source) map.set(it.source, (map.get(it.source) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // Filter & sort logic matching Python dashboard
  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items
      .filter((it) => {
        if (q) {
          const hay = [
            it.headline || it.title || "",
            it.description || "",
            it.body || it.body_text || "",
            it.url || "",
            it.source || "",
            it.author || "",
            it.section || "",
            ...(it.locations || []),
            ...(it.keywords || []),
            ...(it.event_types || []),
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }

        if (selectedLang !== "all" && (it.lang || it.language) !== selectedLang) {
          return false;
        }

        if (selectedEvent === "any_disruption") {
          if (!it.is_disruption && !(it.event_types || []).length) return false;
        } else if (selectedEvent !== "all") {
          if (!(it.event_types || []).includes(selectedEvent as any)) return false;
        }

        if (selectedArea !== "all") {
          if (!(it.locations || []).includes(selectedArea)) return false;
        }

        if (selectedSection !== "all" && it.section !== selectedSection) {
          return false;
        }

        if (selectedSource !== "all" && it.source !== selectedSource) {
          return false;
        }

        const wc = it.word_count || 0;
        if (debugFilter === "missing_body" && wc >= 30) return false;
        if (debugFilter === "missing_pub" && (it.published || it.published_at))
          return false;
        if (debugFilter === "missing_upd" && it.updated) return false;
        if (debugFilter === "dups_only" && !it.duplicate_of) return false;
        if (debugFilter === "loc_tagged" && !(it.locations || []).length)
          return false;
        if (debugFilter === "untagged" && (it.locations || []).length > 0)
          return false;

        return true;
      })
      .sort((a, b) => {
        const pubA = a.published || a.published_at || "";
        const pubB = b.published || b.published_at || "";
        const updA = a.updated || pubA || a.ingested_at || "";
        const updB = b.updated || pubB || b.ingested_at || "";
        const ingA = a.ingested_at || a.crawled_at || "";
        const ingB = b.ingested_at || b.crawled_at || "";
        const wcA = a.word_count || 0;
        const wcB = b.word_count || 0;
        const lagA = getLagMinutes(a);
        const lagB = getLagMinutes(b);

        switch (sortBy) {
          case "updated":
            return updB.localeCompare(updA);
          case "published":
            return pubB.localeCompare(pubA);
          case "ingested":
            return ingB.localeCompare(ingA) || (b._seq || 0) - (a._seq || 0);
          case "ingested_asc":
            return ingA.localeCompare(ingB) || (a._seq || 0) - (b._seq || 0);
          case "words_desc":
            return wcB - wcA;
          case "words_asc":
            return wcA - wcB;
          case "lag_desc":
            return (lagB ?? -99999) - (lagA ?? -99999);
          case "lag_asc":
            return (lagA ?? 99999) - (lagB ?? 99999);
          default:
            return 0;
        }
      });
  }, [
    items,
    searchQuery,
    selectedLang,
    selectedEvent,
    selectedArea,
    selectedSection,
    selectedSource,
    debugFilter,
    sortBy,
  ]);

  // Stats counters matching Python dashboard
  const stats = useMemo(() => {
    const disruptions = items.filter(
      (i) => i.is_disruption || (i.event_types || []).length > 0
    ).length;
    const enCount = items.filter((i) => (i.lang || i.language) === "en").length;
    const bnCount = items.length - enCount;
    const avgWords = items.length
      ? Math.round(
          items.reduce((acc, i) => acc + (i.word_count || 0), 0) / items.length
        )
      : 0;
    return {
      total: items.length,
      showing: filteredArticles.length,
      disruptions,
      enCount,
      bnCount,
      avgWords,
      sources: sourceCounts.length,
    };
  }, [items, filteredArticles, sourceCounts]);

  const exportFilteredJsonl = () => {
    const content =
      filteredArticles.map((it) => JSON.stringify(it)).join("\n") + "\n";
    const blob = new Blob([content], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bigwarn_stream_${selectedDay || "export"}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#121312] text-[#ecebe6] text-[14.5px] leading-[1.45] pb-20 sm:pb-8">
      {/* Sticky Responsive Header */}
      <header className="sticky top-0 z-20 bg-[#121312]/95 backdrop-blur border-b border-[#2e312e] px-3 sm:px-4 py-2 sm:py-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
        <div className="mx-auto max-w-[1280px]">
          <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-[15.5px] sm:text-[17px] font-bold tracking-[-0.2px] text-[#ecebe6] m-0 truncate">
                Bangladesh news stream
              </h1>

              <span className="inline-flex items-center gap-1.5 text-[11.5px] sm:text-[12.5px] text-[#9a988f] bg-[#1c1e1c] px-2 sm:px-2.5 py-0.5 rounded-full border border-[#2e312e] shrink-0">
                <span
                  className={`w-2 h-2 rounded-full ${
                    paused ? "bg-[#9a988f]" : "bg-[#4fc59a] animate-pulse"
                  }`}
                />
                <span>
                  {loading
                    ? "loading…"
                    : paused
                    ? "paused"
                    : `${items.length} items`}
                </span>
              </span>
            </div>

            {/* Desktop Segmented Tab Switcher (hidden on phone; phone uses fixed bottom nav bar) */}
            <div className="hidden sm:inline-flex bg-[#262926] p-[3px] rounded-[9px] border border-[#2e312e] gap-0.5 flex-wrap">
              <button
                onClick={() => setActiveTab("stream")}
                className={`border-0 text-[12.5px] font-semibold px-2.5 py-1 rounded-[6px] cursor-pointer transition-colors ${
                  activeTab === "stream"
                    ? "bg-[#1c1e1c] text-[#ecebe6] shadow-sm"
                    : "bg-transparent text-[#9a988f] hover:text-[#ecebe6]"
                }`}
              >
                📰 Stream &amp; Inspector
              </button>
              <button
                onClick={() => setActiveTab("lakehouse")}
                className={`border-0 text-[12.5px] font-semibold px-2.5 py-1 rounded-[6px] cursor-pointer transition-colors ${
                  activeTab === "lakehouse"
                    ? "bg-[#1c1e1c] text-[#ecebe6] shadow-sm"
                    : "bg-transparent text-[#9a988f] hover:text-[#ecebe6]"
                }`}
              >
                🏛️ Lakehouse (ELT)
              </button>
              <button
                onClick={() => setActiveTab("matrix")}
                className={`border-0 text-[12.5px] font-semibold px-2.5 py-1 rounded-[6px] cursor-pointer transition-colors ${
                  activeTab === "matrix"
                    ? "bg-[#1c1e1c] text-[#ecebe6] shadow-sm"
                    : "bg-transparent text-[#9a988f] hover:text-[#ecebe6]"
                }`}
              >
                📊 Site Matrix &amp; Logs
              </button>
              <button
                onClick={() => setActiveTab("edge")}
                className={`border-0 text-[12.5px] font-semibold px-2.5 py-1 rounded-[6px] cursor-pointer transition-colors ${
                  activeTab === "edge"
                    ? "bg-[#1c1e1c] text-[#ecebe6] shadow-sm"
                    : "bg-transparent text-[#9a988f] hover:text-[#ecebe6]"
                }`}
              >
                📱 Edge Simulator
              </button>
            </div>

            <div className="hidden lg:block flex-1" />

            {/* Right Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="text-[12px] sm:text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] px-2 sm:px-2.5 py-1 focus:outline-none focus:border-[#4fc59a]"
                title="Day"
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <button
                onClick={() => setPaused((p) => !p)}
                className="text-[12px] sm:text-[13px] font-medium text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] hover:border-[#4fc59a] rounded-[7px] px-2 sm:px-2.5 py-1 cursor-pointer"
              >
                {paused ? "Resume" : "Pause"}
              </button>

              <button
                onClick={exportFilteredJsonl}
                className="hidden sm:inline-block text-[13px] font-medium text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] hover:border-[#4fc59a] rounded-[7px] px-2.5 py-1 cursor-pointer"
                title="Download currently filtered articles as JSONL"
              >
                ⬇ Export JSONL
              </button>

              <Link
                href="/download"
                className="text-[12px] sm:text-[13px] font-semibold text-[#121312] bg-[#4fc59a] hover:opacity-90 rounded-[7px] px-2 sm:px-2.5 py-1 no-underline whitespace-nowrap"
              >
                📱 <span className="hidden xs:inline">Get </span>APK
              </Link>
            </div>
          </div>

          {/* Search, Sort & Debug Filters Toolbar */}
          {activeTab === "stream" && (
            <>
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-dashed border-[#2e312e]">
                <div className="relative flex-1 min-w-0 inline-flex items-center">
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search headline, area, keyword…"
                    className="w-full text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] pl-2.5 pr-7 py-1.5 focus:outline-none focus:border-[#4fc59a]"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-1.5 bg-transparent border-0 text-[#9a988f] hover:text-[#ecebe6] text-sm px-1 cursor-pointer"
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Mobile Filter Toggle Button */}
                <button
                  onClick={() => setMobileFiltersOpen((v) => !v)}
                  className={`sm:hidden inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-[7px] border cursor-pointer shrink-0 ${
                    mobileFiltersOpen || activeFilterCount > 0
                      ? "bg-[#4fc59a]/15 border-[#4fc59a] text-[#4fc59a]"
                      : "bg-[#1c1e1c] border-[#2e312e] text-[#ecebe6]"
                  }`}
                >
                  <span>⚙️ Filters</span>
                  {activeFilterCount > 0 && (
                    <span className="bg-[#4fc59a] text-[#121312] rounded-full px-1.5 text-[10.5px] font-bold">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Filter Selects: Collapsible 2-col grid on mobile, inline flex-wrap on desktop */}
              <div
                className={`${
                  mobileFiltersOpen ? "grid grid-cols-2 gap-1.5 mt-2" : "hidden"
                } sm:flex sm:flex-wrap sm:gap-[7px] sm:items-center sm:mt-2`}
              >
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="w-full sm:w-auto text-[12.5px] sm:text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] px-2 py-1.5 focus:outline-none focus:border-[#4fc59a]"
                >
                  <option value="updated">Sort: Latest updated</option>
                  <option value="published">Sort: Latest published</option>
                  <option value="ingested">Sort: Arrival (newest first)</option>
                  <option value="ingested_asc">Sort: Arrival (oldest first)</option>
                  <option value="words_desc">Sort: Word count (high → low)</option>
                  <option value="words_asc">Sort: Word count (low → high / debug)</option>
                  <option value="lag_desc">Sort: Ingestion lag (slowest first)</option>
                  <option value="lag_asc">Sort: Ingestion lag (fastest first)</option>
                </select>

                <select
                  value={selectedLang}
                  onChange={(e) => setSelectedLang(e.target.value)}
                  className="w-full sm:w-auto text-[12.5px] sm:text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] px-2 py-1.5 focus:outline-none focus:border-[#4fc59a]"
                >
                  <option value="all">Lang: All (EN+BN)</option>
                  <option value="en">English (EN)</option>
                  <option value="bn">Bangla (BN)</option>
                </select>

                <select
                  value={selectedEvent}
                  onChange={(e) => setSelectedEvent(e.target.value)}
                  className="w-full sm:w-auto text-[12.5px] sm:text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] px-2 py-1.5 focus:outline-none focus:border-[#4fc59a]"
                >
                  <option value="all">Events: All news</option>
                  <option value="any_disruption">⚠️ All Disruptions / Threats</option>
                  <option value="gunfire">🔫 Gunfire / Bomb Blast</option>
                  <option value="murder">🩸 Murder / Violent Crime</option>
                  <option value="fire">🔥 Fire / Arson</option>
                  <option value="clash">⚡ Clash / Violence</option>
                  <option value="blockade">🚧 Blockade</option>
                  <option value="strike">🛑 Strike / Hartal</option>
                  <option value="procession">📢 Procession / Protest</option>
                  <option value="accident">💥 Accident</option>
                  <option value="waterlogging">🌊 Waterlogging</option>
                  <option value="power_outage">🔌 Power Outage</option>
                </select>

                <select
                  value={selectedArea}
                  onChange={(e) => setSelectedArea(e.target.value)}
                  className="w-full sm:w-auto text-[12.5px] sm:text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] px-2 py-1.5 focus:outline-none focus:border-[#4fc59a]"
                >
                  <option value="all">Area: All locations</option>
                  {uniqueAreas.map(([loc, cnt]) => (
                    <option key={loc} value={loc}>
                      {loc} ({cnt})
                    </option>
                  ))}
                </select>

                <select
                  value={selectedSection}
                  onChange={(e) => setSelectedSection(e.target.value)}
                  className="w-full sm:w-auto text-[12.5px] sm:text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] px-2 py-1.5 focus:outline-none focus:border-[#4fc59a] sm:max-w-[140px]"
                >
                  <option value="all">Section: All</option>
                  {uniqueSections.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec}
                    </option>
                  ))}
                </select>

                <select
                  value={debugFilter}
                  onChange={(e) => setDebugFilter(e.target.value)}
                  className="w-full sm:w-auto text-[12.5px] sm:text-[13px] text-[#ecebe6] bg-[#1c1e1c] border border-[#2e312e] rounded-[7px] px-2 py-1.5 focus:outline-none focus:border-[#4fc59a]"
                >
                  <option value="all">Debug: All items</option>
                  <option value="missing_body">🐛 Missing/short body (&lt;30w)</option>
                  <option value="missing_pub">🐛 Missing published date</option>
                  <option value="missing_upd">🐛 Missing updated date</option>
                  <option value="dups_only">🔁 Duplicates only</option>
                  <option value="loc_tagged">📍 Location-tagged</option>
                  <option value="untagged">❓ Untagged</option>
                </select>
              </div>

              {/* Stats Bar: Horizontal scroll strip on mobile, wrap on desktop */}
              <div className="flex overflow-x-auto sm:flex-wrap gap-2 sm:gap-x-3 sm:gap-y-2 items-center mt-2 text-[11.5px] sm:text-[12.5px] text-[#9a988f] no-scrollbar">
                <span className="bg-[#1c1e1c] border border-[#2e312e] rounded-[6px] px-2 py-0.5 whitespace-nowrap">
                  Total: <b className="text-[#ecebe6] font-mono">{stats.total}</b>
                </span>
                <span className="bg-[#1c1e1c] border border-[#2e312e] rounded-[6px] px-2 py-0.5 whitespace-nowrap">
                  Showing: <b className="text-[#ecebe6] font-mono">{stats.showing}</b>
                </span>
                <span className="bg-[#1c1e1c] border border-[#2e312e] rounded-[6px] px-2 py-0.5 whitespace-nowrap">
                  Disruptions: <b className="text-[#f87171] font-mono">{stats.disruptions}</b>
                </span>
                <span className="bg-[#1c1e1c] border border-[#2e312e] rounded-[6px] px-2 py-0.5 whitespace-nowrap">
                  Avg Words: <b className="text-[#4ade80] font-mono">{stats.avgWords}</b>
                </span>
                <span className="bg-[#1c1e1c] border border-[#2e312e] rounded-[6px] px-2 py-0.5 whitespace-nowrap">
                  EN/BN:{" "}
                  <b className="text-[#ecebe6] font-mono">
                    {stats.enCount}/{stats.bnCount}
                  </b>
                </span>
                <span className="bg-[#1c1e1c] border border-[#2e312e] rounded-[6px] px-2 py-0.5 whitespace-nowrap">
                  Sources: <b className="text-[#ecebe6] font-mono">{stats.sources}</b>
                </span>
              </div>

              {/* Interactive Newspaper Source Chips: Horizontal swipe on mobile, wrap on desktop */}
              {sourceCounts.length > 0 && (
                <div
                  className={`${
                    mobileFiltersOpen ? "flex" : "hidden sm:flex"
                  } items-center gap-1.5 mt-2 overflow-x-auto sm:flex-wrap pb-0.5`}
                >
                  <button
                    onClick={() => setSelectedSource("all")}
                    className={`border rounded-full px-2.5 py-0.5 text-[11.5px] sm:text-[12px] cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                      selectedSource === "all"
                        ? "bg-[#4fc59a] border-[#4fc59a] text-[#121312] font-bold"
                        : "bg-[#262926] border-[#2e312e] text-[#ecebe6] hover:border-[#4fc59a]"
                    }`}
                  >
                    All <b className="ml-1 font-mono">{items.length}</b>
                  </button>
                  {sourceCounts.slice(0, 18).map(([src, cnt]) => (
                    <button
                      key={src}
                      onClick={() =>
                        setSelectedSource(selectedSource === src ? "all" : src)
                      }
                      className={`border rounded-full px-2.5 py-0.5 text-[11.5px] sm:text-[12px] cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                        selectedSource === src
                          ? "bg-[#4fc59a] border-[#4fc59a] text-[#121312] font-bold"
                          : "bg-[#262926] border-[#2e312e] text-[#ecebe6] hover:border-[#4fc59a]"
                      }`}
                    >
                      {src} <b className="ml-1 font-mono">{cnt}</b>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-[1280px] mt-3.5 mb-16 px-4">
        {activeTab === "stream" && (
          <div>
            {filteredArticles.length === 0 ? (
              <div className="text-center text-[#9a988f] py-12">
                {loading
                  ? "Connecting to Bangladesh news stream…"
                  : "No matching articles for current filters."}
              </div>
            ) : (
              filteredArticles.slice(0, 250).map((it, idx) => {
                const isDisrupt =
                  it.is_disruption || (it.event_types || []).length > 0;
                const lag = getLagMinutes(it);
                const wc = it.word_count || 0;
                const headline = it.headline || it.title || "";
                const desc = it.description || it.body_preview || "";
                const bodyText = it.body || it.body_text || "";

                return (
                  <article
                    key={`${it.url}-${idx}`}
                    className={`bg-[#1c1e1c] border border-[#2e312e] hover:border-[#4fc59a] rounded-[11px] px-3.5 py-2.5 mb-2.5 transition-colors ${
                      isDisrupt ? "border-l-4 border-l-[#f87171]" : ""
                    }`}
                  >
                    {/* Meta Row */}
                    <div className="flex flex-wrap gap-x-2 gap-y-1 text-[12px] text-[#9a988f] items-center">
                      <span className="font-mono text-[11px] bg-[#262926] px-1.5 rounded">
                        #{it._seq || idx + 1}
                      </span>
                      <span className="font-bold text-[#4fc59a]">
                        {it.source}
                      </span>
                      <span className="border border-[#2e312e] rounded px-1.5 text-[10.5px] font-bold uppercase font-mono">
                        {it.lang || it.language || "en"}
                      </span>
                      {it.section && (
                        <span className="text-[#9a988f]">{it.section}</span>
                      )}

                      {(it.event_types || []).map((ev) => (
                        <span
                          key={ev}
                          className="bg-[#3b1818] text-[#f87171] border border-[#f87171] rounded-[5px] px-1.5 text-[11px] font-semibold"
                        >
                          {ev}
                        </span>
                      ))}

                      {(it.locations || []).map((loc) => (
                        <button
                          key={loc}
                          onClick={() => setSelectedArea(loc)}
                          className="bg-[#172554] text-[#60a5fa] rounded-[5px] px-1.5 text-[11px] font-semibold border-0 cursor-pointer hover:opacity-80"
                        >
                          📍 {loc}
                        </button>
                      ))}

                      <span
                        className={`rounded-[5px] px-1.5 text-[11px] font-mono ${
                          wc >= 30
                            ? "bg-[#142e1f] text-[#4ade80]"
                            : "bg-[#38260c] text-[#fbbf24]"
                        }`}
                      >
                        {wc}w
                      </span>

                      {lag !== null && (
                        <span
                          className={`rounded-[5px] px-1.5 text-[11px] font-mono ${
                            lag <= 20
                              ? "bg-[#142e1f] text-[#4ade80]"
                              : lag <= 90
                              ? "bg-[#38260c] text-[#fbbf24]"
                              : "bg-[#3b1818] text-[#f87171]"
                          }`}
                        >
                          +{lag}m lag
                        </span>
                      )}

                      {it.duplicate_of && (
                        <span className="border border-[#2e312e] rounded-[5px] px-1.5 text-[11px]">
                          dup: {it.duplicate_of}
                        </span>
                      )}

                      <span className="ml-auto font-mono text-[11px]">
                        pub: {fmtShortTime(it.published || it.published_at)}
                        {it.updated ? (
                          <span className="text-[#4fc59a] font-semibold ml-2">
                            upd: {fmtShortTime(it.updated)}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    {/* Headline */}
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block my-1 text-[16px] font-semibold text-[#ecebe6] hover:underline no-underline"
                    >
                      <HighlightText text={headline} query={searchQuery} />
                    </a>

                    {/* Description */}
                    {desc && (
                      <p className="text-[#9a988f] text-[13.5px] m-0">
                        <HighlightText text={desc} query={searchQuery} />
                      </p>
                    )}

                    {/* Debug & Inspector Row */}
                    <div className="flex flex-wrap gap-2 items-center mt-2 pt-1.5 border-t border-[#2e312e] text-[12px]">
                      <span className="font-mono text-[11.5px] text-[#9a988f] break-all flex-1">
                        {it.url}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-3 text-[12px]">
                      {bodyText && (
                        <details className="w-full">
                          <summary className="cursor-pointer text-[#4fc59a] font-semibold select-none inline-block">
                            📄 Full Body ({wc} words)
                          </summary>
                          <div className="mt-1.5 p-2.5 bg-[#121312] border border-[#2e312e] rounded-[8px] whitespace-pre-line leading-[1.55] max-h-[360px] overflow-auto text-[13px] text-[#ecebe6]">
                            <HighlightText text={bodyText} query={searchQuery} />
                          </div>
                        </details>
                      )}

                      <details className="w-full">
                        <summary className="cursor-pointer text-[#4fc59a] font-semibold select-none inline-block">
                          {"{ }"} Raw JSON
                        </summary>
                        <div className="mt-1.5 p-2.5 bg-[#121312] border border-[#2e312e] rounded-[8px]">
                          <div className="flex justify-end mb-1.5">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  JSON.stringify(it, null, 2)
                                );
                                setCopiedUrl(it.url);
                                setTimeout(() => setCopiedUrl(null), 1500);
                              }}
                              className="text-[11px] font-mono bg-[#262926] border border-[#2e312e] hover:border-[#4fc59a] text-[#ecebe6] px-2 py-0.5 rounded cursor-pointer"
                            >
                              {copiedUrl === it.url ? "Copied!" : "Copy JSON"}
                            </button>
                          </div>
                          <pre className="font-mono text-[12px] leading-[1.45] whitespace-pre-wrap break-all max-h-[360px] overflow-auto text-[#4ade80] m-0">
                            {JSON.stringify(it, null, 2)}
                          </pre>
                        </div>
                      </details>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}

        {activeTab === "lakehouse" && (
          <MedallionExplorer
            snapshot={lakehouse}
            onSelectArea={(area) => {
              setSelectedArea(area);
              setActiveTab("stream");
            }}
          />
        )}

        {activeTab === "matrix" && debugData && (
          <SiteMatrixAndLogs
            items={items}
            debugData={debugData}
            onSelectSource={(source) => {
              setSelectedSource(source);
              setActiveTab("stream");
            }}
            onRefreshDebug={() => refreshDayData(selectedDay)}
          />
        )}

        {activeTab === "edge" && <MobileEdgeSimulator snapshot={lakehouse} />}
      </main>

      {/* Fixed Bottom Navigation Bar for Mobile Phones */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#181a18]/95 backdrop-blur border-t border-[#2e312e] px-2 py-1.5 grid grid-cols-4 gap-1 shadow-[0_-4px_12px_rgba(0,0,0,0.4)]">
        <button
          onClick={() => setActiveTab("stream")}
          className={`flex flex-col items-center justify-center py-1 rounded-[8px] border-0 text-[11px] font-semibold cursor-pointer ${
            activeTab === "stream"
              ? "bg-[#262926] text-[#4fc59a]"
              : "bg-transparent text-[#9a988f]"
          }`}
        >
          <span className="text-[14px]">📰</span>
          <span>Stream</span>
        </button>
        <button
          onClick={() => setActiveTab("lakehouse")}
          className={`flex flex-col items-center justify-center py-1 rounded-[8px] border-0 text-[11px] font-semibold cursor-pointer ${
            activeTab === "lakehouse"
              ? "bg-[#262926] text-[#4fc59a]"
              : "bg-transparent text-[#9a988f]"
          }`}
        >
          <span className="text-[14px]">🏛️</span>
          <span>Lakehouse</span>
        </button>
        <button
          onClick={() => setActiveTab("matrix")}
          className={`flex flex-col items-center justify-center py-1 rounded-[8px] border-0 text-[11px] font-semibold cursor-pointer ${
            activeTab === "matrix"
              ? "bg-[#262926] text-[#4fc59a]"
              : "bg-transparent text-[#9a988f]"
          }`}
        >
          <span className="text-[14px]">📊</span>
          <span>Matrix</span>
        </button>
        <button
          onClick={() => setActiveTab("edge")}
          className={`flex flex-col items-center justify-center py-1 rounded-[8px] border-0 text-[11px] font-semibold cursor-pointer ${
            activeTab === "edge"
              ? "bg-[#262926] text-[#4fc59a]"
              : "bg-transparent text-[#9a988f]"
          }`}
        >
          <span className="text-[14px]">📱</span>
          <span>Edge Sim</span>
        </button>
      </nav>
    </div>
  );
}
