"use client";

import React, { useEffect, useState } from "react";
import type {
  EdgeTodoItem,
  EdgeUserProfile,
  GoldAlertCluster,
  LakehouseSnapshot,
} from "@/types/news";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haversineKm } from "@/lib/utils";

const DEFAULT_PROFILE: EdgeUserProfile = {
  homeArea: "Mirpur-10",
  currentArea: "Mirpur-11",
  radiusKm: 4.5,
  watchedEvents: [
    "blockade",
    "strike",
    "procession",
    "clash",
    "fire",
    "waterlogging",
    "accident",
  ],
  todos: [
    {
      id: "todo-1",
      title: "Client Meeting at Motijheel Commercial Area",
      destinationArea: "Motijheel",
      viaAreas: ["Mirpur-10", "Agargaon", "Farmgate", "Shahbagh", "Paltan"],
      plannedTime: "10:00 AM",
      active: true,
    },
    {
      id: "todo-2",
      title: "Factory Inspection in Ashulia / Savar",
      destinationArea: "Ashulia",
      viaAreas: ["Mirpur-11", "Kalshi", "Uttara", "Abdullahpur"],
      plannedTime: "02:30 PM",
      active: true,
    },
  ],
};

const DETOUR_SUGGESTIONS: Record<string, string> = {
  "Mirpur-10":
    "Take MRT Line-6 (if open) or detour via Shewrapara – Rokeya Sarani / ECB Chattar.",
  "Mirpur-11":
    "Avoid Kalshi Road; detour via Pallabi Eastern Housing or Mirpur-12 DOHS link road.",
  Kalshi: "Avoid Kalshi Flyover ramp; use Matikata – ECB Chattar corridor.",
  Agargaon:
    "Detour via Bijoy Sarani elevated ramp or Shyamoli – Asad Gate Road.",
  Shahbagh:
    "Detour via Kataban – Nilkhet or Moghbazar – Kakrail flyover.",
  Motijheel:
    "Use Hatirjheel – Rampura circular road or MRT Line-6 to Motijheel station.",
  Ashulia:
    "Avoid Abdullahpur–Baipail highway; use Dhour – Birulia Bridge – Savar route.",
  Gazipur:
    "Avoid Naojor / Dhaka–Tangail highway; use Dhaka–Mymensingh highway via Tongi.",
};

interface Props {
  snapshot: LakehouseSnapshot | null;
}

export function MobileEdgeSimulator({ snapshot }: Props) {
  const [profile, setProfile] = useState<EdgeUserProfile>(DEFAULT_PROFILE);
  const [newTitle, setNewTitle] = useState("");
  const [newDest, setNewDest] = useState("Motijheel");
  const [newVia, setNewVia] = useState("Mirpur-10, Farmgate, Shahbagh");
  const [newTime, setNewTime] = useState("11:30 AM");

  // Load & persist private edge profile in localStorage (stays 100% on edge device!)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bigwarn_edge_profile_v2");
      if (saved) setProfile(JSON.parse(saved));
    } catch {}
  }, []);

  const updateProfile = (next: EdgeUserProfile) => {
    setProfile(next);
    try {
      localStorage.setItem("bigwarn_edge_profile_v2", JSON.stringify(next));
    } catch {}
  };

  const areas = snapshot
    ? Object.keys(snapshot.area_metadata).sort()
    : [
        "Mirpur-10",
        "Mirpur-11",
        "Kalshi",
        "Agargaon",
        "Farmgate",
        "Shahbagh",
        "Motijheel",
        "Uttara",
        "Ashulia",
        "Gazipur",
        "Narayanganj",
        "Chattogram",
      ];

  const goldAlerts = snapshot?.gold_alerts || [];
  const areaCoords = snapshot?.area_metadata || {};

  // Match alerts privately on the edge device against Current Location, Home Area & Planned Route To-Dos
  const currentCoords = areaCoords[profile.currentArea];
  const nearbyAlerts: Array<{ cluster: GoldAlertCluster; distKm: number }> = [];

  for (const cl of goldAlerts) {
    if (
      cl.area === profile.currentArea ||
      cl.area === profile.homeArea
    ) {
      nearbyAlerts.push({ cluster: cl, distKm: 0 });
    } else if (currentCoords) {
      const d = haversineKm(
        currentCoords.lat,
        currentCoords.lon,
        cl.lat,
        cl.lon
      );
      if (d <= profile.radiusKm) {
        nearbyAlerts.push({ cluster: cl, distKm: Number(d.toFixed(1)) });
      }
    }
  }

  const addTodo = () => {
    if (!newTitle.trim()) return;
    const item: EdgeTodoItem = {
      id: `todo-${Date.now()}`,
      title: newTitle.trim(),
      destinationArea: newDest,
      viaAreas: newVia
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      plannedTime: newTime,
      active: true,
    };
    updateProfile({ ...profile, todos: [item, ...profile.todos] });
    setNewTitle("");
  };

  const removeTodo = (id: string) => {
    updateProfile({
      ...profile,
      todos: profile.todos.filter((t) => t.id !== id),
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left Column: Mobile Edge Device Configuration (Private on Phone) */}
      <div className="space-y-4 lg:col-span-5">
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Badge variant="default">📱 EDGE DEVICE PRIVACY GUARD</Badge>
              <span className="font-mono text-[11px] text-muted-foreground">
                Stored in On-Device Storage
              </span>
            </div>
            <CardTitle className="mt-1 text-base">
              My Location & Geofence Settings
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Your address, live GPS location, and to-do schedule never leave
              your phone. The phone subscribes to area topics and matches alerts
              locally.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">
                  📍 Current Live Area
                </label>
                <select
                  value={profile.currentArea}
                  onChange={(e) =>
                    updateProfile({ ...profile, currentArea: e.target.value })
                  }
                  className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-xs"
                >
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">
                  🏠 Home / Base Area
                </label>
                <select
                  value={profile.homeArea}
                  onChange={(e) =>
                    updateProfile({ ...profile, homeArea: e.target.value })
                  }
                  className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-xs"
                >
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 flex justify-between font-medium text-muted-foreground">
                <span>📡 Proximity Alert Radius</span>
                <span className="font-mono text-foreground">
                  {profile.radiusKm} km
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={15}
                step={0.5}
                value={profile.radiusKm}
                onChange={(e) =>
                  updateProfile({
                    ...profile,
                    radiusKm: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-primary"
              />
            </div>
          </CardContent>
        </Card>

        {/* Add Planned Trip / To-Do Item */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              🗓️ Add Planned Trip / Edge To-Do
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              If any blockade, clash, or strike hits your destination or route
              corridor, BigWarn alerts you before you leave.
            </p>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-2 text-xs">
            <Input
              placeholder="To-Do Title (e.g. Go to Motijheel Office at 10 AM)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Destination Area
                </label>
                <select
                  value={newDest}
                  onChange={(e) => setNewDest(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-xs"
                >
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Planned Time
                </label>
                <Input
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  placeholder="10:00 AM"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                Route Waypoints (comma-separated areas crossed on the way)
              </label>
              <Input
                value={newVia}
                onChange={(e) => setNewVia(e.target.value)}
                placeholder="Mirpur-10, Agargaon, Farmgate, Shahbagh"
              />
            </div>
            <Button onClick={addTodo} className="w-full">
              + Save To-Do Plan on Device
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Right Column: Live Edge Push Alerts & Route Corridor Matcher */}
      <div className="space-y-4 lg:col-span-7">
        {/* 1. Immediate Proximity Alerts for Current / Home Location */}
        <Card className="border-l-4 border-l-destructive">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                🚨 Live Proximity Push Alerts ({nearbyAlerts.length})
              </CardTitle>
              <Badge variant="location">
                Near {profile.currentArea} (≤ {profile.radiusKm} km)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-2">
            {nearbyAlerts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                ✅ No active disruptions reported within {profile.radiusKm} km
                of <b>{profile.currentArea}</b> or <b>{profile.homeArea}</b>.
              </div>
            ) : (
              nearbyAlerts.slice(0, 6).map(({ cluster, distKm }) => (
                <div
                  key={cluster.cluster_id}
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="destructive">
                        ⚠️ {cluster.event_type.toUpperCase()}
                      </Badge>
                      <Badge variant="location">📍 {cluster.area}</Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {distKm === 0
                          ? "In your area"
                          : `${distKm} km from ${profile.currentArea}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={
                          cluster.source_count >= 2 || cluster.is_pre_news_crowd ? "success" : "warning"
                        }
                      >
                        {Math.round(cluster.credibility_score * 100)}% veracity
                      </Badge>
                      <Badge variant="outline">
                        👥 {cluster.crowd_metrics?.gathering_size ?? 260}+ crowd ({cluster.crowd_metrics?.surge_ratio ?? 2.6}x surge • +{cluster.crowd_metrics?.crowd_weight_percent ?? 14}% weight)
                      </Badge>
                      {cluster.is_pre_news_crowd && (
                        <Badge variant="default">⚡ Pre-News Crowd Alert</Badge>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 font-semibold text-foreground">
                    {cluster.sample_headline}
                  </p>
                  {DETOUR_SUGGESTIONS[cluster.area] && (
                    <div className="mt-1.5 rounded bg-card/80 px-2.5 py-1.5 text-[11px] text-primary">
                      🧭 <b>Suggested Detour:</b>{" "}
                      {DETOUR_SUGGESTIONS[cluster.area]}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 2. Planned To-Do Route Impact Checker */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              🗺️ Planned To-Do & Route Corridor Impact Analysis
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Checks every waypoint along your planned trips against real-time
              Spark Gold disruption clusters.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {profile.todos.map((todo) => {
              const allRouteAreas = [
                profile.currentArea,
                ...todo.viaAreas,
                todo.destinationArea,
              ];
              const hits = goldAlerts.filter((g) =>
                allRouteAreas.includes(g.area)
              );
              const impactedAreas = Array.from(
                new Set(hits.map((h) => h.area))
              );

              return (
                <div
                  key={todo.id}
                  className={`rounded-xl border p-3.5 text-xs ${
                    hits.length > 0
                      ? "border-warning/50 bg-warning/5"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-[11px] font-semibold text-primary">
                        🕒 {todo.plannedTime}
                      </span>{" "}
                      <span className="text-sm font-semibold">
                        {todo.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hits.length > 0 ? (
                        <Badge variant="destructive">
                          ⚠️ {hits.length} Route Disruption(s)
                        </Badge>
                      ) : (
                        <Badge variant="success">✅ Route Clear</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTodo(todo.id)}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>

                  {/* Route chain visual */}
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                    {allRouteAreas.map((area, idx) => {
                      const isHit = impactedAreas.includes(area);
                      return (
                        <React.Fragment key={`${area}-${idx}`}>
                          <span
                            className={`rounded px-2 py-0.5 font-medium ${
                              isHit
                                ? "bg-destructive text-destructive-foreground"
                                : "bg-secondary text-secondary-foreground"
                            }`}
                          >
                            {isHit ? "🚧 " : ""}
                            {area}
                          </span>
                          {idx < allRouteAreas.length - 1 && (
                            <span className="text-muted-foreground">→</span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {hits.length > 0 && (
                    <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2">
                      {hits.slice(0, 3).map((h) => (
                        <div
                          key={h.cluster_id}
                          className="flex flex-col gap-0.5 rounded bg-card p-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-destructive">
                              ⚠️ {h.event_type.toUpperCase()} at {h.area} (
                              {h.source_count} sources:{" "}
                              {h.sources.slice(0, 3).join(", ")})
                            </span>
                            {h.time_windows.length > 0 && (
                              <span className="font-mono text-[10px]">
                                🕒 {h.time_windows.join(", ")}
                              </span>
                            )}
                          </div>
                          <span className="text-muted-foreground">
                            “{h.sample_headline}”
                          </span>
                          {DETOUR_SUGGESTIONS[h.area] && (
                            <span className="font-medium text-primary">
                              💡 Alternate Route: {DETOUR_SUGGESTIONS[h.area]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

