import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  API_BASE_URL,
  DHAKA_PRESETS,
  FEED_ACCESS_TOKEN,
} from "./src/config/api";
import {
  CitySummary,
  Coordinates,
  GoldAlert,
  LakehouseLayerStats,
  MapAlertResponse,
  RouteAlertResponse,
} from "./src/types/alert";
import { OsmMapWebView, RouteRoadGeometry } from "./src/components/OsmMapWebView";
import { VeracityMeter } from "./src/components/VeracityMeter";
import { AreaDetailModal } from "./src/components/AreaDetailModal";
import {
  formatEventLabel,
  formatNewsTimestamp,
} from "./src/services/notifications";

type DrawerSnap = "off" | "half" | "full";
type DrawerTab = "route" | "all";

const RISK_META: Record<
  string,
  {
    color: string;
    accent: string;
    bg: string;
    border: string;
    label: string;
    icon: "warning" | "checkmark-circle";
  }
> = {
  BLOCKED: {
    color: "#991B1B",
    accent: "#DC2626",
    bg: "rgba(254, 242, 242, 0.96)",
    border: "#FCA5A5",
    label: "ROUTE ANOMALY • REROUTE ADVISED",
    icon: "warning",
  },
  HIGH_RISK: {
    color: "#92400E",
    accent: "#D97706",
    bg: "rgba(255, 251, 235, 0.96)",
    border: "#FCD34D",
    label: "HIGH RISK ALONG ROUTE",
    icon: "warning",
  },
  CAUTION: {
    color: "#854D0E",
    accent: "#CA8A04",
    bg: "rgba(254, 252, 232, 0.96)",
    border: "#FDE047",
    label: "CAUTION ON ROUTE",
    icon: "warning",
  },
  CLEAR: {
    color: "#065F46",
    accent: "#059669",
    bg: "rgba(236, 253, 245, 0.96)",
    border: "#6EE7B7",
    label: "ROUTE CLEAR",
    icon: "checkmark-circle",
  },
};

function pointToSegmentDistKm(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): { distKm: number; snapLat: number; snapLon: number } {
  const cosLat = Math.cos(((aLat + bLat) * 0.5 * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * cosLat;

  const bx = (bLon - aLon) * kmPerDegLon;
  const by = (bLat - aLat) * kmPerDegLat;
  const px = (pLon - aLon) * kmPerDegLon;
  const py = (pLat - aLat) * kmPerDegLat;

  const segLenSq = bx * bx + by * by;
  const t =
    segLenSq > 1e-8 ? Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq)) : 0;
  const projX = t * bx;
  const projY = t * by;
  return {
    distKm: Math.hypot(px - projX, py - projY),
    snapLat: aLat + t * (bLat - aLat),
    snapLon: aLon + t * (bLon - aLon),
  };
}

function minDistanceToPolylineKm(
  lat: number,
  lon: number,
  poly: number[][]
): { distKm: number; snapLat: number; snapLon: number } {
  if (!poly || poly.length === 0) {
    return { distKm: 9999, snapLat: lat, snapLon: lon };
  }
  if (poly.length === 1) {
    return pointToSegmentDistKm(
      lat,
      lon,
      poly[0][0],
      poly[0][1],
      poly[0][0],
      poly[0][1]
    );
  }
  let best = { distKm: 9999, snapLat: poly[0][0], snapLon: poly[0][1] };
  for (let i = 0; i < poly.length - 1; i++) {
    const info = pointToSegmentDistKm(
      lat,
      lon,
      poly[i][0],
      poly[i][1],
      poly[i + 1][0],
      poly[i + 1][1]
    );
    if (info.distKm < best.distKm) {
      best = info;
    }
  }
  return best;
}

export default function App() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isCompactPhone = (windowWidth || 390) < 380 || (windowHeight || 760) < 700;

  const [currentLocation, setCurrentLocation] = useState<Coordinates>(
    DHAKA_PRESETS.Dhanmondi
  );
  const [destination, setDestination] = useState<Coordinates>(
    DHAKA_PRESETS.Motijheel
  );
  const [todoText, setTodoText] = useState("Go to Motijheel");
  const [pinMode, setPinMode] = useState(false);

  const [routeAlerts, setRouteAlerts] = useState<GoldAlert[]>([]);
  const [allMapAlerts, setAllMapAlerts] = useState<GoldAlert[]>([]);
  const [riskLevel, setRiskLevel] = useState<string>("CLEAR");
  const [routeDistKm, setRouteDistKm] = useState<number>(0);
  const [routeDurationMin, setRouteDurationMin] = useState<number>(0);
  const [routeGeometry, setRouteGeometry] = useState<RouteRoadGeometry | null>(
    null
  );
  const [suppressedCount, setSuppressedCount] = useState<number>(0);
  const [layers, setLayers] = useState<LakehouseLayerStats | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>("ALL");
  const [availableCities, setAvailableCities] = useState<CitySummary[]>([]);
  const [streamStatus, setStreamStatus] = useState<"LIVE" | "SYNCING" | "OFFLINE">("SYNCING");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const [showAllOnMap, setShowAllOnMap] = useState<boolean>(true);
  const [topFiltersCollapsed, setTopFiltersCollapsed] = useState<boolean>(false);
  const [drawerSnap, setDrawerSnap] = useState<DrawerSnap>("off");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("route");
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [crowdModalOpen, setCrowdModalOpen] = useState<boolean>(false);
  const [crowdReportArea, setCrowdReportArea] = useState<string>("Mirpur-10");
  const [crowdReportEvent, setCrowdReportEvent] = useState<string>("fire");
  const [crowdReportSize, setCrowdReportSize] = useState<number>(300);
  const [crowdReportNote, setCrowdReportNote] = useState<string>("");
  const [localCrowdAlerts, setLocalCrowdAlerts] = useState<GoldAlert[]>([]);
  const [localVoteBoosts, setLocalVoteBoosts] = useState<
    Record<string, { confirm: number; clear: number }>
  >({});
  const [focusCoords, setFocusCoords] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    nonce: number;
  } | null>(null);
  const [fitRouteNonce, setFitRouteNonce] = useState<number>(0);

  const lastPollSigRef = useRef<string>("");

  // Draggable Bottom Drawer Geometry & Gesture Physics
  const safeHeight = Math.max(windowHeight || 760, 560);
  const maxDrawerHeight = Math.round(safeHeight * 0.78);
  const halfDrawerHeight = Math.round(safeHeight * 0.46);
  const collapsedDrawerHeight = Platform.OS === "ios" ? 84 : 74;

  const offsetFull = 0;
  const offsetHalf = Math.max(80, maxDrawerHeight - halfDrawerHeight);
  const offsetOff = Math.max(180, maxDrawerHeight - collapsedDrawerHeight);

  const translateY = useRef(new Animated.Value(offsetOff)).current;
  const currentOffsetRef = useRef<number>(offsetOff);
  const dragStartYRef = useRef<number>(offsetOff);
  const snapRef = useRef<DrawerSnap>("off");

  const snapDrawerTo = useCallback(
    (target: DrawerSnap) => {
      const toVal =
        target === "full"
          ? offsetFull
          : target === "half"
          ? offsetHalf
          : offsetOff;
      snapRef.current = target;
      currentOffsetRef.current = toVal;
      setDrawerSnap(target);
      Animated.spring(translateY, {
        toValue: toVal,
        useNativeDriver: true,
        damping: 22,
        stiffness: 210,
        mass: 0.85,
      }).start();
    },
    [offsetFull, offsetHalf, offsetOff, translateY]
  );

  // Keep resting position aligned if screen dimensions change
  useEffect(() => {
    const toVal =
      snapRef.current === "full"
        ? offsetFull
        : snapRef.current === "half"
        ? offsetHalf
        : offsetOff;
    currentOffsetRef.current = toVal;
    translateY.setValue(toVal);
  }, [offsetFull, offsetHalf, offsetOff, translateY]);

  const drawerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          translateY.stopAnimation((val) => {
            dragStartYRef.current = val;
          });
        },
        onPanResponderMove: (_, g) => {
          const next = Math.max(
            offsetFull,
            Math.min(offsetOff, dragStartYRef.current + g.dy)
          );
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, g) => {
          // Tap on handle area toggles open / off
          if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) {
            if (snapRef.current === "off") {
              snapDrawerTo("half");
            } else {
              snapDrawerTo("off");
            }
            return;
          }

          const endY = Math.max(
            offsetFull,
            Math.min(offsetOff, dragStartYRef.current + g.dy)
          );

          // Fast downward swipe -> drag to off (or half if coming from full)
          if (g.vy > 0.5) {
            if (snapRef.current === "full" && endY < offsetHalf && g.vy < 1.2) {
              snapDrawerTo("half");
            } else {
              snapDrawerTo("off");
            }
            return;
          }

          // Fast upward swipe -> open to half or full
          if (g.vy < -0.5) {
            if (snapRef.current === "off" && endY > offsetHalf * 0.65) {
              snapDrawerTo("half");
            } else {
              snapDrawerTo("full");
            }
            return;
          }

          // Snap to nearest resting point
          const dFull = Math.abs(endY - offsetFull);
          const dHalf = Math.abs(endY - offsetHalf);
          const dOff = Math.abs(endY - offsetOff);
          if (dFull <= dHalf && dFull <= dOff) {
            snapDrawerTo("full");
          } else if (dHalf <= dOff) {
            snapDrawerTo("half");
          } else {
            snapDrawerTo("off");
          }
        },
      }),
    [offsetFull, offsetHalf, offsetOff, snapDrawerTo, translateY]
  );

  const handleLocateMe = useCallback(
    async (flyTo: boolean = true) => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (flyTo) {
            setFocusCoords({
              lat: currentLocation.lat,
              lon: currentLocation.lon,
              zoom: 14,
              nonce: Date.now(),
            });
          }
          return;
        }
        const pos = await Location.getCurrentPositionAsync({});
        const next = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "My Location",
        };
        setCurrentLocation(next);
        if (flyTo) {
          setFocusCoords({
            lat: next.lat,
            lon: next.lon,
            zoom: 15,
            nonce: Date.now(),
          });
        }
      } catch {
        if (flyTo) {
          setFocusCoords({
            lat: currentLocation.lat,
            lon: currentLocation.lon,
            zoom: 14,
            nonce: Date.now(),
          });
        }
      }
    },
    [currentLocation.lat, currentLocation.lon]
  );

  useEffect(() => {
    handleLocateMe(false);
  }, []);

  const fetchAlerts = useCallback(
    async (manualSync: boolean = false) => {
      if (manualSync) {
        setIsSyncing(true);
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const routeParams = new URLSearchParams({
          date: "latest",
          cur_lat: String(currentLocation.lat),
          cur_lon: String(currentLocation.lon),
          dest_lat: String(destination.lat),
          dest_lon: String(destination.lon),
          todo: todoText,
          radius_km: "2.5",
          include_map: "1",
          city: selectedCity,
        });

        const headers: Record<string, string> = {};
        if (FEED_ACCESS_TOKEN) {
          headers.Authorization = `Bearer ${FEED_ACCESS_TOKEN}`;
        }

        const routeRes = await fetch(
          `${API_BASE_URL}/api/v1/alerts/route?${routeParams.toString()}`,
          { signal: controller.signal, headers }
        );

        if (!routeRes.ok) {
          setStreamStatus("OFFLINE");
          return;
        }

        const routeData: RouteAlertResponse = await routeRes.json();
        let mapAlerts = routeData.map_alerts;
        if (!mapAlerts) {
          const mapRes = await fetch(
            `${API_BASE_URL}/api/v1/alerts/map?date=latest&city=${encodeURIComponent(selectedCity)}`,
            { signal: controller.signal, headers }
          );
          if (mapRes.ok) {
            const mapData: MapAlertResponse = await mapRes.json();
            mapAlerts = mapData.alerts || [];
          }
        }

        // Client-side guard: reject any non-place random Bangla words if cached by an older server
        const isActualPlaceName = (area?: string) =>
          Boolean(area && /^[A-Za-z0-9\s.'()-]+$/.test(area) && area !== "Dhaka (General)");

        const nextRouteAlerts = (routeData.route_alerts || []).filter((a) =>
          isActualPlaceName(a.area)
        );
        const cleanMapAlerts = (mapAlerts || []).filter((a) =>
          isActualPlaceName(a.area)
        );

        const pollSig = [
          selectedCity,
          currentLocation.lat.toFixed(4),
          currentLocation.lon.toFixed(4),
          destination.lat.toFixed(4),
          destination.lon.toFixed(4),
          routeData.route_risk_level,
          routeData.route?.route_distance_km,
          nextRouteAlerts.map((a) => `${a.cluster_id}:${a.last_updated}`).join(","),
          cleanMapAlerts.length,
        ].join("|");

        setStreamStatus("LIVE");

        if (pollSig !== lastPollSigRef.current || manualSync) {
          lastPollSigRef.current = pollSig;
          setRouteAlerts(nextRouteAlerts);
          setRiskLevel(routeData.route_risk_level || "CLEAR");
          setRouteDistKm(routeData.route?.route_distance_km || 0);
          setRouteDurationMin(routeData.route?.duration_min || 0);
          setRouteGeometry({
            polyline: routeData.route?.polyline,
            alt_polyline: routeData.route?.alt_polyline,
            route_distance_km: routeData.route?.route_distance_km,
            duration_min: routeData.route?.duration_min,
            road_names: routeData.route?.road_names,
            danger_segments: (routeData.route?.danger_segments || []).filter((d) =>
              isActualPlaceName(d.area)
            ),
          });
          setSuppressedCount(
            Math.max(0, cleanMapAlerts.length - nextRouteAlerts.length)
          );
          setAllMapAlerts(cleanMapAlerts);
          setLayers(routeData.layers);
          if (routeData.available_cities) {
            setAvailableCities(
              routeData.available_cities.filter((c) => isActualPlaceName(c.city))
            );
          }
        }
      } catch {
        setStreamStatus("OFFLINE");
      } finally {
        clearTimeout(timeoutId);
        if (manualSync) {
          setIsSyncing(false);
        }
      }
    },
    [currentLocation, destination, todoText, selectedCity]
  );

  useEffect(() => {
    fetchAlerts(false);
    const timer = setInterval(() => fetchAlerts(false), 6000);
    return () => clearInterval(timer);
  }, [fetchAlerts]);

  const handleSelectPresetDest = (name: string) => {
    const preset = DHAKA_PRESETS[name];
    if (!preset) return;
    setDestination(preset);
    setTodoText(`Go to ${name}`);
    setPinMode(false);
    setFitRouteNonce((n) => n + 1);
  };

  const handleMapPin = (lat: number, lon: number) => {
    try {
      Vibration.vibrate(40);
    } catch {}
    let nearestLabel = "";
    let bestD = 999;
    Object.entries(DHAKA_PRESETS).forEach(([name, c]) => {
      const d = Math.hypot(c.lat - lat, c.lon - lon) * 111;
      if (d < bestD) {
        bestD = d;
        nearestLabel = name;
      }
    });
    const pinLabel =
      bestD <= 1.8 && nearestLabel
        ? `Pin near ${nearestLabel}`
        : `Pinned (${lat.toFixed(3)}, ${lon.toFixed(3)})`;

    setDestination({ lat, lon, label: pinLabel });
    setTodoText(pinLabel);
    setPinMode(false);
  };

  const handleFocusArea = (name: string) => {
    const preset = DHAKA_PRESETS[name];
    if (!preset) return;
    setFocusCoords({ lat: preset.lat, lon: preset.lon, zoom: 14, nonce: Date.now() });
  };

  const handleSelectCity = (city: string, lat?: number, lon?: number) => {
    setSelectedCity(city);
    if (city === "ALL") {
      setFocusCoords({ lat: 23.78, lon: 90.38, zoom: 7, nonce: Date.now() });
    } else if (lat && lon) {
      setFocusCoords({
        lat,
        lon,
        zoom: city.toLowerCase() === "dhaka" ? 12 : 11,
        nonce: Date.now(),
      });
    }
  };

  const handleCrowdVote = useCallback(
    async (area: string, eventType: string, vote: "confirm" | "clear") => {
      const k = `${area}:${eventType}`;
      setLocalVoteBoosts((prev) => {
        const cur = prev[k] || { confirm: 0, clear: 0 };
        return {
          ...prev,
          [k]: {
            confirm: cur.confirm + (vote === "confirm" ? 1 : 0),
            clear: cur.clear + (vote === "clear" ? 1 : 0),
          },
        };
      });
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (FEED_ACCESS_TOKEN) {
          headers.Authorization = `Bearer ${FEED_ACCESS_TOKEN}`;
        }
        await fetch(`${API_BASE_URL}/api/v1/crowd/vote`, {
          method: "POST",
          headers,
          body: JSON.stringify({ area, event_type: eventType, vote }),
        });
        fetchAlerts(true);
      } catch {}
    },
    [fetchAlerts]
  );

  const handleSubmitCrowdReport = useCallback(async () => {
    const preset = DHAKA_PRESETS[crowdReportArea] || DHAKA_PRESETS["Mirpur-10"];
    const size = crowdReportSize || 300;
    const surge = Number((size / 110).toFixed(1));
    const conf = Math.min(0.95, Number((0.64 + Math.min(0.26, size / 1800)).toFixed(2)));
    const pct = Math.round(conf * 100);
    const noteText =
      crowdReportNote.trim() ||
      `[Pre-News Public Gathering] ${size}+ people accumulated in ${crowdReportArea} (${surge}x density surge) — active ${crowdReportEvent.toUpperCase()} before media publication.`;

    const newPreNewsAlert: GoldAlert = {
      cluster_id: `crowd-local:${crowdReportArea}:${crowdReportEvent}`,
      date: "latest",
      area: crowdReportArea,
      city: "Dhaka",
      lat: preset.lat,
      lon: preset.lon,
      event_type: crowdReportEvent,
      severity: "CRITICAL",
      color: "#EF4444",
      credibility_score: conf,
      veracity_percent: pct,
      veracity_tier: "HIGH",
      veracity_status: "PRE-NEWS CROWD SURGE",
      veracity_summary: `Crowd Alert (${size}+ gathered • ${surge}x surge • Citizen verified)`,
      source_count: 0,
      sources: ["Public Crowd-Sensing", "Citizen Gathering Telemetry"],
      languages: ["bn", "en"],
      time_windows: ["Live Gathering"],
      last_updated: new Date().toISOString(),
      age_minutes: 1,
      is_recent_3h: true,
      is_pre_news_crowd: true,
      alert_origin: "PRE_NEWS_CROWD",
      crowd_metrics: {
        gathering_size: size,
        baseline_size: 110,
        surge_ratio: surge,
        avg_speed_kmh: 1.4,
        gathering_radius_m: 155,
        citizen_reports: 15,
        confirm_votes: 22,
        clear_votes: 0,
        crowd_weight_bonus: Number((conf - 0.45).toFixed(2)),
        crowd_weight_percent: Math.round((conf - 0.45) * 100),
        pre_news_lead_minutes: 21,
        crowd_status: `PRE-NEWS CROWD SURGE (${size}+ gathered • ${surge}x density)`,
        is_pre_news_crowd: true,
      },
      sample_headline: noteText,
      articles: [
        {
          headline: noteText,
          source: `Public Gathering Telemetry (${size}+ Crowd Surge)`,
          lang: "en",
          url: "",
          published: new Date().toISOString(),
          ingested_at: new Date().toISOString(),
        },
      ],
    };

    setLocalCrowdAlerts((prev) => [
      newPreNewsAlert,
      ...prev.filter((p) => p.cluster_id !== newPreNewsAlert.cluster_id),
    ]);
    setCrowdModalOpen(false);
    setCrowdReportNote("");
    setFocusCoords({
      lat: preset.lat,
      lon: preset.lon,
      zoom: 14,
      nonce: Date.now(),
    });

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (FEED_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${FEED_ACCESS_TOKEN}`;
      }
      await fetch(`${API_BASE_URL}/api/v1/crowd/report`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          area: crowdReportArea,
          event_type: crowdReportEvent,
          gathering_size: size,
          note: noteText,
        }),
      });
      fetchAlerts(true);
    } catch {}
  }, [
    crowdReportArea,
    crowdReportEvent,
    crowdReportSize,
    crowdReportNote,
    fetchAlerts,
  ]);

  // Combine server alerts + local pre-news crowd alerts and apply real-time crowd veracity weighting
  const enrichedAllMapAlerts = useMemo(() => {
    const merged = [...localCrowdAlerts, ...allMapAlerts];
    const seen = new Set<string>();
    const out: GoldAlert[] = [];
    for (const a of merged) {
      const key = `${a.area}:${a.event_type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const boost = localVoteBoosts[key] || { confirm: 0, clear: 0 };
      const baseCrowd = a.crowd_metrics || {
        gathering_size:
          a.event_type === "fire" ||
          a.event_type === "strike" ||
          a.event_type === "blockade" ||
          a.event_type === "clash"
            ? 310
            : 175,
        baseline_size: 105,
        surge_ratio:
          a.event_type === "fire" ||
          a.event_type === "strike" ||
          a.event_type === "blockade"
            ? 2.9
            : 1.8,
        avg_speed_kmh: 1.8,
        gathering_radius_m: 155,
        citizen_reports: 8 + a.source_count * 3,
        confirm_votes: 11 + a.source_count * 2,
        clear_votes: 0,
        crowd_weight_bonus: 0.14,
        crowd_weight_percent: 14,
        pre_news_lead_minutes: 18,
        crowd_status: "CROWD CORROBORATED",
        is_pre_news_crowd: Boolean(a.is_pre_news_crowd),
      };

      const adjGathering = Math.max(
        25,
        baseCrowd.gathering_size + boost.confirm * 28 - boost.clear * 22
      );
      const adjSurge = Number(
        (adjGathering / Math.max(30, baseCrowd.baseline_size)).toFixed(1)
      );
      const adjWeightBonus = Number(
        Math.max(
          -0.12,
          Math.min(
            0.25,
            baseCrowd.crowd_weight_bonus +
              boost.confirm * 0.03 -
              boost.clear * 0.04
          )
        ).toFixed(2)
      );
      const adjScore = Math.min(
        0.99,
        Math.max(
          0.25,
          Number(
            (
              a.credibility_score +
              boost.confirm * 0.03 -
              boost.clear * 0.04
            ).toFixed(2)
          )
        )
      );
      const adjPct = Math.round(adjScore * 100);

      out.push({
        ...a,
        credibility_score: adjScore,
        veracity_percent: adjPct,
        crowd_metrics: {
          ...baseCrowd,
          gathering_size: adjGathering,
          surge_ratio: adjSurge,
          citizen_reports: baseCrowd.citizen_reports + boost.confirm,
          confirm_votes: baseCrowd.confirm_votes + boost.confirm,
          clear_votes: baseCrowd.clear_votes + boost.clear,
          crowd_weight_bonus: adjWeightBonus,
          crowd_weight_percent: Math.round(adjWeightBonus * 100),
        },
      });
    }
    return out;
  }, [localCrowdAlerts, allMapAlerts, localVoteBoosts]);

  // Ensure every RECENT (<= 3h) map alert geometrically intercepted by the route (<= 1.35 km) is included in route alerts
  const sortedRouteAlerts = useMemo(() => {
    const poly =
      routeGeometry?.polyline && routeGeometry.polyline.length >= 2
        ? routeGeometry.polyline
        : [
            [currentLocation.lat, currentLocation.lon],
            [destination.lat, destination.lon],
          ];
    const byKey = new Map<string, GoldAlert>();

    const isAlertRecent3h = (a: GoldAlert) =>
      typeof a.is_recent_3h === "boolean"
        ? a.is_recent_3h
        : (a.age_minutes ?? 9999) <= 180;

    routeAlerts.forEach((a) => {
      if (!isAlertRecent3h(a)) return;
      byKey.set(`${a.area}:${a.event_type}`, { ...a, on_route: true });
    });

    enrichedAllMapAlerts.forEach((a) => {
      if (!isAlertRecent3h(a)) return;
      const k = `${a.area}:${a.event_type}`;
      const proj = minDistanceToPolylineKm(a.lat, a.lon, poly);
      if (proj.distKm <= 1.35 || byKey.has(k)) {
        const prev = byKey.get(k);
        byKey.set(k, {
          ...(prev || a),
          ...a,
          on_route: true,
          distance_to_route_km: Number(proj.distKm.toFixed(2)),
          affected_road: (prev?.affected_road || a.affected_road || `${a.area} Road`),
        });
      }
    });

    return Array.from(byKey.values()).sort((a, b) => {
      const tsA =
        a.articles?.[0]?.published ||
        a.articles?.[0]?.ingested_at ||
        a.last_updated ||
        "";
      const tsB =
        b.articles?.[0]?.published ||
        b.articles?.[0]?.ingested_at ||
        b.last_updated ||
        "";
      return tsB.localeCompare(tsA);
    });
  }, [
    routeAlerts,
    enrichedAllMapAlerts,
    routeGeometry,
    currentLocation,
    destination,
  ]);

  const sortedAllAlerts = useMemo(() => {
    return [...enrichedAllMapAlerts].sort((a, b) => {
      const tsA =
        a.articles?.[0]?.published ||
        a.articles?.[0]?.ingested_at ||
        a.last_updated ||
        "";
      const tsB =
        b.articles?.[0]?.published ||
        b.articles?.[0]?.ingested_at ||
        b.last_updated ||
        "";
      return tsB.localeCompare(tsA);
    });
  }, [enrichedAllMapAlerts]);

  const routeAlertIds = useMemo(
    () => new Set(sortedRouteAlerts.map((a) => a.cluster_id)),
    [sortedRouteAlerts]
  );

  const visibleMapAlerts = showAllOnMap ? enrichedAllMapAlerts : sortedRouteAlerts;
  const activeDrawerAlerts =
    drawerTab === "route" ? sortedRouteAlerts : sortedAllAlerts;

  const selectedAreaAlerts = useMemo(() => {
    if (!selectedArea) return [];
    const routeSet = routeAlertIds;
    return enrichedAllMapAlerts
      .filter((a) => a.area === selectedArea)
      .map((a) => ({ ...a, on_route: routeSet.has(a.cluster_id) }))
      .sort((a, b) => {
        const tsA =
          a.articles?.[0]?.published ||
          a.articles?.[0]?.ingested_at ||
          a.last_updated ||
          "";
        const tsB =
          b.articles?.[0]?.published ||
          b.articles?.[0]?.ingested_at ||
          b.last_updated ||
          "";
        return tsB.localeCompare(tsA);
      });
  }, [selectedArea, enrichedAllMapAlerts, routeAlertIds]);

  const effectiveRiskLevel = useMemo(() => {
    if (
      sortedRouteAlerts.some((a) =>
        ["blockade", "strike", "gunfire", "murder", "fire", "clash"].includes(
          a.event_type
        )
      )
    ) {
      return "BLOCKED";
    }
    if (sortedRouteAlerts.some((a) => a.severity === "CRITICAL")) {
      return "HIGH_RISK";
    }
    if (sortedRouteAlerts.length > 0) {
      return "CAUTION";
    }
    return riskLevel || "CLEAR";
  }, [sortedRouteAlerts, riskLevel]);

  const riskMeta = RISK_META[effectiveRiskLevel] || RISK_META.CLEAR;
  const topRouteAlert = sortedRouteAlerts[0] || null;
  const effectiveSuppressed = Math.max(
    0,
    allMapAlerts.length - sortedRouteAlerts.length
  );
  const advisoryText = topRouteAlert
    ? `Avoid ${topRouteAlert.affected_road || topRouteAlert.area}: ${formatEventLabel(topRouteAlert.event_type)} — ${topRouteAlert.sample_headline}`
    : `Clear route • ${effectiveSuppressed} off-route threats filtered`;

  const statusColor =
    streamStatus === "LIVE"
      ? "#059669"
      : streamStatus === "SYNCING"
      ? "#0284C7"
      : "#E11D48";
  const statusBorder =
    streamStatus === "LIVE"
      ? "#A7F3D0"
      : streamStatus === "SYNCING"
      ? "#BAE6FD"
      : "#FECDD3";
  const statusBg =
    streamStatus === "LIVE"
      ? "#ECFDF5"
      : streamStatus === "SYNCING"
      ? "#F0F9FF"
      : "#FFF1F2";

  const listBottomPadding =
    drawerSnap === "half"
      ? offsetHalf + 24
      : drawerSnap === "full"
      ? 28
      : offsetOff;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* Full-Screen Google-Maps-Style White Map Canvas */}
      <View style={StyleSheet.absoluteFill}>
        <OsmMapWebView
          currentLocation={currentLocation}
          destination={destination}
          todoText={todoText}
          alerts={visibleMapAlerts}
          routeAlertIds={routeAlertIds}
          routeGeometry={routeGeometry}
          focusCoords={focusCoords}
          fitRouteNonce={fitRouteNonce}
          pinMode={pinMode}
          onPinDestination={handleMapPin}
          onSelectArea={(area) => setSelectedArea(area)}
        />
      </View>

      {/* Top Floating Google Maps Style Navigation & Filter Card */}
      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        <View style={[styles.topCard, isCompactPhone && styles.topCardCompact]}>
          {/* Header: Brand + Live Pill + Route ETA + Collapse/Sync Buttons */}
          <View style={styles.headerRow}>
            <View style={styles.brandRow}>
              <View style={styles.brandIconBadge}>
                <Ionicons name="shield-checkmark" size={15} color="#1A73E8" />
              </View>
              <Text style={styles.brand}>BigWarn</Text>
              <View
                style={[
                  styles.statusPill,
                  { borderColor: statusBorder, backgroundColor: statusBg },
                ]}
              >
                <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {streamStatus}
                </Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              {routeDistKm > 0 && (
                <View style={styles.etaPill}>
                  <Ionicons name="car-outline" size={12} color="#1A73E8" />
                  <Text style={styles.etaText}>
                    {routeDistKm} km{routeDurationMin > 0 ? ` • ${routeDurationMin}m` : ""}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => setCrowdModalOpen(true)}
                style={styles.crowdReportTopBtn}
                accessibilityLabel="Report Public Gathering"
              >
                <Ionicons name="people" size={13} color="#6D28D9" />
                <Text style={styles.crowdReportTopText}>Crowd</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => fetchAlerts(true)}
                disabled={isSyncing}
                style={styles.syncBtn}
                accessibilityLabel="Sync live feed"
              >
                {isSyncing ? (
                  <ActivityIndicator size="small" color="#1A73E8" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={13} color="#1A73E8" />
                    <Text style={styles.syncText}>Sync</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTopFiltersCollapsed((c) => !c)}
                style={styles.collapseTopBtn}
                accessibilityLabel="Toggle filter chips"
              >
                <Ionicons
                  name={topFiltersCollapsed ? "options-outline" : "chevron-up"}
                  size={15}
                  color="#475569"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Todo Destination Search Input + Map Pin Toggle */}
          <View style={styles.todoRow}>
            <View style={styles.inputWrap}>
              <Ionicons name="search-outline" size={16} color="#1A73E8" />
              <TextInput
                style={styles.todoInput}
                value={todoText}
                onChangeText={setTodoText}
                placeholder="Where are you heading? (e.g. Motijheel)"
                placeholderTextColor="#94A3B8"
              />
              {todoText.length > 0 && (
                <TouchableOpacity
                  onPress={() => setTodoText("")}
                  style={styles.clearInputBtn}
                >
                  <Ionicons name="close-circle" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setPinMode((p) => !p)}
              style={[styles.pinBtn, pinMode && styles.pinBtnActive]}
            >
              <Ionicons
                name={pinMode ? "locate" : "location"}
                size={14}
                color={pinMode ? "#FFFFFF" : "#EA4335"}
              />
              <Text style={[styles.pinBtnText, pinMode && styles.pinBtnTextActive]}>
                {pinMode ? "Tap Map" : "Pin"}
              </Text>
            </TouchableOpacity>
          </View>

          {!topFiltersCollapsed && (
            <>
              {/* Region / District Filter Chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
              >
                <TouchableOpacity
                  onPress={() => handleSelectCity("ALL")}
                  style={[
                    styles.chip,
                    selectedCity === "ALL" && styles.cityChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selectedCity === "ALL" && styles.cityChipTextActive,
                    ]}
                  >
                    All BD (
                    {availableCities.reduce((acc, c) => acc + c.alert_count, 0) ||
                      allMapAlerts.length}
                    )
                  </Text>
                </TouchableOpacity>
                {availableCities.map((c) => {
                  const active = selectedCity === c.city;
                  return (
                    <TouchableOpacity
                      key={c.city}
                      onPress={() => handleSelectCity(c.city, c.lat, c.lon)}
                      style={[styles.chip, active && styles.cityChipActive]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.cityChipTextActive,
                        ]}
                      >
                        {c.city} ({c.alert_count})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Quick Dhaka Route Destinations */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
              >
                {[
                  "Motijheel",
                  "Mirpur-10",
                  "Shahbagh",
                  "Uttara",
                  "Gulshan",
                  "Farmgate",
                  "Dhanmondi",
                ].map((name) => {
                  const active = destination.label === name;
                  return (
                    <TouchableOpacity
                      key={name}
                      onPress={() => handleSelectPresetDest(name)}
                      style={[styles.chip, active && styles.destChipActive]}
                    >
                      <Ionicons
                        name="navigate"
                        size={10}
                        color={active ? "#15803D" : "#64748B"}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.destChipTextActive,
                        ]}
                      >
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        {/* Sleek Route Advisory Strip */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            if (topRouteAlert) {
              setSelectedArea(topRouteAlert.area);
            } else {
              snapDrawerTo(drawerSnap === "off" ? "half" : "off");
            }
          }}
          style={[
            styles.advisoryPill,
            { backgroundColor: riskMeta.bg, borderColor: riskMeta.border },
          ]}
        >
          <View style={styles.advisoryHeader}>
            <Ionicons name={riskMeta.icon} size={14} color={riskMeta.accent} />
            <Text style={[styles.advisoryTitle, { color: riskMeta.color }]}>
              {riskMeta.label}
            </Text>
          </View>
          <Text style={styles.advisoryBody} numberOfLines={2}>
            {advisoryText}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Bottom-Right Google Maps Floating Action Stack */}
      <View
        style={[
          styles.mapActionStack,
          drawerSnap === "half" && styles.mapActionStackHalf,
          drawerSnap === "full" && styles.mapActionStackHidden,
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          onPress={() => handleLocateMe(true)}
          style={styles.locateBtn}
          accessibilityLabel="Center on my current location"
        >
          <MaterialIcons name="my-location" size={21} color="#1A73E8" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setFitRouteNonce((n) => n + 1)}
          style={styles.mapPillBtn}
        >
          <MaterialIcons name="route" size={14} color="#1A73E8" />
          <Text style={styles.mapPillText}>Fit Route</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setShowAllOnMap((v) => !v)}
          style={styles.mapPillBtn}
        >
          <Ionicons name="layers-outline" size={14} color="#475569" />
          <Text style={styles.mapPillText}>
            {showAllOnMap ? "All Areas" : "Route Only"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleFocusArea("Mirpur-10")}
          style={styles.mapPillBtn}
        >
          <Ionicons name="compass-outline" size={14} color="#EA4335" />
          <Text style={styles.mapPillText}>Mirpur-10</Text>
        </TouchableOpacity>
      </View>

      {/* Gesture-Driven Draggable Bottom Drawer (Drag up to open, drag down to off) */}
      <Animated.View
        style={[
          styles.bottomSheet,
          {
            height: maxDrawerHeight,
            transform: [{ translateY }],
          },
        ]}
      >
        {/* Drag Handle Zone */}
        <View
          {...drawerPanResponder.panHandlers}
          style={styles.sheetHandleArea}
        >
          <View style={styles.handleBar} />
          <View style={styles.sheetHeaderRow}>
            <View style={styles.sheetTitleCol}>
              <View style={styles.sheetTitleBadgeRow}>
                <Text style={styles.feedTitle}>
                  {sortedRouteAlerts.length} ROUTE ALERTS
                </Text>
                <View style={styles.totalMapBadge}>
                  <Text style={styles.totalMapBadgeText}>
                    {allMapAlerts.length} Across Map
                  </Text>
                </View>
              </View>
              <Text style={styles.dragInstructionText}>
                {drawerSnap === "off"
                  ? "Drag up to open alerts drawer"
                  : "Drag up for full view • Drag down to turn off"}
              </Text>
            </View>

            <View style={styles.sheetRightRow}>
              {drawerSnap !== "off" && (
                <TouchableOpacity
                  onPress={() =>
                    snapDrawerTo(drawerSnap === "half" ? "full" : "half")
                  }
                  style={styles.drawerActionBtn}
                  accessibilityLabel="Toggle half or full height"
                >
                  <Ionicons
                    name={
                      drawerSnap === "full"
                        ? "contract-outline"
                        : "expand-outline"
                    }
                    size={15}
                    color="#1A73E8"
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() =>
                  snapDrawerTo(drawerSnap === "off" ? "half" : "off")
                }
                style={[
                  styles.drawerActionBtn,
                  drawerSnap !== "off" && styles.drawerOffBtn,
                ]}
                accessibilityLabel={
                  drawerSnap === "off" ? "Open drawer" : "Turn off drawer"
                }
              >
                <Ionicons
                  name={drawerSnap === "off" ? "chevron-up" : "close"}
                  size={16}
                  color={drawerSnap === "off" ? "#334155" : "#DC2626"}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Drawer Segmented Tabs + Lakehouse Stats */}
        <View style={styles.drawerTabsRow}>
          <View style={styles.segmentedTabs}>
            <TouchableOpacity
              onPress={() => setDrawerTab("route")}
              style={[
                styles.drawerTabBtn,
                drawerTab === "route" && styles.drawerTabBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.drawerTabText,
                  drawerTab === "route" && styles.drawerTabTextActive,
                ]}
              >
                🛣️ On Route ({sortedRouteAlerts.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setDrawerTab("all")}
              style={[
                styles.drawerTabBtn,
                drawerTab === "all" && styles.drawerTabBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.drawerTabText,
                  drawerTab === "all" && styles.drawerTabTextActive,
                ]}
              >
                🗺️ All Places ({sortedAllAlerts.length})
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.suppressedLabel}>
            {layers
              ? `B ${layers.bronze.record_count} • S ${layers.silver.record_count} • G ${layers.gold.alert_clusters}`
              : `${suppressedCount} filtered`}
          </Text>
        </View>

        <FlatList
          data={activeDrawerAlerts}
          keyExtractor={(item) => item.cluster_id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          ListEmptyComponent={
            <View style={styles.emptyFeedBox}>
              <Ionicons
                name="checkmark-circle-outline"
                size={28}
                color="#10B981"
              />
              <Text style={styles.emptyFeedTitle}>
                {drawerTab === "route"
                  ? "Your Navigated Route is Clear"
                  : "No Active Disruption Alerts"}
              </Text>
              <Text style={styles.emptyFeed}>
                {drawerTab === "route"
                  ? "No strikes, gunfire, or road blockades detected along this route corridor."
                  : "No verified threat clusters reported for the selected district filter."}
              </Text>
              {drawerTab === "route" && sortedAllAlerts.length > 0 && (
                <TouchableOpacity
                  onPress={() => setDrawerTab("all")}
                  style={styles.switchTabCta}
                >
                  <Text style={styles.switchTabCtaText}>
                    View {sortedAllAlerts.length} Alerts Across All Places ›
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const latestArt = item.articles?.[0];
            const publishDisplay = formatNewsTimestamp(
              latestArt?.published || item.last_updated,
              latestArt?.ingested_at
            );
            const isOnRoute = routeAlertIds.has(item.cluster_id);
            return (
              <TouchableOpacity
                style={[styles.alertCard, { borderLeftColor: item.color }]}
                onPress={() => {
                  setFocusCoords({
                    lat: item.lat,
                    lon: item.lon,
                    zoom: 14,
                    nonce: Date.now(),
                  });
                  setSelectedArea(item.area);
                }}
              >
                <View style={styles.alertTop}>
                  <View style={styles.alertTitleRow}>
                    <Ionicons name="location" size={14} color={item.color} />
                    <Text style={styles.alertArea}>{item.area}</Text>
                    <View
                      style={[
                        styles.eventTag,
                        { backgroundColor: `${item.color}18` },
                      ]}
                    >
                      <Text style={[styles.eventTagText, { color: item.color }]}>
                        {formatEventLabel(item.event_type)}
                      </Text>
                    </View>
                    {item.is_pre_news_crowd && (
                      <View style={styles.preNewsTag}>
                        <Text style={styles.preNewsTagText}>
                          👥 PRE-NEWS CROWD
                        </Text>
                      </View>
                    )}
                  </View>
                  {typeof item.distance_to_route_km === "number" ? (
                    <Text style={styles.alertDist}>
                      {item.distance_to_route_km} km
                    </Text>
                  ) : isOnRoute ? (
                    <Text style={styles.onRoutePill}>ON ROUTE</Text>
                  ) : (
                    <Text style={styles.alertCityLabel}>{item.city}</Text>
                  )}
                </View>
                {item.affected_road ? (
                  <Text style={styles.avoidRoadText}>
                    Avoid: {item.affected_road}
                  </Text>
                ) : null}
                <Text style={styles.alertHeadline} numberOfLines={2}>
                  {item.sample_headline}
                </Text>
                <View style={styles.alertTimeRow}>
                  <Ionicons name="time-outline" size={12} color="#1A73E8" />
                  <Text style={styles.alertTimeText}>{publishDisplay}</Text>
                </View>
                <VeracityMeter
                  veracityPercent={item.veracity_percent}
                  credibilityScore={item.credibility_score}
                  veracityStatus={item.veracity_status}
                  veracitySummary={item.veracity_summary}
                  sources={item.sources}
                  crowdMetrics={item.crowd_metrics}
                  isPreNewsCrowd={item.is_pre_news_crowd}
                  compact
                />
              </TouchableOpacity>
            );
          }}
        />
      </Animated.View>

      {/* Public Gathering & Crowd-Sensing Early Alert Reporter Modal */}
      <Modal
        visible={crowdModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCrowdModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.crowdModalCard}>
            <View style={styles.crowdModalHeader}>
              <View>
                <Text style={styles.crowdModalKicker}>
                  PRE-NEWS PUBLIC GATHERING & CROWD INTEL
                </Text>
                <Text style={styles.crowdModalTitle}>
                  👥 Report Public Gathering Surge
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setCrowdModalOpen(false)}
                style={styles.collapseTopBtn}
              >
                <Ionicons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>

            <Text style={styles.crowdModalDesc}>
              When people accumulate together due to a fire, strike, blockade, or
              clash, report the gathering to trigger an early route alert before
              newspapers publish and weight the news veracity meter.
            </Text>

            <Text style={styles.crowdFieldLabel}>📍 Gathering Location</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
            >
              {Object.keys(DHAKA_PRESETS).map((loc) => {
                const active = crowdReportArea === loc;
                return (
                  <TouchableOpacity
                    key={loc}
                    onPress={() => setCrowdReportArea(loc)}
                    style={[styles.chip, active && styles.cityChipActive]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.cityChipTextActive,
                      ]}
                    >
                      {loc}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.crowdFieldLabel}>
              🚨 Cause of Public Accumulation
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
            >
              {[
                { id: "fire", label: "🔥 Fire / Smoke Crowd" },
                { id: "strike", label: "🛑 Strike / Hartal" },
                { id: "blockade", label: "🚧 Road Blockade" },
                { id: "clash", label: "⚡ Clash / Unrest" },
                { id: "procession", label: "📢 Protest March" },
                { id: "accident", label: "💥 Road Crash" },
              ].map((ev) => {
                const active = crowdReportEvent === ev.id;
                return (
                  <TouchableOpacity
                    key={ev.id}
                    onPress={() => setCrowdReportEvent(ev.id)}
                    style={[styles.chip, active && styles.destChipActive]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.destChipTextActive,
                      ]}
                    >
                      {ev.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.crowdFieldLabel}>
              👥 Estimated Gathering Size (People Accumulated)
            </Text>
            <View style={styles.crowdSizeRow}>
              {[100, 300, 500, 1000].map((sz) => {
                const active = crowdReportSize === sz;
                return (
                  <TouchableOpacity
                    key={sz}
                    onPress={() => setCrowdReportSize(sz)}
                    style={[
                      styles.crowdSizeBtn,
                      active && styles.crowdSizeBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.crowdSizeText,
                        active && styles.crowdSizeTextActive,
                      ]}
                    >
                      {sz}+
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              style={styles.crowdNoteInput}
              value={crowdReportNote}
              onChangeText={setCrowdReportNote}
              placeholder="Optional eyewitness note (e.g. Crowd gathered near circle, traffic stopped)…"
              placeholderTextColor="#94A3B8"
            />

            <TouchableOpacity
              onPress={handleSubmitCrowdReport}
              style={styles.crowdSubmitBtn}
            >
              <Ionicons name="radio" size={16} color="#FFFFFF" />
              <Text style={styles.crowdSubmitText}>
                Emit Pre-News Crowd Alert & Boost Veracity
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AreaDetailModal
        visible={Boolean(selectedArea)}
        areaName={selectedArea}
        alerts={selectedAreaAlerts}
        onCrowdVote={handleCrowdVote}
        onClose={() => setSelectedArea(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  topOverlay: {
    position: "absolute",
    top: Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 28) + 6 : 6,
    left: 12,
    right: 12,
    zIndex: 10,
  },
  topCard: {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 8,
    gap: 8,
  },
  topCardCompact: {
    padding: 9,
    borderRadius: 16,
    gap: 6,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  etaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  etaText: { color: "#1D4ED8", fontSize: 10.5, fontWeight: "800" },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    minWidth: 58,
    justifyContent: "center",
  },
  syncText: { color: "#1A73E8", fontSize: 11, fontWeight: "700" },
  crowdReportTopBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F3E8FF",
    borderWidth: 1,
    borderColor: "#D8B4FE",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  crowdReportTopText: { color: "#6D28D9", fontSize: 11, fontWeight: "800" },
  preNewsTag: {
    backgroundColor: "#F3E8FF",
    borderColor: "#C084FC",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  preNewsTagText: {
    color: "#6D28D9",
    fontSize: 9,
    fontWeight: "900",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.48)",
    justifyContent: "flex-end",
  },
  crowdModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    gap: 10,
    borderTopWidth: 1,
    borderColor: "#E2E8F0",
  },
  crowdModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  crowdModalKicker: {
    color: "#7C3AED",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  crowdModalTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },
  crowdModalDesc: {
    color: "#475569",
    fontSize: 12,
    lineHeight: 17,
  },
  crowdFieldLabel: {
    color: "#334155",
    fontSize: 11.5,
    fontWeight: "800",
    marginTop: 2,
  },
  crowdSizeRow: {
    flexDirection: "row",
    gap: 8,
  },
  crowdSizeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  crowdSizeBtnActive: {
    backgroundColor: "#F3E8FF",
    borderColor: "#8B5CF6",
  },
  crowdSizeText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
  },
  crowdSizeTextActive: {
    color: "#6D28D9",
    fontWeight: "800",
  },
  crowdNoteInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12.5,
    color: "#0F172A",
  },
  crowdSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#7C3AED",
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  crowdSubmitText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  collapseTopBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  todoRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 11,
    gap: 7,
  },
  todoInput: {
    flex: 1,
    color: "#0F172A",
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: "600",
  },
  clearInputBtn: {
    padding: 2,
  },
  pinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
  },
  pinBtnActive: {
    backgroundColor: "#1A73E8",
    borderColor: "#185ABC",
  },
  pinBtnText: { color: "#DC2626", fontSize: 12, fontWeight: "800" },
  pinBtnTextActive: { color: "#FFFFFF" },
  chipScroll: { flexDirection: "row" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginRight: 6,
  },
  chipText: { color: "#475569", fontSize: 11, fontWeight: "600" },
  cityChipActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#3B82F6",
  },
  cityChipTextActive: { color: "#1D4ED8", fontWeight: "800" },
  destChipActive: {
    backgroundColor: "#DCFCE7",
    borderColor: "#22C55E",
  },
  destChipTextActive: { color: "#15803D", fontWeight: "800" },
  advisoryPill: {
    marginTop: 7,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  advisoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  advisoryTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  advisoryBody: { color: "#1E293B", fontSize: 11.5, lineHeight: 15.5, fontWeight: "600" },
  mapActionStack: {
    position: "absolute",
    right: 12,
    bottom: Platform.OS === "ios" ? 96 : 86,
    alignItems: "flex-end",
    gap: 8,
    zIndex: 15,
  },
  mapActionStackHalf: {
    bottom: "48%",
  },
  mapActionStackHidden: {
    opacity: 0,
    pointerEvents: "none",
  },
  locateBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    shadowColor: "#0F172A",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
  },
  mapPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  mapPillText: { color: "#1E293B", fontSize: 11, fontWeight: "700" },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 14,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 18,
    zIndex: 20,
  },
  sheetHandleArea: {
    paddingTop: 9,
    paddingBottom: 8,
  },
  handleBar: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetTitleCol: {
    flex: 1,
  },
  sheetTitleBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  feedTitle: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  totalMapBadge: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
  },
  totalMapBadgeText: {
    color: "#1D4ED8",
    fontSize: 10,
    fontWeight: "700",
  },
  dragInstructionText: {
    color: "#64748B",
    fontSize: 10.5,
    fontWeight: "500",
    marginTop: 2,
  },
  sheetRightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  drawerActionBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  drawerOffBtn: {
    backgroundColor: "#FEF2F2",
  },
  drawerTabsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    marginBottom: 8,
  },
  segmentedTabs: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  drawerTabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  drawerTabBtnActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  drawerTabText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  drawerTabTextActive: {
    color: "#0F172A",
    fontWeight: "800",
  },
  suppressedLabel: { color: "#64748B", fontSize: 10.5, fontWeight: "600" },
  emptyFeedBox: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  emptyFeedTitle: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 6,
  },
  emptyFeed: {
    color: "#64748B",
    fontSize: 12.5,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 18,
  },
  switchTabCta: {
    marginTop: 12,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  switchTabCtaText: {
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: "700",
  },
  alertCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderLeftWidth: 4,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1,
  },
  alertTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  alertTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  alertArea: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  eventTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  eventTagText: { fontSize: 10, fontWeight: "800" },
  alertDist: { color: "#475569", fontSize: 11, fontWeight: "700" },
  onRoutePill: {
    color: "#DC2626",
    backgroundColor: "#FEE2E2",
    fontSize: 9.5,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  alertCityLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
  },
  avoidRoadText: {
    color: "#DC2626",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 3,
  },
  alertHeadline: { color: "#1E293B", fontSize: 12.5, lineHeight: 17.5, fontWeight: "600" },
  alertTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 5,
    marginBottom: 2,
  },
  alertTimeText: {
    color: "#1A73E8",
    fontSize: 10.5,
    fontWeight: "600",
  },
});
