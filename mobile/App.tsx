import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
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

export default function App() {
  const { height: windowHeight } = useWindowDimensions();

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

  const sortedRouteAlerts = useMemo(() => {
    return [...routeAlerts].sort((a, b) => {
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
  }, [routeAlerts]);

  const sortedAllAlerts = useMemo(() => {
    return [...allMapAlerts].sort((a, b) => {
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
  }, [allMapAlerts]);

  const routeAlertIds = useMemo(
    () => new Set(sortedRouteAlerts.map((a) => a.cluster_id)),
    [sortedRouteAlerts]
  );

  const visibleMapAlerts = showAllOnMap ? allMapAlerts : sortedRouteAlerts;
  const activeDrawerAlerts =
    drawerTab === "route" ? sortedRouteAlerts : sortedAllAlerts;

  const selectedAreaAlerts = useMemo(() => {
    if (!selectedArea) return [];
    const routeSet = routeAlertIds;
    return allMapAlerts
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
  }, [selectedArea, allMapAlerts, routeAlertIds]);

  const riskMeta = RISK_META[riskLevel] || RISK_META.CLEAR;
  const topRouteAlert = sortedRouteAlerts[0] || null;
  const advisoryText = topRouteAlert
    ? `Avoid ${topRouteAlert.affected_road || topRouteAlert.area}: ${formatEventLabel(topRouteAlert.event_type)} — ${topRouteAlert.sample_headline}`
    : `Clear route • ${suppressedCount} off-route threats filtered`;

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
        <View style={styles.topCard}>
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
                  compact
                />
              </TouchableOpacity>
            );
          }}
        />
      </Animated.View>

      <AreaDetailModal
        visible={Boolean(selectedArea)}
        areaName={selectedArea}
        alerts={selectedAreaAlerts}
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
