#!/usr/bin/env bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$MOBILE_DIR/.." && pwd)"
APK_OUT="$ROOT_DIR/frontend/public/downloads/bigwarn-edge.apk"

# Load Node 22 via nvm if available
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null || true
fi

# Configure Java 17 & Android SDK paths if not already exported
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

if [[ ! -f "$MOBILE_DIR/.env" ]]; then
  echo "ERROR: $MOBILE_DIR/.env not found. Copy .env.example to .env and set EXPO_PUBLIC_BIGWARN_FEED_URL."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$MOBILE_DIR/.env"
set +a

cd "$MOBILE_DIR"
echo "==> Running TypeScript check..."
npx tsc --noEmit

echo "==> Syncing native Android project (via plugins/withBigWarnMultiRadio.js)..."
npx expo prebuild --platform android --no-install

echo "==> Verifying BigWarnBleScannerModule.kt was generated..."
if [[ ! -f "$MOBILE_DIR/android/app/src/main/java/com/bigwarn/edge/BigWarnBleScannerModule.kt" ]]; then
  echo "ERROR: BigWarnBleScannerModule.kt missing after expo prebuild!"
  exit 1
fi

echo "==> Building Release APK (arm64-v8a)..."
cd "$MOBILE_DIR/android"
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a

mkdir -p "$(dirname "$APK_OUT")"
cp "$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk" "$APK_OUT"
echo "==> Done! Updated APK saved to: $APK_OUT"
