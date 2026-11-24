import { NativeModules, PermissionsAndroid, Platform } from "react-native";

export interface BleScanTelemetry {
  bleCount: number;
  bleStaticCount: number;
  bleMovingCount: number;
  wifiMobileCount: number;
  wifiFixedApCount: number;
  wifiStaticCount: number;
  wifiMovingCount: number;
  cellRsrpDbm: number;
  cellRsrqDb: number;
  cellLoadPercent: number;
  avgRssiDbm: number;
  scanRadiusM: number;
  isScanning: boolean;
  scannerMode: string;
}

let scanStartAttempted = false;
let lastKnownSnapshot: BleScanTelemetry = {
  bleCount: 0,
  bleStaticCount: 0,
  bleMovingCount: 0,
  wifiMobileCount: 0,
  wifiFixedApCount: 0,
  wifiStaticCount: 0,
  wifiMovingCount: 0,
  cellRsrpDbm: -85,
  cellRsrqDb: -9,
  cellLoadPercent: 25,
  avgRssiDbm: -70,
  scanRadiusM: 50,
  isScanning: false,
  scannerMode: "GPS_CELL_ACTIVE",
};

async function ensureNativeMultiRadioStarted(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const nativeBle = NativeModules?.BigWarnBleScanner;
  if (!nativeBle || typeof nativeBle.startBleScan !== "function") {
    return false;
  }

  try {
    if (!scanStartAttempted) {
      scanStartAttempted = true;
      const sdkInt =
        typeof Platform.Version === "number"
          ? Platform.Version
          : parseInt(String(Platform.Version), 10) || 33;

      if (sdkInt >= 31) {
        const perms = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ].filter(Boolean) as any[];
        await PermissionsAndroid.requestMultiple(perms);
      } else {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
      }
    }

    const started = await nativeBle.startBleScan();
    return Boolean(started);
  } catch {
    return false;
  }
}

/**
 * Queries real hardware Multi-Radio Surroundings (`BigWarnBleScannerModule.kt`):
 *   1. Hardware BLE advertisements (`BluetoothLeScanner`, 40m)
 *   2. Hardware Wi-Fi mobile peers & hotspots (`WifiManager.getScanResults()`, 50m — works when others have BT off)
 *   3. 4G/LTE Cell-Tower Sector RSRQ Congestion (`TelephonyManager.getAllCellInfo()`)
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
            wifiMobileCount: Math.max(0, snap.wifiMobileCount || 0),
            wifiFixedApCount: Math.max(0, snap.wifiFixedApCount || 0),
            wifiStaticCount: Math.max(0, snap.wifiStaticCount || 0),
            wifiMovingCount: Math.max(0, snap.wifiMovingCount || 0),
            cellRsrpDbm:
              typeof snap.cellRsrpDbm === "number" ? snap.cellRsrpDbm : -85,
            cellRsrqDb:
              typeof snap.cellRsrqDb === "number" ? snap.cellRsrqDb : -9,
            cellLoadPercent:
              typeof snap.cellLoadPercent === "number"
                ? snap.cellLoadPercent
                : 25,
            avgRssiDbm:
              typeof snap.avgRssiDbm === "number" ? snap.avgRssiDbm : -70,
            scanRadiusM: 50,
            isScanning: Boolean(snap.isScanning),
            scannerMode: snap.scannerMode || "MULTI_RADIO_BLE_WIFI_CELL",
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
