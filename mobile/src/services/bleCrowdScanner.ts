import { NativeModules, PermissionsAndroid, Platform } from "react-native";

export interface BleScanTelemetry {
  bleCount: number;
  bleStaticCount: number;
  bleMovingCount: number;
  avgRssiDbm: number;
  scanRadiusM: number;
  isScanning: boolean;
  scannerMode: "NATIVE_BLE_HARDWARE" | "BLE_PERMISSION_OR_ADAPTER_OFF";
}

let scanStartAttempted = false;
let lastKnownSnapshot: BleScanTelemetry = {
  bleCount: 0,
  bleStaticCount: 0,
  bleMovingCount: 0,
  avgRssiDbm: -70,
  scanRadiusM: 40,
  isScanning: false,
  scannerMode: "BLE_PERMISSION_OR_ADAPTER_OFF",
};

async function ensureNativeBleHardwareStarted(): Promise<boolean> {
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
 * Queries real hardware Bluetooth Low Energy (`android.bluetooth.le.BluetoothLeScanner`)
 * packets captured by `BigWarnBleScannerModule.kt`.
 *
 * Strictly returns ONLY real BLE devices physically heard by the phone's Bluetooth radio.
 * Zero synthetic coordinate-hash or simulated fallback numbers are ever returned!
 */
export async function scanNearbyBleCrowdAsync(
  speedKmh: number
): Promise<BleScanTelemetry> {
  if (Platform.OS === "android") {
    const nativeBle = NativeModules?.BigWarnBleScanner;
    if (nativeBle && typeof nativeBle.getScanSnapshot === "function") {
      await ensureNativeBleHardwareStarted();
      try {
        const snap = await nativeBle.getScanSnapshot(speedKmh);
        if (snap && typeof snap.bleCount === "number") {
          lastKnownSnapshot = {
            bleCount: Math.max(0, snap.bleCount),
            bleStaticCount: Math.max(0, snap.bleStaticCount || 0),
            bleMovingCount: Math.max(0, snap.bleMovingCount || 0),
            avgRssiDbm: typeof snap.avgRssiDbm === "number" ? snap.avgRssiDbm : -70,
            scanRadiusM: 40,
            isScanning: Boolean(snap.isScanning),
            scannerMode: snap.isScanning
              ? "NATIVE_BLE_HARDWARE"
              : "BLE_PERMISSION_OR_ADAPTER_OFF",
          };
          return lastKnownSnapshot;
        }
      } catch {
        // fall through to zero snapshot
      }
    }
  }

  // When running on Web or if Bluetooth adapter is off, return 0 nearby BLE peers
  // (never fabricate fake BLE device counts!)
  return lastKnownSnapshot;
}
