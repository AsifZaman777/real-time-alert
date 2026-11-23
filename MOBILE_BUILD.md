# BigWarn Mobile App — Local Android APK Build & Update Guide

This guide explains how to set up your Mac once to build the **BigWarn Edge Android `.apk`** locally (~2 minutes per build, no Android Studio IDE needed), and how to rebuild & ship updates whenever you change the mobile app.

---

## 1. One-Time Mac Setup (JDK 17 + Android SDK CLI)

Run these commands once on your Mac:

```bash
# 1. Fix Homebrew permissions if needed
sudo chown -R "$(whoami)" /opt/homebrew
chmod -R u+w /opt/homebrew

# 2. Install JDK 17 and Android command-line tools
brew install openjdk@17
brew install --cask android-commandlinetools

# 3. Persist environment variables in ~/.zshrc
cat << 'EOF' >> ~/.zshrc

# Android Local Build (BigWarn)
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
EOF

source ~/.zshrc
mkdir -p "$ANDROID_HOME"

# 4. Accept Android licenses & install SDK 35
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

---

## 2. How to Build & Update the APK Every Time You Change the App

Whenever you edit `mobile/` code or update `EXPO_PUBLIC_BIGWARN_FEED_URL` in `mobile/.env`:

1. **Check `mobile/.env`** has the active live backend HTTPS URL and token:
   ```env
   EXPO_PUBLIC_BIGWARN_FEED_URL=https://your-live-tunnel-url.trycloudflare.com
   EXPO_PUBLIC_BIGWARN_FEED_TOKEN=your-feed-token
   ```
   *(Expo bakes `EXPO_PUBLIC_*` variables into the APK's compiled JS bundle at build time.)*

2. *(Optional for user updates)* Bump `"version"` in `mobile/app.json` (e.g., `"1.0.0"` → `"1.0.1"`).

3. **Run the build script:**
   ```bash
   /Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/build_apk.sh
   ```
   This automatically:
   - Switches to Node 22 and runs `npx tsc --noEmit`.
   - Loads `mobile/.env` and runs `npx expo prebuild --platform android --clean`.
   - Compiles `android/app/build/outputs/apk/release/app-release.apk` with Gradle.
   - Copies the updated APK to `frontend/public/downloads/bigwarn-edge.apk` so your web `/download` page immediately serves the new build.

4. **Publish the Frontend (if deployed on Vercel):**
   Commit & push (or upload to GitHub Releases / Cloudflare R2) so users downloading from `/download` get the latest APK.

---

## 3. Manual Build Commands (If Running Step-by-Step)

```bash
source ~/.nvm/nvm.sh && nvm use 22
cd /Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile

set -a && source .env && set +a
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease

cp app/build/outputs/apk/release/app-release.apk ../../frontend/public/downloads/bigwarn-edge.apk
```

---

## 4. Alternative: Cloud APK Build via Expo EAS

If you want Expo's cloud to sign and build with a persistent release keystore (recommended when distributing publicly so users can upgrade in-place):

```bash
cd /Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile
set -a && source .env && set +a
eas env:set EXPO_PUBLIC_BIGWARN_FEED_URL "$EXPO_PUBLIC_BIGWARN_FEED_URL" --environment preview
eas env:set EXPO_PUBLIC_BIGWARN_FEED_TOKEN "$EXPO_PUBLIC_BIGWARN_FEED_TOKEN" --environment preview
eas build -p android --profile preview
```
