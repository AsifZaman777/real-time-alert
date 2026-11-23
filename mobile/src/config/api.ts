import { NativeModules } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Coordinates } from "../types/alert";

function extractHost(uri?: string | null): string | null {
  if (!uri || typeof uri !== "string") return null;
  const cleaned = uri.replace(/^[a-z0-9+.-]+:\/\//i, "");
  const host = cleaned.split(/[/:?#]/)[0];
  if (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".exp.direct")
  ) {
    return null;
  }
  return host;
}

function parseMaybeJson(val: unknown): any {
  if (!val) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return val;
}

function detectDevHost(): string | null {
  try {
    const expoUpdates: any = requireOptionalNativeModule("ExpoUpdates");
    const uManifest =
      parseMaybeJson(expoUpdates?.manifest) ||
      parseMaybeJson(expoUpdates?.manifestString);
    const uCandidates = [
      uManifest?.extra?.expoClient?.hostUri,
      uManifest?.extra?.expoGo?.debuggerHost,
      uManifest?.hostUri,
    ];
    for (const c of uCandidates) {
      const host = extractHost(c);
      if (host) return host;
    }
  } catch {
    // ignore
  }

  try {
    const expConst: any = requireOptionalNativeModule("ExponentConstants");
    if (expConst) {
      const manifest = parseMaybeJson(expConst.manifest);
      const candidates = [
        manifest?.extra?.expoClient?.hostUri,
        manifest?.extra?.expoGo?.debuggerHost,
        manifest?.hostUri,
        manifest?.debuggerHost,
        expConst.experienceUrl,
        expConst.linkingUri,
      ];
      for (const c of candidates) {
        const host = extractHost(c);
        if (host) return host;
      }
    }
  } catch {
    // ignore
  }

  try {
    const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
    const host = extractHost(scriptURL);
    if (host) return host;
  } catch {
    // ignore
  }

  return null;
}

const envFeedUrl = (process.env.EXPO_PUBLIC_BIGWARN_FEED_URL || "").trim().replace(/\/+$/, "");
const detectedHost = detectDevHost();

export const API_BASE_URL =
  envFeedUrl || (detectedHost ? `http://${detectedHost}:8765` : "http://127.0.0.1:8765");

export const FEED_ACCESS_TOKEN = (process.env.EXPO_PUBLIC_BIGWARN_FEED_TOKEN || "").trim();

export const DHAKA_PRESETS: Record<string, Coordinates> = {
  Dhanmondi: { lat: 23.7461, lon: 90.3742, label: "Dhanmondi" },
  Motijheel: { lat: 23.7330, lon: 90.4172, label: "Motijheel" },
  "Mirpur-10": { lat: 23.8069, lon: 90.3687, label: "Mirpur-10" },
  Shahbagh: { lat: 23.7389, lon: 90.3948, label: "Shahbagh" },
  Farmgate: { lat: 23.7561, lon: 90.3872, label: "Farmgate" },
  Uttara: { lat: 23.8759, lon: 90.3795, label: "Uttara" },
  Gulshan: { lat: 23.7925, lon: 90.4158, label: "Gulshan" },
};
