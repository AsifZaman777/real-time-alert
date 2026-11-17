import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, WebViewMessageEvent, WebViewProps } from "react-native-webview";
import { Coordinates, GoldAlert } from "../types/alert";

const TypedWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<{ injectJavaScript: (script: string) => void }> }
>;

interface OsmMapWebViewProps {
  currentLocation: Coordinates;
  destination: Coordinates;
  todoText: string;
  alerts: GoldAlert[];
  routeAlertIds: Set<string>;
  focusCoords?: { lat: number; lon: number; zoom?: number; nonce: number } | null;
  fitRouteNonce?: number;
  pinMode?: boolean;
  onPinDestination: (lat: number, lon: number) => void;
  onSelectArea: (area: string) => void;
}

export const OsmMapWebView: React.FC<OsmMapWebViewProps> = ({
  currentLocation,
  destination,
  todoText,
  alerts,
  routeAlertIds,
  focusCoords,
  fitRouteNonce,
  onPinDestination,
  onSelectArea,
}) => {
  const webRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);

  // Group alerts by area so each map marker represents a location (e.g. Mirpur-10)
  const areaMarkers = useMemo(() => {
    const grouped = new Map<
      string,
      {
        area: string;
        lat: number;
        lon: number;
        color: string;
        hasCritical: boolean;
        onRoute: boolean;
        clusterCount: number;
        maxSources: number;
        topEvent: string;
      }
    >();

    for (const a of alerts) {
      const existing = grouped.get(a.area);
      const isRoute = routeAlertIds.has(a.cluster_id) || Boolean(a.on_route);
      const isRed = a.color === "#EF4444" || a.severity === "CRITICAL";
      if (!existing) {
        grouped.set(a.area, {
          area: a.area,
          lat: a.lat,
          lon: a.lon,
          color: a.color || "#EF4444",
          hasCritical: isRed,
          onRoute: isRoute,
          clusterCount: 1,
          maxSources: a.source_count,
          topEvent: a.event_type,
        });
      } else {
        existing.clusterCount += 1;
        existing.hasCritical = existing.hasCritical || isRed;
        if (existing.hasCritical) existing.color = "#EF4444";
        existing.onRoute = existing.onRoute || isRoute;
        existing.maxSources = Math.max(existing.maxSources, a.source_count);
      }
    }
    return Array.from(grouped.values());
  }, [alerts, routeAlertIds]);

  const html = useMemo(
    () => `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #0B1120; }
    .custom-pin-wrapper {
      background: transparent !important;
      border: none !important;
    }
    .user-wrap {
      position: relative;
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      transform: translate(-50%, -50%);
    }
    .user-pulse {
      position: absolute;
      width: 34px; height: 34px; border-radius: 50%;
      background: rgba(56, 189, 248, 0.28);
      animation: pulseRing 2s ease-out infinite;
    }
    .user-dot {
      width: 15px; height: 15px; border-radius: 50%;
      background: #0EA5E9; border: 3px solid #FFFFFF;
      box-shadow: 0 2px 8px rgba(14, 165, 233, 0.75);
      z-index: 2;
    }
    @keyframes pulseRing {
      0% { transform: scale(0.6); opacity: 0.9; }
      100% { transform: scale(1.7); opacity: 0; }
    }
    .dest-pin {
      display: inline-flex; align-items: center; gap: 4px;
      width: max-content; max-width: 190px; overflow: hidden; text-overflow: ellipsis;
      background: #10B981; color: #052E16; font-weight: 800; font-size: 11px;
      padding: 5px 10px; border-radius: 14px; border: 2px solid #FFFFFF;
      white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      transform: translate(-50%, -100%);
    }
    .area-badge {
      display: inline-flex; align-items: center; gap: 5px;
      width: max-content;
      color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11px; font-weight: 700; padding: 4px 9px;
      border-radius: 999px; border: 2px solid #FFFFFF;
      white-space: nowrap; box-shadow: 0 3px 10px rgba(0,0,0,0.55);
      transform: translate(-50%, -50%);
    }
    .area-badge.on-route {
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.45), 0 3px 12px rgba(0,0,0,0.65);
    }
    .area-count {
      background: rgba(0,0,0,0.32); border-radius: 999px;
      padding: 1px 6px; font-size: 10px; font-weight: 800;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map', { zoomControl: false }).setView([23.7600, 90.3950], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    let userMarker = null;
    let destMarker = null;
    let routeLine = null;
    let alertLayer = L.layerGroup().addTo(map);

    map.on('click', function(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pinDestination',
        lat: e.latlng.lat,
        lon: e.latlng.lng
      }));
    });

    window.updateMapState = function(payload) {
      const { currentLocation, destination, todoText, markers } = payload;

      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([currentLocation.lat, currentLocation.lon], {
        icon: L.divIcon({
          className: 'custom-pin-wrapper',
          html: '<div class="user-wrap"><div class="user-pulse"></div><div class="user-dot"></div></div>',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        })
      }).addTo(map);

      if (destMarker) map.removeLayer(destMarker);
      const label = todoText ? ('🎯 ' + todoText) : (destination.label || '🎯 Destination');
      destMarker = L.marker([destination.lat, destination.lon], {
        icon: L.divIcon({ className: 'custom-pin-wrapper', html: '<div class="dest-pin">' + label.replace(/</g,'&lt;') + '</div>', iconSize: [0, 0], iconAnchor: [0, 0] })
      }).addTo(map);

      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.polyline(
        [[currentLocation.lat, currentLocation.lon], [destination.lat, destination.lon]],
        { color: '#38BDF8', weight: 4, dashArray: '8, 8', opacity: 0.9 }
      ).addTo(map);

      alertLayer.clearLayers();
      markers.forEach(function(m) {
        L.circle([m.lat, m.lon], {
          radius: m.onRoute ? 520 : 380,
          color: m.color,
          weight: 1.5,
          opacity: 0.65,
          fillColor: m.color,
          fillOpacity: m.onRoute ? 0.24 : 0.14
        }).addTo(alertLayer);

        const cls = 'area-badge' + (m.onRoute ? ' on-route' : '');
        const htmlBadge = '<div class="' + cls + '" style="background:' + m.color + ';">'
          + '<span>' + m.area + '</span>'
          + '<span class="area-count">' + m.clusterCount + '</span>'
          + '</div>';
        const marker = L.marker([m.lat, m.lon], {
          icon: L.divIcon({ className: 'custom-pin-wrapper', html: htmlBadge, iconSize: [0, 0], iconAnchor: [0, 0] })
        });
        marker.on('click', function(ev) {
          L.DomEvent.stopPropagation(ev);
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'selectArea',
            area: m.area
          }));
        });
        marker.addTo(alertLayer);
      });
    };

    window.focusLocation = function(lat, lon, zoom) {
      map.flyTo([lat, lon], zoom || 14, { duration: 0.6 });
    };

    window.fitRouteBounds = function(lat1, lon1, lat2, lon2) {
      const bounds = L.latLngBounds([[lat1, lon1], [lat2, lon2]]);
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 14 });
    };
  </script>
</body>
</html>`,
    []
  );

  const pushStateToWebView = () => {
    const payload = JSON.stringify({
      currentLocation,
      destination,
      todoText,
      markers: areaMarkers,
    });
    webRef.current?.injectJavaScript(`window.updateMapState && window.updateMapState(${payload}); true;`);
  };

  useEffect(() => {
    pushStateToWebView();
  }, [currentLocation, destination, todoText, areaMarkers]);

  useEffect(() => {
    if (focusCoords) {
      webRef.current?.injectJavaScript(
        `window.focusLocation && window.focusLocation(${focusCoords.lat}, ${focusCoords.lon}, ${focusCoords.zoom || 14}); true;`
      );
    }
  }, [focusCoords]);

  useEffect(() => {
    if (fitRouteNonce) {
      webRef.current?.injectJavaScript(
        `window.fitRouteBounds && window.fitRouteBounds(${currentLocation.lat}, ${currentLocation.lon}, ${destination.lat}, ${destination.lon}); true;`
      );
    }
  }, [fitRouteNonce]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "pinDestination") {
        onPinDestination(msg.lat, msg.lon);
      } else if (msg.type === "selectArea") {
        onSelectArea(msg.area);
      }
    } catch {
      // ignore malformed messages
    }
  };

  return (
    <View style={styles.container}>
      <TypedWebView
        ref={webRef}
        source={{ html }}
        style={styles.webview}
        onLoadEnd={pushStateToWebView}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B1120",
  },
  webview: {
    flex: 1,
    backgroundColor: "#0B1120",
  },
});
