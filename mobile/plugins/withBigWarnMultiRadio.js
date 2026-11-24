const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");

const REQUIRED_PERMISSIONS = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.CHANGE_WIFI_STATE",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CHANGE_NETWORK_STATE",
  "android.permission.NEARBY_WIFI_DEVICES",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_ADVERTISE",
];

module.exports = function withBigWarnMultiRadio(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    const perms = manifest["uses-permission"];
    for (const name of REQUIRED_PERMISSIONS) {
      if (!perms.some((p) => p.$ && p.$["android:name"] === name)) {
        perms.push({ $: { "android:name": name } });
      }
    }
    if (!manifest["uses-feature"]) manifest["uses-feature"] = [];
    const features = manifest["uses-feature"];
    if (!features.some((f) => f.$ && f.$["android:name"] === "android.hardware.bluetooth_le")) {
      features.push({
        $: { "android:name": "android.hardware.bluetooth_le", "android:required": "false" },
      });
    }
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes("add(BigWarnBleScannerPackage())")) {
      contents = contents.replace(
        "PackageList(this).packages.apply {",
        "PackageList(this).packages.apply {\n          add(BigWarnBleScannerPackage())"
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(__dirname, "android");
      const pkgDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "bigwarn",
        "edge"
      );
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.copyFileSync(
        path.join(srcDir, "BigWarnBleScannerPackage.kt"),
        path.join(pkgDir, "BigWarnBleScannerPackage.kt")
      );
      fs.copyFileSync(
        path.join(srcDir, "BigWarnBleScannerModule.kt"),
        path.join(pkgDir, "BigWarnBleScannerModule.kt")
      );

      const proguardPath = path.join(platformRoot, "app", "proguard-rules.pro");
      if (fs.existsSync(proguardPath)) {
        let pg = fs.readFileSync(proguardPath, "utf-8");
        if (!pg.includes("com.bigwarn.edge.**")) {
          pg +=
            "\n# Keep BigWarn Multi-Radio Native Module & @ReactMethod annotations\n" +
            "-keep class com.bigwarn.edge.** { *; }\n" +
            "-keepclassmembers class * {\n" +
            "  @com.facebook.react.bridge.ReactMethod <methods>;\n" +
            "}\n";
          fs.writeFileSync(proguardPath, pg, "utf-8");
        }
      }
      return cfg;
    },
  ]);

  return config;
};
