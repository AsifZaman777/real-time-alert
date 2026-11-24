import { NativeModules, PermissionsAndroid, Platform } from "react-native";

export interface BleScanTelemetry {
  bleCount: number;
  bleStaticCount: number;
  bleMovingCount: number;
  btClassicCount: number;
  wifiMobileCount: number;
  wifiHotspotCount: number;
  wifiP2pCount: number;
  wifiLanPeerCount: number;
  wifiFixedApCount: number;
  wifiStaticCount: number;
  wifiMovingCount: number;
  cellRsrpDbm: number;
  cellRsrqDb: number;
  cellRssnrDb: number;
  cellLoadPercent: number;
  cellTowerCount: number;
  cellNetworkType: string;
  avgRssiDbm: number;
  scanRadiusM: number;
  isScanning: boolean;
  isBtEnabled: boolean;
  isWifiEnabled: boolean;
  isLocationEnabled: boolean;
  hasBlePerm: boolean;
  hasWifiPerm: boolean;
  diagStatus: string;
  scannerMode: string;
}

let scanStartAttempted = false;
let lastKnownSnapshot: BleScanTelemetry = {
  bleCount: 0,
  bleStaticCount: 0,
  bleMovingCount: 0,
  btClassicCount: 0,
  wifiMobileCount: 0,
  wifiHotspotCount: 0,
  wifiP2pCount: 0,
  wifiLanPeerCount: 0,
  wifiFixedApCount: 0,
  wifiStaticCount: 0,
  wifiMovingCount: 0,
  cellRsrpDbm: -85,
  cellRsrqDb: -9,
  cellRssnrDb: 10,
  cellLoadPercent: 0,
  cellTowerCount: 0,
  cellNetworkType: "INIT",
  avgRssiDbm: -70,
  scanRadiusM: 50,
  isScanning: false,
  isBtEnabled: false,
  isWifiEnabled: false,
  isLocationEnabled: false,
  hasBlePerm: false,
  hasWifiPerm: false,
  diagStatus: "NATIVE_MODULE_UNAVAILABLE",
  scannerMode: "GPS_ONLY_FALLBACK",
};

export async function requestMultiRadioPermissionsAsync(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const sdkInt =
      typeof Platform.Version === "number"
        ? Platform.Version
        : parseInt(String(Platform.Version), 10) || 33;

    const perms: string[] = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];

    if (sdkInt >= 31) {
      if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN) {
        perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
      }
      if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
        perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
      }
      if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE) {
        perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE);
      } else {
        perms.push("android.permission.BLUETOOTH_ADVERTISE");
      }
    }

    if (sdkInt >= 33) {
      perms.push("android.permission.NEARBY_WIFI_DEVICES");
    }

    await PermissionsAndroid.requestMultiple(perms.filter(Boolean) as any[]);
  } catch {}
}

async function ensureNativeMultiRadioStarted(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const nativeBle = NativeModules?.BigWarnBleScanner;
  if (!nativeBle || typeof nativeBle.startBleScan !== "function") {
    return false;
  }

  try {
    if (!scanStartAttempted) {
      scanStartAttempted = true;
      await requestMultiRadioPermissionsAsync();
    }

    const started = await nativeBle.startBleScan();
    return Boolean(started);
  } catch {
    return false;
  }
}

/**
 * Queries real hardware Multi-Radio Surroundings (`BigWarnBleScannerModule.kt`):
 *   1. Radio A — Hardware BLE + Advertiser + Classic BT discovery (40m)
 *   2. Radio B — Wi-Fi Hotspots + Wi-Fi Direct P2P + Same-Wi-Fi Room LAN & mDNS peers (50m, works when BT is OFF)
 *   3. Radio C — 4G LTE / 5G NR / 3G Cell-Tower Sector Load (`requestCellInfoUpdate`)
 *
 * Strictly returns ONLY real hardware signals physically detected by the phone's radios.
 */
export async function scanNearbyBleCrowdAsync(
  speedKmh: number
): Promise<BleScanTelemetry> {
  if (Platform.OS === "android") {
    const nativeBle = NativeModules?.BigWarnBleScanner;
    if (nativeBle && typeof nativeBle.getScanSnapshot === "function") {
      await ensureNativeMultiRadioStarted();
      try {
        const snap = await nativeBle.getScanSnapshot(speedKmh);
        if (snap && typeof snap.bleCount === "number") {
          lastKnownSnapshot = {
            bleCount: Math.max(0, snap.bleCount),
            bleStaticCount: Math.max(0, snap.bleStaticCount || 0),
            bleMovingCount: Math.max(0, snap.bleMovingCount || 0),
            btClassicCount: Math.max(0, snap.btClassicCount || 0),
            wifiMobileCount: Math.max(0, snap.wifiMobileCount || 0),
            wifiHotspotCount: Math.max(0, snap.wifiHotspotCount || 0),
            wifiP2pCount: Math.max(0, snap.wifiP2pCount || 0),
            wifiLanPeerCount: Math.max(0, snap.wifiLanPeerCount || 0),
            wifiFixedApCount: Math.max(0, snap.wifiFixedApCount || 0),
            wifiStaticCount: Math.max(0, snap.wifiStaticCount || 0),
            wifiMovingCount: Math.max(0, snap.wifiMovingCount || 0),
            cellRsrpDbm:
              typeof snap.cellRsrpDbm === "number" ? snap.cellRsrpDbm : -85,
            cellRsrqDb:
              typeof snap.cellRsrqDb === "number" ? snap.cellRsrqDb : -9,
            cellRssnrDb:
              typeof snap.cellRssnrDb === "number" ? snap.cellRssnrDb : 10,
            cellLoadPercent:
              typeof snap.cellLoadPercent === "number"
                ? snap.cellLoadPercent
                : 0,
            cellTowerCount: Math.max(0, snap.cellTowerCount || 0),
            cellNetworkType: snap.cellNetworkType || "NONE",
            avgRssiDbm:
              typeof snap.avgRssiDbm === "number" ? snap.avgRssiDbm : -70,
            scanRadiusM: snap.scanRadiusM || 50,
            isScanning: Boolean(snap.isScanning),
            isBtEnabled: Boolean(snap.isBtEnabled),
            isWifiEnabled: Boolean(snap.isWifiEnabled),
            isLocationEnabled: Boolean(snap.isLocationEnabled),
            hasBlePerm: Boolean(snap.hasBlePerm),
            hasWifiPerm: Boolean(snap.hasWifiPerm),
            diagStatus: snap.diagStatus || "OK",
            scannerMode: snap.scannerMode || "NATIVE_MULTI_RADIO",
          };
          return lastKnownSnapshot;
        }
      } catch {
        // fall through
      }
    }
  }

  return lastKnownSnapshot;
}
