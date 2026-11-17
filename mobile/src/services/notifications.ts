import { Platform, Vibration } from "react-native";
import * as Notifications from "expo-notifications";
import { GoldAlert } from "../types/alert";

const CHANNEL_ID = "route-anomaly-alerts";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function initNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Route Anomaly & Strike Alerts",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 200, 250],
        lightColor: "#EF4444",
        sound: "default",
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === "granted";
  } catch {
    return false;
  }
}

const EVENT_LABELS: Record<string, string> = {
  blockade: "Road Blockade",
  strike: "Strike / Hartal",
  clash: "Street Clash",
  fire: "Fire Incident",
  procession: "Protest Procession",
  accident: "Road Accident",
  waterlogging: "Waterlogging",
  power_outage: "Power Outage",
};

export function formatEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] || eventType.replace(/_/g, " ").toUpperCase();
}

export function buildRouteAnomalyMessage(alert: GoldAlert): {
  title: string;
  body: string;
} {
  const label = formatEventLabel(alert.event_type);
  const distText =
    typeof alert.distance_to_route_km === "number"
      ? `${alert.distance_to_route_km} km from your route`
      : "along your route";

  return {
    title: `⚠️ Route Anomaly: Change Your Route`,
    body: `There is a ${label} near ${alert.area} (${distText}). Please change your route. ${alert.veracity_summary} (${alert.veracity_percent}%).`,
  };
}

export async function sendRouteAnomalyNotification(
  alert: GoldAlert,
  soundEnabled: boolean = true
): Promise<void> {
  try {
    const { title, body } = buildRouteAnomalyMessage(alert);
    if (soundEnabled) {
      Vibration.vibrate([0, 220, 140, 220]);
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: soundEnabled ? "default" : undefined,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { area: alert.area, clusterId: alert.cluster_id },
      },
      trigger: null,
    });
  } catch {
    // Gracefully ignore if simulator/device blocks notification scheduling
  }
}
