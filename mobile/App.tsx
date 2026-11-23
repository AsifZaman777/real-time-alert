import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  CLOUD_API_BASE_URL,
  DEFAULT_API_BASE_URL,
  DHAKA_PRESETS,
  FEED_ACCESS_TOKEN,
  LOCAL_API_BASE_URL,
} from "./src/config/api";
import {
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
  { color: string; bg: string; border: string; label: string; icon: "warning" | "checkmark-circle" }
> = {
  BLOCKED: {
    color: "#FCA5A5",
    bg: "rgba(127, 29, 29, 0.92)",
    border: "#EF4444",
    label: "ROUTE ANOMALY • CHANGE ROUTE",
    icon: "warning",
  },
  HIGH_RISK: {
    color: "#FDBA74",
    bg: "rgba(124, 45, 18, 0.92)",
    border: "#F97316",
    label: "HIGH RISK ON ROUTE",
    icon: "warning",
  },
  CAUTION: {
    color: "#FDE047",
    bg: "rgba(113, 63, 18, 0.92)",
    border: "#F59E0B",
    label: "CAUTION ON ROUTE",
    icon: "warning",
  },
  CLEAR: {
    color: "#6EE7B7",
    bg: "rgba(6, 78, 59, 0.9)",
    border: "#10B981",
    label: "ROUTE CLEAR",
    icon: "checkmark-circle",
  },
};

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_BASE_URL);
  const [showSettings, setShowSettings] = useState(false);

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
  const [streamStatus, setStreamStatus] = useState<string>("CONNECTING");
  const [lastError, setLastError] = useState<string | null>(null);

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

  const handleLocateMe = useCallback(async (flyTo: boolean = true) => {
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
  }, [currentLocation.lat, currentLocation.lon]);

  useEffect(() => {
    handleLocateMe(false);
  }, []);

  const fetchAlerts = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const cleanBase = apiUrl.trim().replace(/\/+$/, "");
      const routeParams = new URLSearchParams({
        date: "latest",
        cur_lat: String(currentLocation.lat),
        cur_lon: String(currentLocation.lon),
        dest_lat: String(destination.lat),
        dest_lon: String(destination.lon),
        todo: todoText,
        radius_km: "2.5",
        include_map: "1",
      });

      const headers: Record<string, string> = {};
      if (FEED_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${FEED_ACCESS_TOKEN}`;
      }

      const routeRes = await fetch(
        `${cleanBase}/api/v1/alerts/route?${routeParams.toString()}`,
        { signal: controller.signal, headers }
      );

      if (!routeRes.ok) {
        setStreamStatus("OFFLINE");
        setLastError(`HTTP ${routeRes.status}`);
        setShowSettings(true);
        return;
      }

      const routeData: RouteAlertResponse = await routeRes.json();
      let mapAlerts = routeData.map_alerts;
      if (!mapAlerts) {
        const mapRes = await fetch(`${cleanBase}/api/v1/alerts/map?date=latest`, {
          signal: controller.signal,
          headers,
        });
        if (mapRes.ok) {
          const mapData: MapAlertResponse = await mapRes.json();
          mapAlerts = mapData.alerts || [];
        }
      }

      const nextRouteAlerts = routeData.route_alerts || [];
      const pollSig = [
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
      setLastError(null);

      // Only trigger state updates if route or alert data actually changed (prevents 8s poll flicker)
      if (pollSig !== lastPollSigRef.current) {
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
      }
    } catch (err: any) {
      setStreamStatus("OFFLINE");
      setLastError(err?.name === "AbortError" ? "Timeout" : "Unreachable");
      setShowSettings(true);
    } finally {
      clearTimeout(timeoutId);
    }
  }, [apiUrl, currentLocation, destination, todoText]);

  useEffect(() => {
    fetchAlerts();
    const timer = setInterval(fetchAlerts, 8000);
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
      Vibration.vibrate(45);
    } catch {}
    // Find nearest known area name for context if close
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

    setDestination({
      lat,
      lon,
      label: pinLabel,
    });
    setTodoText(pinLabel);
    setPinMode(false);
  };

  const handleFocusArea = (name: string) => {
    const preset = DHAKA_PRESETS[name];
    if (!preset) return;
    setFocusCoords({ lat: preset.lat, lon: preset.lon, zoom: 14, nonce: Date.now() });
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
    () => new Set(routeAlerts.map((a) => a.cluster_id)),
    [routeAlerts]
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
  const anomalyBannerText = topRouteAlert
    ? `⛔ AVOID ${(topRouteAlert.affected_road || topRouteAlert.area).toUpperCase()}: ${formatEventLabel(topRouteAlert.event_type)} in ${topRouteAlert.area} — ${topRouteAlert.sample_headline}`
    : `Hold anywhere on map to pin destination • Minimum road route is clear (${suppressedCount} city alerts filtered)`;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Full-Screen OpenStreetMap */}
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

      {/* Top Floating Overlay */}
      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.topCard}>
          <View style={styles.headerRow}>
            <View style={styles.brandRow}>
              <Ionicons name="shield-checkmark" size={18} color="#38BDF8" />
              <Text style={styles.brand}>BigWarn</Text>
              <View
                style={[
                  styles.statusPill,
                  {
                    borderColor:
                      streamStatus === "LIVE" ? "#10B981" : "#EF4444",
                    backgroundColor:
                      streamStatus === "LIVE"
                        ? "rgba(16,185,129,0.14)"
                        : "rgba(239,68,68,0.14)",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: streamStatus === "LIVE" ? "#34D399" : "#F87171" },
                  ]}
                >
                  {streamStatus}
                  {lastError ? ` (${lastError})` : ""}
                </Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              {routeDistKm > 0 && (
                <View style={styles.statusPill}>
                  <Text style={[styles.statusText, { color: riskMeta.color }]}>
                    {routeDistKm} km{routeDurationMin > 0 ? ` • ${routeDurationMin}m` : ""}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => setShowSettings((s) => !s)}
                style={styles.iconBtn}
              >
                <Ionicons name="settings-outline" size={16} color="#CBD5E1" />
              </TouchableOpacity>
            </View>
          </View>

          {showSettings && (
            <View style={styles.settingsBar}>
              <TextInput
                style={styles.settingsInput}
                value={apiUrl}
                onChangeText={setApiUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={LOCAL_API_BASE_URL}
                placeholderTextColor="#64748B"
              />
              <TouchableOpacity
                onPress={() => setApiUrl(CLOUD_API_BASE_URL)}
                style={styles.applyBtn}
              >
                <Text style={styles.applyText}>Cloud</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setApiUrl(LOCAL_API_BASE_URL)}
                style={[styles.applyBtn, { backgroundColor: "#334155" }]}
              >
                <Text style={[styles.applyText, { color: "#E2E8F0" }]}>Local</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={fetchAlerts} style={styles.applyBtn}>
                <Text style={styles.applyText}>Sync</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Destination Todo + Pin Bar */}
          <View style={styles.todoRow}>
            <View style={styles.inputWrap}>
              <Ionicons name="navigate-outline" size={15} color="#64748B" />
              <TextInput
                style={styles.todoInput}
                value={todoText}
                onChangeText={setTodoText}
                placeholder="Where to go? (e.g. Motijheel)"
                placeholderTextColor="#64748B"
              />
            </View>
            <TouchableOpacity
              onPress={() => setPinMode((p) => !p)}
              style={[styles.pinBtn, pinMode && styles.pinBtnActive]}
            >
              <Ionicons
                name={pinMode ? "locate" : "location"}
                size={14}
                color="#F8FAFC"
              />
              <Text style={styles.pinBtnText}>
                {pinMode ? "Tap Map" : "Pin"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Destinations */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.presetRow}
          >
            {["Motijheel", "Mirpur-10", "Shahbagh", "Uttara", "Gulshan", "Farmgate"].map(
              (name) => {
                const active = destination.label === name;
                return (
                  <TouchableOpacity
                    key={name}
                    onPress={() => handleSelectPresetDest(name)}
                    style={[
                      styles.presetChip,
                      active && styles.presetChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.presetChipText,
                        active && styles.presetChipTextActive,
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
      </SafeAreaView>

      {/* Bottom-Right Map Action Stack (My Location Icon + Map Controls) */}
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
          <MaterialIcons name="my-location" size={22} color="#FFFFFF" />
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
          <Ionicons name="layers-outline" size={14} color="#CBD5E1" />
          <Text style={styles.mapPillText}>
            {showAllOnMap ? "All City" : "Route Only"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleFocusArea("Mirpur-10")}
          style={styles.mapPillBtn}
        >
          <Ionicons name="compass-outline" size={14} color="#F87171" />
          <Text style={styles.mapPillText}>Mirpur-10</Text>
        </TouchableOpacity>
      </View>

      {/* Collapsible Bottom Sheet */}
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
              {routeAlerts.length} ROAD THREATS ON ROUTE
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
                Your navigated roads look clear. No threats, firing, or blockades detected.
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
                      {item.distance_to_route_km} km from road
                    </Text>
                  </View>
                  {item.affected_road ? (
                    <Text style={styles.avoidRoadText}>
                      ⛔ Avoid Road: {item.affected_road}
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
    backgroundColor: "#020617",
  },
  topOverlay: {
    position: "absolute",
    top: Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 28) + 6 : 6,
    left: 12,
    right: 12,
    zIndex: 10,
  },
  topCard: {
    backgroundColor: "rgba(9, 13, 22, 0.92)",
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(51, 65, 85, 0.65)",
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brand: {
    color: "#F8FAFC",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: { fontSize: 10, fontWeight: "800" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn: {
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "#1E293B",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 9,
  },
  iconBtnActive: {
    borderColor: "#38BDF8",
    backgroundColor: "rgba(56, 189, 248, 0.14)",
  },
  iconBtnText: { fontSize: 13 },
  settingsBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  settingsInput: {
    flex: 1,
    backgroundColor: "#1E293B",
    color: "#F8FAFC",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
  },
  applyBtn: {
    backgroundColor: "#0284C7",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  applyText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  todoRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0F172A",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1E293B",
    paddingHorizontal: 10,
    gap: 6,
  },
  todoInput: {
    flex: 1,
    color: "#F8FAFC",
    paddingVertical: 7,
    fontSize: 13,
    fontWeight: "600",
  },
  pinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
  },
  pinBtnActive: {
    backgroundColor: "#0284C7",
    borderColor: "#38BDF8",
  },
  pinBtnText: { color: "#F8FAFC", fontSize: 12, fontWeight: "700" },
  presetRow: { flexDirection: "row" },
  presetChip: {
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "#1E293B",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 6,
  },
  presetChipActive: {
    backgroundColor: "rgba(16, 185, 129, 0.18)",
    borderColor: "#10B981",
  },
  presetChipText: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  presetChipTextActive: { color: "#34D399", fontWeight: "800" },
  anomalyBanner: {
    marginTop: 7,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  anomalyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  anomalyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  anomalyTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  testNotifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  testNotifyText: { color: "#F8FAFC", fontSize: 10, fontWeight: "700" },
  anomalyBody: { color: "#F1F5F9", fontSize: 11, lineHeight: 15 },
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
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  locateIcon: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 24,
  },
  mapPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(9, 13, 22, 0.9)",
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  mapPillText: { color: "#F8FAFC", fontSize: 11, fontWeight: "700" },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(9, 13, 22, 0.96)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: "#1E293B",
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === "ios" ? 22 : 12,
    zIndex: 20,
  },
  bottomSheetExpanded: {
    height: "46%",
  },
  sheetHandleArea: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#334155",
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
    marginTop: 18,
  },
  alertCard: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 11,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
    borderLeftWidth: 4,
  },
  alertTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  alertTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  alertArea: { color: "#F8FAFC", fontSize: 13, fontWeight: "800" },
  eventTag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  eventTagText: { fontSize: 10, fontWeight: "800" },
  alertDist: { color: "#94A3B8", fontSize: 11, fontWeight: "700" },
  avoidRoadText: {
    color: "#FCA5A5",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 3,
  },
  alertHeadline: { color: "#CBD5E1", fontSize: 12, lineHeight: 17 },
  alertTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    marginBottom: 2,
  },
  alertTimeText: {
    color: "#7DD3FC",
    fontSize: 10.5,
    fontWeight: "600",
  },
});
