import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
    color: "#FECDD3",
    accent: "#FB7185",
    bg: "rgba(136, 19, 55, 0.88)",
    border: "rgba(244, 63, 94, 0.6)",
    label: "ROUTE ANOMALY • REROUTE ADVISED",
    icon: "warning",
  },
  HIGH_RISK: {
    color: "#FDE68A",
    accent: "#FBBF24",
    bg: "rgba(120, 53, 15, 0.88)",
    border: "rgba(245, 158, 11, 0.55)",
    label: "HIGH RISK ALONG ROUTE",
    icon: "warning",
  },
  CAUTION: {
    color: "#FEF08A",
    accent: "#FACC15",
    bg: "rgba(113, 63, 18, 0.86)",
    border: "rgba(234, 179, 8, 0.5)",
    label: "CAUTION ON ROUTE",
    icon: "warning",
  },
  CLEAR: {
    color: "#A7F3D0",
    accent: "#34D399",
    bg: "rgba(6, 78, 59, 0.86)",
    border: "rgba(16, 185, 129, 0.45)",
    label: "ROUTE CLEAR",
    icon: "checkmark-circle",
  },
};

export default function App() {
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
  const [sheetExpanded, setSheetExpanded] = useState<boolean>(false);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [focusCoords, setFocusCoords] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    nonce: number;
  } | null>(null);
  const [fitRouteNonce, setFitRouteNonce] = useState<number>(0);

  const lastPollSigRef = useRef<string>("");

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

        const nextRouteAlerts = routeData.route_alerts || [];
        const pollSig = [
          selectedCity,
          currentLocation.lat.toFixed(4),
          currentLocation.lon.toFixed(4),
          destination.lat.toFixed(4),
          destination.lon.toFixed(4),
          routeData.route_risk_level,
          routeData.route?.route_distance_km,
          nextRouteAlerts.map((a) => `${a.cluster_id}:${a.last_updated}`).join(","),
          (mapAlerts || []).length,
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
            danger_segments: routeData.route?.danger_segments,
          });
          setSuppressedCount(routeData.suppressed_count || 0);
          setAllMapAlerts(mapAlerts || []);
          setLayers(routeData.layers);
          if (routeData.available_cities) {
            setAvailableCities(routeData.available_cities);
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

  const routeAlertIds = useMemo(
    () => new Set(sortedRouteAlerts.map((a) => a.cluster_id)),
    [sortedRouteAlerts]
  );

  const visibleMapAlerts = showAllOnMap ? allMapAlerts : sortedRouteAlerts;

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
      ? "#34D399"
      : streamStatus === "SYNCING"
      ? "#38BDF8"
      : "#FB7185";
  const statusBorder =
    streamStatus === "LIVE"
      ? "rgba(16, 185, 129, 0.45)"
      : streamStatus === "SYNCING"
      ? "rgba(56, 189, 248, 0.45)"
      : "rgba(244, 63, 94, 0.5)";
  const statusBg =
    streamStatus === "LIVE"
      ? "rgba(16, 185, 129, 0.14)"
      : streamStatus === "SYNCING"
      ? "rgba(56, 189, 248, 0.14)"
      : "rgba(244, 63, 94, 0.16)";

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Full-Screen Map Canvas */}
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

      {/* Top Floating Navigation & Filter Card */}
      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.topCard}>
          {/* Header: Brand + Live Pill + Route ETA + Sync Button */}
          <View style={styles.headerRow}>
            <View style={styles.brandRow}>
              <View style={styles.brandIconBadge}>
                <Ionicons name="shield-checkmark" size={15} color="#38BDF8" />
              </View>
              <Text style={styles.brand}>BigWarn</Text>
              <Text style={styles.versionTag}>v1.1.0</Text>
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
                  <ActivityIndicator size="small" color="#38BDF8" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={14} color="#38BDF8" />
                    <Text style={styles.syncText}>Sync</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Todo Destination Input + Map Pin Toggle */}
          <View style={styles.todoRow}>
            <View style={styles.inputWrap}>
              <Ionicons name="navigate-outline" size={15} color="#64748B" />
              <TextInput
                style={styles.todoInput}
                value={todoText}
                onChangeText={setTodoText}
                placeholder="Where are you heading? (e.g. Motijheel)"
                placeholderTextColor="#64748B"
              />
            </View>
            <TouchableOpacity
              onPress={() => setPinMode((p) => !p)}
              style={[styles.pinBtn, pinMode && styles.pinBtnActive]}
            >
              <Ionicons
                name={pinMode ? "locate" : "location-outline"}
                size={14}
                color="#F8FAFC"
              />
              <Text style={styles.pinBtnText}>
                {pinMode ? "Tap Map" : "Pin"}
              </Text>
            </TouchableOpacity>
          </View>

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
                All BD ({availableCities.reduce((acc, c) => acc + c.alert_count, 0) || allMapAlerts.length})
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
                    style={[styles.chipText, active && styles.cityChipTextActive]}
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
            {["Motijheel", "Mirpur-10", "Shahbagh", "Uttara", "Gulshan", "Farmgate"].map(
              (name) => {
                const active = destination.label === name;
                return (
                  <TouchableOpacity
                    key={name}
                    onPress={() => handleSelectPresetDest(name)}
                    style={[styles.chip, active && styles.destChipActive]}
                  >
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
              }
            )}
          </ScrollView>
        </View>

        {/* Sleek Route Advisory Strip */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => topRouteAlert && setSelectedArea(topRouteAlert.area)}
          style={[
            styles.advisoryPill,
            { backgroundColor: riskMeta.bg, borderColor: riskMeta.border },
          ]}
        >
          <View style={styles.advisoryHeader}>
            <Ionicons name={riskMeta.icon} size={13} color={riskMeta.accent} />
            <Text style={[styles.advisoryTitle, { color: riskMeta.color }]}>
              {riskMeta.label}
            </Text>
          </View>
          <Text style={styles.advisoryBody} numberOfLines={2}>
            {advisoryText}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Bottom-Right Map Action Stack */}
      <View
        style={[
          styles.mapActionStack,
          sheetExpanded && styles.mapActionStackRaised,
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          onPress={() => handleLocateMe(true)}
          style={styles.locateBtn}
          accessibilityLabel="Center on my current location"
        >
          <MaterialIcons name="my-location" size={21} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setFitRouteNonce((n) => n + 1)}
          style={styles.mapPillBtn}
        >
          <MaterialIcons name="route" size={14} color="#38BDF8" />
          <Text style={styles.mapPillText}>Route</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setShowAllOnMap((v) => !v)}
          style={styles.mapPillBtn}
        >
          <Ionicons name="layers-outline" size={14} color="#94A3B8" />
          <Text style={styles.mapPillText}>
            {showAllOnMap ? "All Areas" : "Route Only"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleFocusArea("Mirpur-10")}
          style={styles.mapPillBtn}
        >
          <Ionicons name="compass-outline" size={14} color="#FB7185" />
          <Text style={styles.mapPillText}>Mirpur-10</Text>
        </TouchableOpacity>
      </View>

      {/* Collapsible Bottom Route Alerts Sheet */}
      <View
        style={[
          styles.bottomSheet,
          sheetExpanded && styles.bottomSheetExpanded,
        ]}
      >
        <TouchableOpacity
          onPress={() => setSheetExpanded((e) => !e)}
          style={styles.sheetHandleArea}
        >
          <View style={styles.handleBar} />
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.feedTitle}>
              {sortedRouteAlerts.length} ROUTE ALERTS
            </Text>
            <View style={styles.sheetRightRow}>
              <Text style={styles.suppressedLabel}>
                {layers
                  ? `B ${layers.bronze.record_count} • S ${layers.silver.record_count} • G ${layers.gold.alert_clusters}`
                  : `${suppressedCount} filtered`}
              </Text>
              <Ionicons
                name={sheetExpanded ? "chevron-down" : "chevron-up"}
                size={16}
                color="#94A3B8"
              />
            </View>
          </View>
        </TouchableOpacity>

        {sheetExpanded && (
          <FlatList
            data={sortedRouteAlerts}
            keyExtractor={(item) => item.cluster_id}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={styles.emptyFeed}>
                Your navigated route is clear. No strikes, firing, or blockades detected.
              </Text>
            }
            renderItem={({ item }) => {
              const latestArt = item.articles?.[0];
              const publishDisplay = formatNewsTimestamp(
                latestArt?.published || item.last_updated,
                latestArt?.ingested_at
              );
              return (
                <TouchableOpacity
                  style={[styles.alertCard, { borderLeftColor: item.color }]}
                  onPress={() => setSelectedArea(item.area)}
                >
                  <View style={styles.alertTop}>
                    <View style={styles.alertTitleRow}>
                      <Text style={styles.alertArea}>{item.area}</Text>
                      <View
                        style={[
                          styles.eventTag,
                          { backgroundColor: `${item.color}22` },
                        ]}
                      >
                        <Text style={[styles.eventTagText, { color: item.color }]}>
                          {formatEventLabel(item.event_type)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.alertDist}>
                      {item.distance_to_route_km} km
                    </Text>
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
                    <Ionicons name="time-outline" size={11} color="#38BDF8" />
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
        )}
      </View>

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
    backgroundColor: "#0A0F1C",
  },
  topOverlay: {
    position: "absolute",
    top: Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 28) + 6 : 6,
    left: 12,
    right: 12,
    zIndex: 10,
  },
  topCard: {
    backgroundColor: "rgba(15, 23, 42, 0.92)",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  brandIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "rgba(56, 189, 248, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: "#F8FAFC",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  versionTag: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  etaPill: {
    backgroundColor: "rgba(30, 41, 59, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  etaText: { color: "#E2E8F0", fontSize: 10, fontWeight: "700" },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(14, 165, 233, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.35)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    minWidth: 62,
    justifyContent: "center",
  },
  syncText: { color: "#BAE6FD", fontSize: 11, fontWeight: "700" },
  todoRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30, 41, 59, 0.78)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    paddingHorizontal: 10,
    gap: 7,
  },
  todoInput: {
    flex: 1,
    color: "#F8FAFC",
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: "600",
  },
  pinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(30, 41, 59, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
  },
  pinBtnActive: {
    backgroundColor: "#0284C7",
    borderColor: "#38BDF8",
  },
  pinBtnText: { color: "#F8FAFC", fontSize: 12, fontWeight: "700" },
  chipScroll: { flexDirection: "row" },
  chip: {
    backgroundColor: "rgba(30, 41, 59, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.16)",
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 999,
    marginRight: 6,
  },
  chipText: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  cityChipActive: {
    backgroundColor: "rgba(56, 189, 248, 0.16)",
    borderColor: "rgba(56, 189, 248, 0.55)",
  },
  cityChipTextActive: { color: "#BAE6FD", fontWeight: "800" },
  destChipActive: {
    backgroundColor: "rgba(16, 185, 129, 0.16)",
    borderColor: "rgba(16, 185, 129, 0.55)",
  },
  destChipTextActive: { color: "#A7F3D0", fontWeight: "800" },
  advisoryPill: {
    marginTop: 7,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  advisoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  advisoryTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  advisoryBody: { color: "#F1F5F9", fontSize: 11.5, lineHeight: 15.5 },
  mapActionStack: {
    position: "absolute",
    right: 12,
    bottom: Platform.OS === "ios" ? 86 : 74,
    alignItems: "flex-end",
    gap: 8,
    zIndex: 15,
  },
  mapActionStackRaised: {
    bottom: "48%",
  },
  locateBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0284C7",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#E0F2FE",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  mapPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)",
    paddingHorizontal: 11,
    paddingVertical: 6.5,
    borderRadius: 999,
  },
  mapPillText: { color: "#E2E8F0", fontSize: 11, fontWeight: "700" },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(14, 21, 37, 0.96)",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === "ios" ? 22 : 12,
    zIndex: 20,
  },
  bottomSheetExpanded: {
    height: "46%",
  },
  sheetHandleArea: {
    paddingTop: 8,
    paddingBottom: 9,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#475569",
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetRightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  feedTitle: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  suppressedLabel: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  emptyFeed: {
    color: "#64748B",
    fontSize: 13,
    textAlign: "center",
    marginTop: 20,
  },
  alertCard: {
    backgroundColor: "rgba(30, 41, 59, 0.55)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    borderLeftWidth: 4,
  },
  alertTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  alertTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  alertArea: { color: "#F8FAFC", fontSize: 13.5, fontWeight: "800" },
  eventTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  eventTagText: { fontSize: 10, fontWeight: "800" },
  alertDist: { color: "#94A3B8", fontSize: 11, fontWeight: "700" },
  avoidRoadText: {
    color: "#FDA4AF",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 3,
  },
  alertHeadline: { color: "#E2E8F0", fontSize: 12.5, lineHeight: 17.5 },
  alertTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 5,
    marginBottom: 2,
  },
  alertTimeText: {
    color: "#7DD3FC",
    fontSize: 10.5,
    fontWeight: "600",
  },
});
