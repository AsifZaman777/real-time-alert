# ==============================================================================
# BigWarn Mobile — 1-Click USB Android Deployment Script
# Automatically configures ANDROID_HOME & platform-tools (adb) for this session,
# verifies your USB-connected phone, and installs the app with its custom icon.
# ==============================================================================
param(
    [switch]$Release
)

$SdkPath = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $SdkPath)) {
    Write-Host "ERROR: Android SDK not found at $SdkPath" -ForegroundColor Red
    exit 1
}

$env:ANDROID_HOME = $SdkPath
$env:ANDROID_SDK_ROOT = $SdkPath
$env:PATH = "$SdkPath\platform-tools;$SdkPath\emulator;$env:PATH"

Write-Host "Checking connected USB Android devices..." -ForegroundColor Cyan
& "$SdkPath\platform-tools\adb.exe" start-server | Out-Null
$devices = & "$SdkPath\platform-tools\adb.exe" devices | Select-String "\tdevice$"

if (-not $devices) {
    Write-Host "`nNo authorized USB Android phone detected!" -ForegroundColor Yellow
    Write-Host "Please do the following on your Android phone:"
    Write-Host "  1. Settings -> About Phone -> Tap 'Build Number' 7 times"
    Write-Host "  2. Settings -> Developer Options -> Turn ON 'USB Debugging'"
    Write-Host "  3. Plug in your USB cable (set USB mode to File Transfer / MTP)"
    Write-Host "  4. Tap 'Allow USB Debugging' on the phone popup"
    Write-Host "`nThen re-run:  .\deploy_usb.ps1" -ForegroundColor Green
    exit 1
}

Write-Host "Phone detected:" -ForegroundColor Green
$devices | ForEach-Object { Write-Host "  -> $_" }

if ($Release) {
    Write-Host "`nBuilding & installing standalone RELEASE APK (works without Metro server)..." -ForegroundColor Cyan
    npx expo run:android --variant release
} else {
    Write-Host "`nBuilding & installing DEBUG app via USB..." -ForegroundColor Cyan
    npx expo run:android
}
