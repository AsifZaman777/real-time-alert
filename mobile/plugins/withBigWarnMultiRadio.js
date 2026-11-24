const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");

const PACKAGE_KT = `package com.bigwarn.edge

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class BigWarnBleScannerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(BigWarnBleScannerModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

const MODULE_KT = `package com.bigwarn.edge

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.ScanResult as WifiScanResult
import android.net.wifi.WifiManager
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.ParcelUuid
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellSignalStrengthGsm
import android.telephony.CellSignalStrengthLte
import android.telephony.CellSignalStrengthNr
import android.telephony.CellSignalStrengthWcdma
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.ConnectException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class BigWarnBleScannerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  companion object {
    const val CAT_PHONE = "PHONE"
    const val CAT_ROUTER = "ROUTER"
    const val CAT_AUDIO_WEARABLE = "AUDIO_WEARABLE"
    const val CAT_TV_PC_IOT = "TV_PC_IOT"
    const val CAT_UNKNOWN = "UNKNOWN"
  }

  data class PeerReading(
    var firstRssi: Int,
    var lastRssi: Int,
    var packetCount: Int,
    var lastSeenMs: Long,
    var category: String = CAT_UNKNOWN,
    var modelLabel: String = "",
    var radioSource: String = ""
  )

  private val bgExecutor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

  // Radio A: BLE + Classic BT (phones vs filtered earbuds/watches/PCs)
  private val btAllPeers = ConcurrentHashMap<String, PeerReading>()
  private var bleScanner: BluetoothLeScanner? = null
  private var bleAdvertiser: BluetoothLeAdvertiser? = null
  private var activeScanCallback: ScanCallback? = null
  private var activeAdvertiseCallback: AdvertiseCallback? = null
  private var isBleScanning = false
  private var isBleAdvertising = false
  private var lastClassicBtDiscoveryMs = 0L

  // Radio B: Wi-Fi Hotspots/APs + Wi-Fi Direct P2P + Room LAN & mDNS + SSDP exclusions
  private val wifiScannedAps = ConcurrentHashMap<String, PeerReading>()
  private val wifiP2pPeers = ConcurrentHashMap<String, PeerReading>()
  private val wifiLanPeers = ConcurrentHashMap<String, PeerReading>()
  private val lanFilteredIps = ConcurrentHashMap<String, Pair<String, String>>() // ip -> (cat, model)
  private val lanMdnsModels = ConcurrentHashMap<String, Triple<String, String, Long>>() // ip/key -> (cat, model, ts)
  private var wifiP2pManager: WifiP2pManager? = null
  private var wifiP2pChannel: WifiP2pManager.Channel? = null
  private var nsdManager: NsdManager? = null
  private val nsdListeners = mutableListOf<NsdManager.DiscoveryListener>()
  private var receiversRegistered = false
  private var mdnsStarted = false
  private var lastWifiScanTriggerMs = 0L
  private var lastP2pTriggerMs = 0L
  private var lastLanSweepMs = 0L
  @Volatile private var lanSweepRunning = false

  // Radio C: Cellular 4G/5G/3G Cell Load
  @Volatile private var cachedCellRsrp = -85
  @Volatile private var cachedCellRsrq = -9
  @Volatile private var cachedCellRssnr = 10
  @Volatile private var cachedCellLoadPct = 0
  @Volatile private var cachedCellNetworkType = "INIT"
  @Volatile private var cachedCellTowerCount = 0
  private var lastCellRefreshMs = 0L

  private val peerTtlMs = 60_000L
  private val wifiPeerTtlMs = 95_000L

  // Phone model/hotspot keywords vs Router/Audio/TV exclusion keywords
  private val phoneModelRegex = Regex(
    "(?i)(iPhone|Galaxy|Samsung|Redmi|Xiaomi|POCO|Poco|vivo|OPPO|Realme|OnePlus|Pixel|Nothing|Motorola|Moto|Nokia\\s*[0-9GXC]|Huawei|Honor|Tecno|Infinix|Itel|Symphony|Walton|AndroidAP|AndroidShare|BigWarn)"
  )
  private val audioWearableRegex = Regex(
    "(?i)(AirPods|Beats|Galaxy\\s*Buds|Buds\\s*[0-9ProLiveFE]*|TWS|Earbud|Earphone|Headset|Headphone|Speaker|Soundcore|Anker|JBL|boAt|Boat|Oraimo|QCY|Haylou|Edifier|Marshall|Bose|Sony\\s*WH|Sony\\s*WF|Marshall|Watch|Mi\\s*Band|Smart\\s*Band|Galaxy\\s*Fit|Amazfit|Mibro|Garmin|Fitbit)"
  )
  private val routerApRegex = Regex(
    "(?i)(TP-?Link|TL-?W|Archer|Tenda|Mercusys|MERCUSYS|D-?Link|Netis|NETIS|MikroTik|Cisco|Ubiquiti|UniFi|Linksys|Netgear|HUAWEI-|HG[0-9]|EG[0-9]|ZTE_|ZXHN|FiberHome|ONT|ONU|Repeater|Extender|Router|Broadband|Wifi|Wi-Fi|_5G|_2\\.4G|5GHz|2\\.4GHz|Guest)"
  )
  private val tvComputerIotRegex = Regex(
    "(?i)(Bravia|QLED|OLED|WebOS|Smart\\s*TV|Android\\s*TV|Mi\\s*TV|Mi\\s*Box|Fire\\s*TV|Chromecast|Roku|Apple\\s*TV|HomePod|MacBook|iMac|Mac\\s*mini|DESKTOP-|LAPTOP-|THINKPAD|Printer|Epson|Canon|HP\\s*Laser|Brother|Camera|ESP_|Tuya|Sonoff)"
  )

  private val bigWarnServiceUuid = ParcelUuid(UUID.fromString("0000b19a-0000-1000-8000-00805f9b34fb"))

  private val radioReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val action = intent?.action ?: return
      when (action) {
        WifiManager.SCAN_RESULTS_AVAILABLE_ACTION -> refreshWifiApResults()
        WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> requestP2pPeersSafe()
        BluetoothDevice.ACTION_FOUND -> {
          val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
          } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
          }
          val addr = device?.address
          if (!addr.isNullOrBlank()) {
            val rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, (-72).toShort()).toInt()
            val name = try {
              if (hasBleConnectPermission()) (device.name ?: "") else ""
            } catch (_: SecurityException) { "" }
            val majorCls = try {
              if (hasBleConnectPermission()) device.bluetoothClass?.majorDeviceClass ?: -1 else -1
            } catch (_: Exception) { -1 }
            val (cat, model) = classifyClassicBluetooth(name, majorCls)
            recordPeer(btAllPeers, addr, rssi, cat, model, "BT_CLASSIC")
          }
        }
      }
    }
  }

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = "BigWarnBleScanner"

  private fun hasPermission(perm: String): Boolean =
    ContextCompat.checkSelfPermission(reactContext, perm) == PackageManager.PERMISSION_GRANTED

  private fun hasFineLocationPermission(): Boolean = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)

  private fun hasAnyLocationPermission(): Boolean =
    hasFineLocationPermission() || hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)

  private fun hasBleScanPermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) hasPermission(Manifest.permission.BLUETOOTH_SCAN)
    else hasAnyLocationPermission()

  private fun hasBleConnectPermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
    else true

  private fun hasBleAdvertisePermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)
    else hasPermission(Manifest.permission.BLUETOOTH_ADMIN)

  private fun hasWifiScanPermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
      hasPermission("android.permission.NEARBY_WIFI_DEVICES") || hasFineLocationPermission()
    else hasAnyLocationPermission()

  private fun isLocationServiceEnabled(): Boolean {
    return try {
      val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lm.isLocationEnabled
      else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    } catch (_: Exception) { true }
  }

  private fun ensureReceiversRegistered() {
    if (receiversRegistered) return
    try {
      val filter = IntentFilter().apply {
        addAction(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
        addAction(BluetoothDevice.ACTION_FOUND)
      }
      if (Build.VERSION.SDK_INT >= 33) {
        reactContext.registerReceiver(radioReceiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        reactContext.registerReceiver(radioReceiver, filter)
      }
      receiversRegistered = true
    } catch (_: Exception) {}
  }

  private fun recordPeer(
    map: ConcurrentHashMap<String, PeerReading>,
    key: String,
    rssi: Int,
    category: String,
    modelLabel: String,
    radioSource: String
  ) {
    val now = System.currentTimeMillis()
    map.compute(key) { _, existing ->
      if (existing == null) {
        PeerReading(rssi, rssi, 1, now, category, modelLabel, radioSource)
      } else {
        existing.lastRssi = rssi
        existing.packetCount += 1
        existing.lastSeenMs = now
        if (category != CAT_UNKNOWN && (existing.category == CAT_UNKNOWN || category == CAT_AUDIO_WEARABLE || category == CAT_ROUTER || category == CAT_TV_PC_IOT)) {
          existing.category = category
        }
        if (modelLabel.isNotBlank() && (existing.modelLabel.isBlank() || existing.modelLabel.startsWith("BLE") || modelLabel.length > existing.modelLabel.length)) {
          existing.modelLabel = modelLabel
        }
        existing
      }
    }
  }

  private fun pruneMap(map: ConcurrentHashMap<String, PeerReading>, ttl: Long) {
    val cutoff = System.currentTimeMillis() - ttl
    val iter = map.entries.iterator()
    while (iter.hasNext()) {
      if (iter.next().value.lastSeenMs < cutoff) iter.remove()
    }
  }

  // Classify Classic Bluetooth peer via BluetoothClass + Name
  private fun classifyClassicBluetooth(name: String, majorCls: Int): Pair<String, String> {
    if (name.isNotBlank()) {
      if (audioWearableRegex.containsMatchIn(name)) return Pair(CAT_AUDIO_WEARABLE, name.take(28))
      if (tvComputerIotRegex.containsMatchIn(name)) return Pair(CAT_TV_PC_IOT, name.take(28))
      if (phoneModelRegex.containsMatchIn(name)) return Pair(CAT_PHONE, name.take(28))
    }
    return when (majorCls) {
      BluetoothClass.Device.Major.PHONE -> Pair(CAT_PHONE, if (name.isNotBlank()) name.take(28) else "Bluetooth Phone")
      BluetoothClass.Device.Major.AUDIO_VIDEO -> Pair(CAT_AUDIO_WEARABLE, if (name.isNotBlank()) name.take(28) else "Bluetooth Audio")
      BluetoothClass.Device.Major.WEARABLE -> Pair(CAT_AUDIO_WEARABLE, if (name.isNotBlank()) name.take(28) else "Smartwatch / Band")
      BluetoothClass.Device.Major.COMPUTER,
      BluetoothClass.Device.Major.IMAGING -> Pair(CAT_TV_PC_IOT, if (name.isNotBlank()) name.take(28) else "Computer / Peripheral")
      else -> Pair(if (name.isNotBlank()) CAT_PHONE else CAT_UNKNOWN, if (name.isNotBlank()) name.take(28) else "BT Device")
    }
  }

  // Extract BLE GAP Appearance (0x19), Apple Continuity subType (0x004C), Vendor IDs, and Device Name
  private fun classifyBleScanResult(result: ScanResult): Pair<String, String> {
    val sr = result.scanRecord
    val devName = (sr?.deviceName ?: "").trim()

    // Check explicit device name patterns first
    if (devName.isNotBlank()) {
      if (audioWearableRegex.containsMatchIn(devName)) return Pair(CAT_AUDIO_WEARABLE, devName.take(28))
      if (tvComputerIotRegex.containsMatchIn(devName)) return Pair(CAT_TV_PC_IOT, devName.take(28))
      if (phoneModelRegex.containsMatchIn(devName)) return Pair(CAT_PHONE, devName.take(28))
    }

    // Check BigWarn advertised beacon UUID
    val uuids = sr?.serviceUuids ?: emptyList()
    for (u in uuids) {
      val s = u.uuid.toString().uppercase()
      if (s.startsWith("0000B19A")) return Pair(CAT_PHONE, "BigWarn App Phone")
      if (s.startsWith("0000180D") || s.startsWith("0000FEE0") || s.startsWith("0000110B") || s.startsWith("0000184E")) {
        return Pair(CAT_AUDIO_WEARABLE, if (devName.isNotBlank()) devName.take(28) else "Wearable / Earbuds")
      }
    }

    // Parse raw AD bytes for GAP Appearance (0x19)
    val rawBytes = sr?.bytes
    if (rawBytes != null) {
      var idx = 0
      while (idx < rawBytes.size - 1) {
        val len = rawBytes[idx].toInt() and 0xFF
        if (len == 0 || idx + len >= rawBytes.size) break
        val adType = rawBytes[idx + 1].toInt() and 0xFF
        if (adType == 0x19 && len >= 3 && idx + 3 < rawBytes.size) {
          val appearance = (rawBytes[idx + 2].toInt() and 0xFF) or ((rawBytes[idx + 3].toInt() and 0xFF) shl 8)
          val categoryTop = appearance shr 6
          if (categoryTop == 1) return Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "Smartphone")
          if (categoryTop == 3 || categoryTop == 33 || categoryTop == 34 || categoryTop == 40) {
            return Pair(CAT_AUDIO_WEARABLE, if (devName.isNotBlank()) devName.take(28) else "Watch / Earbuds")
          }
          if (categoryTop == 2 || categoryTop == 15) {
            return Pair(CAT_TV_PC_IOT, if (devName.isNotBlank()) devName.take(28) else "PC / Peripheral")
          }
        }
        idx += len + 1
      }
    }

    // Check Bluetooth Classic major class if cached by stack
    try {
      if (hasBleConnectPermission()) {
        val cls = result.device?.bluetoothClass?.majorDeviceClass ?: -1
        if (cls == BluetoothClass.Device.Major.AUDIO_VIDEO || cls == BluetoothClass.Device.Major.WEARABLE) {
          return Pair(CAT_AUDIO_WEARABLE, if (devName.isNotBlank()) devName.take(28) else "BT Audio / Watch")
        }
        if (cls == BluetoothClass.Device.Major.COMPUTER) {
          return Pair(CAT_TV_PC_IOT, if (devName.isNotBlank()) devName.take(28) else "Computer")
        }
        if (cls == BluetoothClass.Device.Major.PHONE) {
          return Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "Smartphone")
        }
      }
    } catch (_: Exception) {}

    // Inspect Bluetooth SIG Manufacturer Specific Data IDs
    val mfg = sr?.manufacturerSpecificData
    if (mfg != null && mfg.size() > 0) {
      val appleData = mfg.get(0x004C)
      if (appleData != null && appleData.isNotEmpty()) {
        val subType = appleData[0].toInt() and 0xFF
        return when (subType) {
          0x07 -> Pair(CAT_AUDIO_WEARABLE, "Apple AirPods / Beats")
          0x09, 0x0A -> Pair(CAT_TV_PC_IOT, "Apple TV / HomePod")
          0x12 -> Pair(CAT_AUDIO_WEARABLE, "FindMy Tag / Accessory")
          else -> Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "Apple iPhone")
        }
      }
      if (mfg.get(0x0006) != null) return Pair(CAT_TV_PC_IOT, "Windows PC (Swift Pair)")
      if (mfg.get(0x0075) != null) return Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "Samsung Galaxy")
      if (mfg.get(0x038F) != null) return Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "Xiaomi / Redmi")
      if (mfg.get(0x0837) != null) return Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "vivo Phone")
      if (mfg.get(0x079A) != null || mfg.get(0x009E) != null) return Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "OPPO / Realme / OnePlus")
      if (mfg.get(0x00E0) != null) return Pair(CAT_PHONE, if (devName.isNotBlank()) devName.take(28) else "Android Phone (Google)")
      if (mfg.get(0x0157) != null) return Pair(CAT_AUDIO_WEARABLE, "Amazfit / Huami Watch")
    }

    if (devName.isNotBlank()) return Pair(CAT_PHONE, devName.take(28))
    return Pair(CAT_UNKNOWN, "Unidentified BLE")
  }

  @SuppressLint("MissingPermission")
  private fun ensureBleScanningStarted(): Boolean {
    val btManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val adapter = btManager?.adapter
    if (adapter == null || !adapter.isEnabled || !hasBleScanPermission()) {
      isBleScanning = false
      return false
    }

    if (!isBleAdvertising && hasBleAdvertisePermission()) {
      try {
        bleAdvertiser = adapter.bluetoothLeAdvertiser
        if (bleAdvertiser != null) {
          val advSettings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(false)
            .build()
          val advData = AdvertiseData.Builder()
            .addServiceUuid(bigWarnServiceUuid)
            .setIncludeDeviceName(false)
            .build()
          val advCb = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) { isBleAdvertising = true }
            override fun onStartFailure(errorCode: Int) { isBleAdvertising = false }
          }
          activeAdvertiseCallback = advCb
          bleAdvertiser?.startAdvertising(advSettings, advData, advCb)
        }
      } catch (_: Exception) {}
    }

    if (isBleScanning && activeScanCallback != null) {
      triggerPeriodicClassicBtIfNeeded(adapter)
      return true
    }

    val scanner = adapter.bluetoothLeScanner ?: return false
    bleScanner = scanner

    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val addr = result.device?.address ?: return
        val rssi = result.rssi
        if (rssi < -98 || rssi >= 0) return
        val (cat, model) = classifyBleScanResult(result)
        recordPeer(btAllPeers, addr, rssi, cat, model, "BLE")
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        for (res in results) {
          val addr = res.device?.address ?: continue
          val rssi = res.rssi
          if (rssi < -98 || rssi >= 0) continue
          val (cat, model) = classifyBleScanResult(res)
          recordPeer(btAllPeers, addr, rssi, cat, model, "BLE")
        }
      }

      override fun onScanFailed(errorCode: Int) {
        isBleScanning = false
        activeScanCallback = null
      }
    }

    return try {
      val settingsBuilder = ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .setReportDelay(0L)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        settingsBuilder
          .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
          .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
          .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
      }
      activeScanCallback = cb
      scanner.startScan(null, settingsBuilder.build(), cb)
      isBleScanning = true
      triggerPeriodicClassicBtIfNeeded(adapter)
      true
    } catch (_: Exception) {
      isBleScanning = false
      false
    }
  }

  @SuppressLint("MissingPermission")
  private fun triggerPeriodicClassicBtIfNeeded(adapter: BluetoothAdapter) {
    val now = System.currentTimeMillis()
    if (!hasBleScanPermission() || !hasBleConnectPermission() || !adapter.isEnabled) return
    if (now - lastClassicBtDiscoveryMs < 55_000L) return
    lastClassicBtDiscoveryMs = now
    try {
      if (!adapter.isDiscovering) {
        adapter.startDiscovery()
        bgExecutor.schedule({
          try {
            if (hasBleScanPermission() && adapter.isDiscovering) adapter.cancelDiscovery()
          } catch (_: Exception) {}
        }, 7, TimeUnit.SECONDS)
      }
    } catch (_: Exception) {}
  }

  private fun isLocallyAdministeredMac(bssid: String?): Boolean {
    if (bssid.isNullOrBlank() || bssid.length < 2) return false
    val secondChar = bssid.uppercase()[1]
    return secondChar == '2' || secondChar == '6' || secondChar == 'A' || secondChar == 'E'
  }

  // Extract router manufacturer/model strings inside unencrypted 802.11 WPS/Vendor Information Elements
  private fun extractWifiWpsVendor(sr: WifiScanResult): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return ""
    try {
      val ies = sr.informationElements ?: return ""
      for (ie in ies) {
        if (ie.id == 221 || ie.id == 222) {
          val buf = ie.bytes ?: continue
          val arr = ByteArray(buf.remaining())
          buf.get(arr)
          val ascii = StringBuilder()
          for (b in arr) {
            val c = b.toInt() and 0xFF
            ascii.append(if (c in 32..126) c.toChar() else ' ')
          }
          val txt = ascii.toString()
          val m = routerApRegex.find(txt)
          if (m != null) return m.value
        }
      }
    } catch (_: Exception) {}
    return ""
  }

  @SuppressLint("MissingPermission")
  private fun refreshWifiApResults() {
    val wifiManager = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    if (!wifiManager.isWifiEnabled) return
    try {
      val results = wifiManager.scanResults ?: return

      // Pass 1: Build index of fixed router suffixes (last 4 octets + freq) to spot Multi-SSID / Guest virtual APs
      val fixedRouterSignatures = HashSet<String>()
      for (sr in results) {
        val bssid = (sr.BSSID ?: "").lowercase()
        if (bssid.length < 17) continue
        @Suppress("DEPRECATION")
        val ssid = sr.SSID ?: ""
        val wpsVendor = extractWifiWpsVendor(sr)
        if (!isLocallyAdministeredMac(bssid) || wpsVendor.isNotBlank() || (ssid.isNotBlank() && routerApRegex.containsMatchIn(ssid) && !phoneModelRegex.containsMatchIn(ssid))) {
          fixedRouterSignatures.add(bssid.substring(3, 14) + "@" + sr.frequency)
        }
      }

      // Pass 2: Classify every scanned Wi-Fi AP as PHONE Hotspot vs ROUTER
      for (sr in results) {
        val bssid = (sr.BSSID ?: "").lowercase()
        if (bssid.length < 17 || sr.level < -88 || sr.level >= 0) continue
        @Suppress("DEPRECATION")
        val ssid = sr.SSID ?: ""
        val wpsVendor = extractWifiWpsVendor(sr)
        val hasRouterKeyword = (ssid.isNotBlank() && routerApRegex.containsMatchIn(ssid)) || wpsVendor.isNotBlank()
        val hasPhoneKeyword = ssid.isNotBlank() && phoneModelRegex.containsMatchIn(ssid)
        val isVirtualGuestVap = isLocallyAdministeredMac(bssid) && fixedRouterSignatures.contains(bssid.substring(3, 14) + "@" + sr.frequency)

        if (hasPhoneKeyword && !hasRouterKeyword && !isVirtualGuestVap) {
          recordPeer(wifiScannedAps, bssid, sr.level, CAT_PHONE, ssid.take(28), "WIFI_HOTSPOT")
        } else if (hasRouterKeyword || isVirtualGuestVap || !isLocallyAdministeredMac(bssid)) {
          val rLabel = when {
            wpsVendor.isNotBlank() && ssid.isNotBlank() -> (ssid.take(18) + " [" + wpsVendor + "]")
            ssid.isNotBlank() -> ssid.take(28)
            wpsVendor.isNotBlank() -> wpsVendor + " Router"
            else -> "Fixed Router / Guest AP"
          }
          recordPeer(wifiScannedAps, bssid, sr.level, CAT_ROUTER, rLabel, "WIFI_AP")
        } else {
          // Locally-administered BSSID NOT matching any router WPS IE or Multi-SSID physical AP
          recordPeer(
            wifiScannedAps,
            bssid,
            sr.level,
            CAT_PHONE,
            if (ssid.isNotBlank()) ssid.take(28) else "Mobile Hotspot (LAA)",
            "WIFI_HOTSPOT"
          )
        }
      }
    } catch (_: Exception) {}
  }

  @SuppressLint("MissingPermission")
  private fun ensureWifiP2pInitialized() {
    if (wifiP2pManager != null && wifiP2pChannel != null) return
    try {
      val mgr = reactContext.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager ?: return
      val ch = mgr.initialize(reactContext, reactContext.mainLooper, null)
      wifiP2pManager = mgr
      wifiP2pChannel = ch
    } catch (_: Exception) {}
  }

  @SuppressLint("MissingPermission")
  private fun requestP2pPeersSafe() {
    val mgr = wifiP2pManager ?: return
    val ch = wifiP2pChannel ?: return
    if (!hasWifiScanPermission()) return
    try {
      mgr.requestPeers(ch) { peerList ->
        val list = peerList?.deviceList ?: emptyList<WifiP2pDevice>()
        for (dev in list) {
          val addr = dev.deviceAddress
          if (addr.isNullOrBlank()) continue
          val name = (dev.deviceName ?: "").trim()
          val pType = (dev.primaryDeviceType ?: "").trim()
          val cat = when {
            tvComputerIotRegex.containsMatchIn(name) -> CAT_TV_PC_IOT
            pType.startsWith("7-") -> CAT_TV_PC_IOT // Displays / TVs
            pType.startsWith("3-") -> CAT_ROUTER    // Network Infrastructure
            pType.startsWith("1-") && !phoneModelRegex.containsMatchIn(name) -> CAT_TV_PC_IOT // Computer
            else -> CAT_PHONE // Category 10 (Telephone) or Android P2P phone
          }
          val label = if (name.isNotBlank()) name.take(28) else "Android Phone (P2P)"
          recordPeer(wifiP2pPeers, addr.lowercase(), -62, cat, label, "WIFI_P2P")
        }
      }
    } catch (_: Exception) {}
  }

  @SuppressLint("MissingPermission")
  private fun triggerWifiScansIfNeeded() {
    val wifiManager = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    if (!wifiManager.isWifiEnabled) return
    val now = System.currentTimeMillis()

    refreshWifiApResults()

    if (now - lastWifiScanTriggerMs >= 30_000L && hasWifiScanPermission()) {
      lastWifiScanTriggerMs = now
      try {
        @Suppress("DEPRECATION")
        wifiManager.startScan()
      } catch (_: Exception) {}
    }

    ensureWifiP2pInitialized()
    if (now - lastP2pTriggerMs >= 25_000L && hasWifiScanPermission()) {
      lastP2pTriggerMs = now
      try {
        val mgr = wifiP2pManager
        val ch = wifiP2pChannel
        if (mgr != null && ch != null) {
          mgr.discoverPeers(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { requestP2pPeersSafe() }
            override fun onFailure(reason: Int) {}
          })
        }
      } catch (_: Exception) {}
    }

    ensureMdnsDiscoveryStarted()
    triggerWifiLanRoomSweepIfNeeded()
  }

  private fun ensureMdnsDiscoveryStarted() {
    if (mdnsStarted) return
    val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
    val net = cm.activeNetwork ?: return
    val caps = cm.getNetworkCapabilities(net) ?: return
    if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return

    try {
      val mgr = reactContext.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
      nsdManager = mgr
      mdnsStarted = true
      val serviceTypes = listOf(
        "_companion-link._tcp.",
        "_googlecast._tcp.",
        "_airplay._tcp.",
        "_ipp._tcp."
      )
      for (stype in serviceTypes) {
        val listener = object : NsdManager.DiscoveryListener {
          override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {}
          override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {}
          override fun onDiscoveryStarted(serviceType: String?) {}
          override fun onDiscoveryStopped(serviceType: String?) {}
          override fun onServiceLost(serviceInfo: NsdServiceInfo?) {}
          override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
            val svcName = serviceInfo?.serviceName ?: return
            try {
              @Suppress("DEPRECATION")
              mgr.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                override fun onResolveFailed(si: NsdServiceInfo?, err: Int) {}
                override fun onServiceResolved(si: NsdServiceInfo?) {
                  val hostIp = si?.host?.hostAddress ?: return
                  var model = svcName.take(26)
                  try {
                    val attrs = si.attributes
                    val mdBytes = attrs["rpMd"] ?: attrs["md"] ?: attrs["model"]
                    if (mdBytes != null) {
                      model = String(mdBytes, Charsets.UTF_8).trim().take(28)
                    }
                  } catch (_: Exception) {}
                  val lower = (model + " " + stype + " " + svcName).lowercase()
                  val cat = when {
                    stype.contains("googlecast") || stype.contains("ipp") || tvComputerIotRegex.containsMatchIn(lower) || lower.contains("macbook") || lower.contains("appletv") -> CAT_TV_PC_IOT
                    lower.contains("iphone") || stype.contains("companion-link") -> CAT_PHONE
                    else -> CAT_TV_PC_IOT
                  }
                  if (cat != CAT_PHONE) {
                    lanFilteredIps[hostIp] = Pair(cat, model)
                  }
                  lanMdnsModels[hostIp] = Triple(cat, model, System.currentTimeMillis())
                }
              })
            } catch (_: Exception) {}
          }
        }
        nsdListeners.add(listener)
        try { mgr.discoverServices(stype, NsdManager.PROTOCOL_DNS_SD, listener) } catch (_: Exception) {}
      }
    } catch (_: Exception) {}
  }

  // Query Smart TV / Router / Printer devices on room LAN via SSDP M-SEARCH so we filter them out
  private fun runSsdpRoomDeviceCheck() {
    var sock: DatagramSocket? = null
    try {
      sock = DatagramSocket()
      sock.soTimeout = 500
      val query = ("M-SEARCH * HTTP/1.1\r\n" +
        "HOST: 239.255.255.250:1900\r\n" +
        "MAN: \"ssdp:discover\"\r\n" +
        "MX: 1\r\n" +
        "ST: ssdp:all\r\n\r\n").toByteArray(Charsets.UTF_8)
      val mcast = InetAddress.getByName("239.255.255.250")
      sock.send(DatagramPacket(query, query.size, mcast, 1900))
      val startMs = System.currentTimeMillis()
      val buf = ByteArray(1024)
      while (System.currentTimeMillis() - startMs < 650) {
        val dp = DatagramPacket(buf, buf.size)
        try {
          sock.receive(dp)
          val ip = dp.address?.hostAddress ?: continue
          val resp = String(dp.data, 0, dp.length, Charsets.UTF_8)
          val serverLine = Regex("(?i)SERVER:\\s*([^\r\n]+)").find(resp)?.groupValues?.get(1)?.trim() ?: ""
          val cat = when {
            Regex("(?i)(router|gateway|igd|tp-link|tenda|huawei|mikrotik)").containsMatchIn(resp) -> CAT_ROUTER
            Regex("(?i)(tv|bravia|webos|tizen|chromecast|renderer|printer|scanner|xbox|playstation)").containsMatchIn(resp) -> CAT_TV_PC_IOT
            else -> CAT_TV_PC_IOT
          }
          lanFilteredIps[ip] = Pair(cat, if (serverLine.isNotBlank()) serverLine.take(26) else "TV / Router (SSDP)")
        } catch (_: SocketTimeoutException) {
          break
        }
      }
    } catch (_: Exception) {
    } finally {
      try { sock?.close() } catch (_: Exception) {}
    }
  }

  private fun triggerWifiLanRoomSweepIfNeeded() {
    val now = System.currentTimeMillis()
    if (lanSweepRunning || now - lastLanSweepMs < 18_000L) return

    val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
    val net = cm.activeNetwork ?: return
    val caps = cm.getNetworkCapabilities(net) ?: return
    if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return
    val lp = cm.getLinkProperties(net) ?: return

    var myV4: Inet4Address? = null
    var prefixLen = 0
    for (la in lp.linkAddresses) {
      val addr = la.address
      if (addr is Inet4Address && addr.isSiteLocalAddress && la.prefixLength >= 24) {
        myV4 = addr
        prefixLen = la.prefixLength
        break
      }
    }
    if (myV4 == null || prefixLen < 24) return

    val myIpBytes = myV4.address
    val myHostOctet = myIpBytes[3].toInt() and 0xFF
    var gatewayOctet = -1
    for (route in lp.routes) {
      if (route.isDefaultRoute && route.gateway is Inet4Address) {
        val gwBytes = route.gateway!!.address
        if (gwBytes[0] == myIpBytes[0] && gwBytes[1] == myIpBytes[1] && gwBytes[2] == myIpBytes[2]) {
          gatewayOctet = gwBytes[3].toInt() and 0xFF
          break
        }
      }
    }

    lastLanSweepMs = now
    lanSweepRunning = true
    val netPrefix = byteArrayOf(myIpBytes[0], myIpBytes[1], myIpBytes[2], 0)

    bgExecutor.execute {
      val pool = Executors.newFixedThreadPool(24)
      try {
        runSsdpRoomDeviceCheck()
        try {
          DatagramSocket().use { ds ->
            val msg = byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
            ds.send(DatagramPacket(msg, msg.size, InetAddress.getByName("224.0.0.251"), 5353))
          }
        } catch (_: Exception) {}

        val futures = ArrayList<java.util.concurrent.Future<*>>(254)
        for (host in 1..254) {
          if (host == myHostOctet || host == gatewayOctet) continue
          val hBytes = byteArrayOf(netPrefix[0], netPrefix[1], netPrefix[2], host.toByte())
          futures.add(pool.submit {
            val ipStr = (hBytes[0].toInt() and 0xFF).toString() + "." +
              (hBytes[1].toInt() and 0xFF).toString() + "." +
              (hBytes[2].toInt() and 0xFF).toString() + "." +
              (hBytes[3].toInt() and 0xFF).toString()
            var alive = false
            var isAppleIphonePort = false
            try {
              val inet = InetAddress.getByAddress(hBytes)
              if (inet.isReachable(120)) {
                alive = true
              }
              if (!alive) {
                val sock = Socket()
                try {
                  sock.connect(InetSocketAddress(inet, 62078), 110)
                  alive = true
                  isAppleIphonePort = true
                } catch (ce: ConnectException) {
                  val m = (ce.message ?: "").lowercase()
                  if (m.contains("refused") || m.contains("econnrefused")) {
                    alive = true
                  }
                } catch (_: Exception) {
                } finally {
                  try { sock.close() } catch (_: Exception) {}
                }
              }
            } catch (_: Exception) {}
            if (alive) {
              val filteredMeta = lanFilteredIps[ipStr]
              val mdnsMeta = lanMdnsModels[ipStr]
              val cat: String
              val model: String
              if (filteredMeta != null) {
                cat = filteredMeta.first
                model = filteredMeta.second
              } else if (mdnsMeta != null) {
                cat = mdnsMeta.first
                model = mdnsMeta.second
              } else if (isAppleIphonePort) {
                cat = CAT_PHONE
                model = "Apple iPhone (LAN)"
              } else {
                cat = CAT_PHONE
                model = "Room Phone (Wi-Fi LAN)"
              }
              recordPeer(wifiLanPeers, ipStr, -55, cat, model, "WIFI_LAN")
            }
          })
        }
        for (f in futures) {
          try { f.get(450, TimeUnit.MILLISECONDS) } catch (_: Exception) {}
        }
      } catch (_: Exception) {
      } finally {
        pool.shutdownNow()
        lanSweepRunning = false
      }
    }
  }

  private fun isValidCellMetric(v: Int, minVal: Int, maxVal: Int): Boolean =
    v != CellInfo.UNAVAILABLE && v in minVal..maxVal

  private fun parseCellInfoList(cells: List<CellInfo>?) {
    if (cells.isNullOrEmpty()) {
      cachedCellTowerCount = 0
      return
    }
    var towerCount = 0
    var bestAssigned = false

    for (ci in cells) {
      if (!ci.isRegistered && ci !is CellInfoLte && ci !is CellInfoNr) continue
      if (ci is CellInfoLte || ci is CellInfoNr || ci is CellInfoWcdma) towerCount += 1
      if (!ci.isRegistered && bestAssigned) continue

      if (ci is CellInfoLte) {
        val ss: CellSignalStrengthLte = ci.cellSignalStrength
        val dbmRaw = ss.dbm
        val rsrpRaw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ss.rsrp else CellInfo.UNAVAILABLE
        val rsrqRaw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ss.rsrq else CellInfo.UNAVAILABLE
        val rssnrRaw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ss.rssnr else CellInfo.UNAVAILABLE
        val cqiRaw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ss.cqi else CellInfo.UNAVAILABLE

        val rsrp = if (isValidCellMetric(rsrpRaw, -140, -40)) rsrpRaw
        else if (isValidCellMetric(dbmRaw, -140, -40)) dbmRaw
        else -85
        val rsrq = if (isValidCellMetric(rsrqRaw, -34, -1)) rsrqRaw else Int.MIN_VALUE
        val rssnr = if (isValidCellMetric(rssnrRaw, -20, 35)) rssnrRaw else Int.MIN_VALUE
        val cqi = if (isValidCellMetric(cqiRaw, 0, 15)) cqiRaw else -1

        var signalsUsed = 0
        var loadAccum = 0.0
        if (rsrq != Int.MIN_VALUE) {
          loadAccum += max(5.0, min(98.0, ((-3.0 - rsrq) / 17.0) * 100.0)); signalsUsed += 1
        }
        if (rssnr != Int.MIN_VALUE) {
          loadAccum += max(8.0, min(98.0, ((25.0 - rssnr) / 30.0) * 90.0)); signalsUsed += 1
        }
        if (cqi >= 0) {
          loadAccum += max(10.0, min(95.0, ((15.0 - cqi) / 14.0) * 85.0)); signalsUsed += 1
        }
        val loadScore = if (signalsUsed > 0) loadAccum / signalsUsed else max(12.0, min(85.0, ((-55.0 - rsrp) / 65.0) * 70.0))
        cachedCellRsrp = rsrp
        cachedCellRsrq = if (rsrq != Int.MIN_VALUE) rsrq else -9
        cachedCellRssnr = if (rssnr != Int.MIN_VALUE) rssnr else 10
        cachedCellLoadPct = loadScore.roundToInt().coerceIn(5, 100)
        cachedCellNetworkType = "4G_LTE"
        bestAssigned = true
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && ci is CellInfoNr) {
        val ss = ci.cellSignalStrength as? CellSignalStrengthNr
        if (ss != null) {
          val rsrp = if (isValidCellMetric(ss.ssRsrp, -140, -40)) ss.ssRsrp else -85
          val rsrq = if (isValidCellMetric(ss.ssRsrq, -34, -1)) ss.ssRsrq else Int.MIN_VALUE
          val sinr = if (isValidCellMetric(ss.ssSinr, -20, 40)) ss.ssSinr else Int.MIN_VALUE
          val load = if (rsrq != Int.MIN_VALUE) max(8.0, min(98.0, ((-3.0 - rsrq) / 17.0) * 100.0)).roundToInt()
          else if (sinr != Int.MIN_VALUE) max(8.0, min(95.0, ((25.0 - sinr) / 30.0) * 90.0)).roundToInt()
          else max(12, min(80, ((-55.0 - rsrp) / 65.0 * 70.0).roundToInt()))
          cachedCellRsrp = rsrp
          cachedCellRsrq = if (rsrq != Int.MIN_VALUE) rsrq else -9
          cachedCellRssnr = if (sinr != Int.MIN_VALUE) sinr else 12
          cachedCellLoadPct = load
          cachedCellNetworkType = "5G_NR"
          bestAssigned = true
        }
      } else if (ci is CellInfoWcdma && !bestAssigned) {
        val dbm = if (isValidCellMetric(ci.cellSignalStrength.dbm, -130, -40)) ci.cellSignalStrength.dbm else -88
        cachedCellRsrp = dbm
        cachedCellLoadPct = max(12, min(80, ((-55.0 - dbm) / 65.0 * 70.0).roundToInt()))
        cachedCellNetworkType = "3G_WCDMA"
        bestAssigned = true
      } else if (ci is CellInfoGsm && !bestAssigned) {
        val dbm = if (isValidCellMetric(ci.cellSignalStrength.dbm, -120, -40)) ci.cellSignalStrength.dbm else -90
        cachedCellRsrp = dbm
        cachedCellLoadPct = max(12, min(80, ((-55.0 - dbm) / 65.0 * 70.0).roundToInt()))
        cachedCellNetworkType = "2G_GSM"
        bestAssigned = true
      }
    }
    cachedCellTowerCount = towerCount
  }

  @SuppressLint("MissingPermission")
  private fun refreshCellularInfo() {
    if (!hasFineLocationPermission()) {
      cachedCellNetworkType = "NO_LOC_PERM"
      cachedCellLoadPct = 0
      return
    }
    val tm = reactContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return
    val now = System.currentTimeMillis()
    try { parseCellInfoList(tm.allCellInfo) } catch (_: Exception) {}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && now - lastCellRefreshMs >= 10_000L) {
      lastCellRefreshMs = now
      try {
        tm.requestCellInfoUpdate(bgExecutor, object : TelephonyManager.CellInfoCallback() {
          override fun onCellInfo(cellInfo: MutableList<CellInfo>) { parseCellInfoList(cellInfo) }
        })
      } catch (_: Exception) {}
    }
  }

  @ReactMethod
  fun startBleScan(promise: Promise) {
    ensureReceiversRegistered()
    val btOk = ensureBleScanningStarted()
    triggerWifiScansIfNeeded()
    refreshCellularInfo()
    promise.resolve(btOk || hasWifiScanPermission() || hasFineLocationPermission())
  }

  @ReactMethod
  fun stopBleScan(promise: Promise) {
    stopAllHardwareScans()
    promise.resolve(true)
  }

  private fun countStaticAndMoving(peers: Collection<PeerReading>, speedKmh: Double): Pair<Int, Int> {
    var st = 0
    var mv = 0
    for (p in peers) {
      val rssiDelta = abs(p.lastRssi - p.firstRssi)
      if (speedKmh < 3.5 && rssiDelta <= 7) st += 1 else mv += 1
    }
    return Pair(st, mv)
  }

  @ReactMethod
  fun getScanSnapshot(speedKmh: Double, promise: Promise) {
    ensureReceiversRegistered()
    ensureBleScanningStarted()
    triggerWifiScansIfNeeded()
    refreshCellularInfo()

    pruneMap(btAllPeers, peerTtlMs)
    pruneMap(wifiScannedAps, wifiPeerTtlMs)
    pruneMap(wifiP2pPeers, wifiPeerTtlMs)
    pruneMap(wifiLanPeers, wifiPeerTtlMs)

    val mdnsCutoff = System.currentTimeMillis() - wifiPeerTtlMs
    val mIter = lanMdnsModels.entries.iterator()
    while (mIter.hasNext()) {
      if (mIter.next().value.third < mdnsCutoff) mIter.remove()
    }

    var filteredAudioCount = 0
    var filteredRouterCount = 0
    var filteredOtherCount = 0

    // 1. Filter Bluetooth / BLE peers -> only keep confirmed/probable PHONES (filter out Earbuds, Watches, PCs, TVs)
    val phoneBtPeers = mutableListOf<PeerReading>()
    for (p in btAllPeers.values) {
      when (p.category) {
        CAT_AUDIO_WEARABLE -> filteredAudioCount += 1
        CAT_TV_PC_IOT -> filteredOtherCount += 1
        CAT_ROUTER -> filteredRouterCount += 1
        else -> phoneBtPeers.add(p) // CAT_PHONE or CAT_UNKNOWN nearby BLE ad
      }
    }
    val (btStatic, btMoving) = countStaticAndMoving(phoneBtPeers, speedKmh)

    // 2. Filter Wi-Fi scanned APs -> keep only Mobile Hotspots, filter out TP-Link/Tenda/Guest Routers
    val phoneHotspots = mutableListOf<PeerReading>()
    for (p in wifiScannedAps.values) {
      if (p.category == CAT_ROUTER) {
        filteredRouterCount += 1
      } else if (p.category == CAT_PHONE) {
        phoneHotspots.add(p)
      }
    }

    // 3. Filter Wi-Fi Direct P2P peers -> keep Phones, filter TVs/Routers
    val phoneP2p = mutableListOf<PeerReading>()
    for (p in wifiP2pPeers.values) {
      when (p.category) {
        CAT_ROUTER -> filteredRouterCount += 1
        CAT_TV_PC_IOT -> filteredOtherCount += 1
        else -> phoneP2p.add(p)
      }
    }

    // 4. Filter Room LAN peers -> exclude Smart TVs / Chromecast / Routers / Printers identified via SSDP/mDNS
    val phoneLan = mutableListOf<PeerReading>()
    for (p in wifiLanPeers.values) {
      when (p.category) {
        CAT_ROUTER -> filteredRouterCount += 1
        CAT_TV_PC_IOT -> filteredOtherCount += 1
        CAT_AUDIO_WEARABLE -> filteredAudioCount += 1
        else -> phoneLan.add(p)
      }
    }

    val wifiHotspotCount = phoneHotspots.size
    val wifiP2pCount = phoneP2p.size
    val wifiLanCount = phoneLan.size
    val wifiMobileTotal = wifiHotspotCount + wifiP2pCount + wifiLanCount

    val (hsSt, hsMv) = countStaticAndMoving(phoneHotspots, speedKmh)
    val (p2pSt, p2pMv) = countStaticAndMoving(phoneP2p, speedKmh)
    val (lanSt, lanMv) = countStaticAndMoving(phoneLan, speedKmh)
    val wifiStatic = hsSt + p2pSt + lanSt
    val wifiMoving = hsMv + p2pMv + lanMv

    // Build anonymized extracted device model summary list (phones + filtered non-phones)
    val modelTags = Arguments.createArray()
    val allReadings = mutableListOf<PeerReading>()
    allReadings.addAll(phoneBtPeers)
    allReadings.addAll(phoneHotspots)
    allReadings.addAll(phoneP2p)
    allReadings.addAll(phoneLan)
    for (p in btAllPeers.values) if (p.category != CAT_PHONE && p.category != CAT_UNKNOWN) allReadings.add(p)
    for (p in wifiScannedAps.values) if (p.category == CAT_ROUTER) allReadings.add(p)
    for (p in wifiLanPeers.values) if (p.category != CAT_PHONE && p.category != CAT_UNKNOWN) allReadings.add(p)

    val seenLabels = HashSet<String>()
    var added = 0
    for (p in allReadings) {
      if (added >= 24) break
      val prefix = when (p.category) {
        CAT_PHONE -> "📱 "
        CAT_ROUTER -> "📡 [Filtered Router] "
        CAT_AUDIO_WEARABLE -> "🎧 [Filtered Earbud/Watch] "
        CAT_TV_PC_IOT -> "🖥️ [Filtered TV/PC] "
        else -> "📶 "
      }
      val entry = prefix + (p.modelLabel.ifBlank { "Device" }) + " (" + p.radioSource + ")"
      if (seenLabels.add(entry)) {
        modelTags.pushString(entry)
        added += 1
      }
    }

    val rssiSamples = mutableListOf<Int>()
    for (p in phoneBtPeers) rssiSamples.add(p.lastRssi)
    for (p in phoneHotspots) rssiSamples.add(p.lastRssi)
    val avgRssi = if (rssiSamples.isNotEmpty()) (rssiSamples.sum() / rssiSamples.size) else -70

    val btEnabled = try { (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter?.isEnabled == true } catch (_: Exception) { false }
    val wifiEnabled = try { (reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.isWifiEnabled == true } catch (_: Exception) { false }
    val locEnabled = isLocationServiceEnabled()

    val missing = mutableListOf<String>()
    if (!btEnabled) missing.add("BT_OFF")
    if (!hasBleScanPermission()) missing.add("NO_BT_PERM")
    if (!wifiEnabled) missing.add("WIFI_OFF")
    if (!hasWifiScanPermission()) missing.add("NO_WIFI_PERM")
    if (!locEnabled) missing.add("LOC_OFF")
    val diagStatus = if (missing.isEmpty()) "ALL_RADIOS_ACTIVE" else missing.joinToString(",")

    val map = Arguments.createMap().apply {
      putInt("bleCount", phoneBtPeers.size)
      putInt("bleStaticCount", btStatic)
      putInt("bleMovingCount", btMoving)
      putInt("btClassicCount", phoneBtPeers.count { it.radioSource == "BT_CLASSIC" })
      putInt("wifiMobileCount", wifiMobileTotal)
      putInt("wifiHotspotCount", wifiHotspotCount)
      putInt("wifiP2pCount", wifiP2pCount)
      putInt("wifiLanPeerCount", wifiLanCount)
      putInt("wifiFixedApCount", filteredRouterCount)
      putInt("filteredRoutersCount", filteredRouterCount)
      putInt("filteredAudioCount", filteredAudioCount)
      putInt("filteredOtherCount", filteredOtherCount)
      putArray("detectedModels", modelTags)
      putInt("wifiStaticCount", wifiStatic)
      putInt("wifiMovingCount", wifiMoving)
      putInt("cellRsrpDbm", cachedCellRsrp)
      putInt("cellRsrqDb", cachedCellRsrq)
      putInt("cellRssnrDb", cachedCellRssnr)
      putInt("cellLoadPercent", cachedCellLoadPct)
      putInt("cellTowerCount", cachedCellTowerCount)
      putString("cellNetworkType", cachedCellNetworkType)
      putInt("avgRssiDbm", avgRssi)
      putInt("scanRadiusM", 50)
      putBoolean("isScanning", isBleScanning)
      putBoolean("isBtEnabled", btEnabled)
      putBoolean("isWifiEnabled", wifiEnabled)
      putBoolean("isLocationEnabled", locEnabled)
      putBoolean("hasBlePerm", hasBleScanPermission())
      putBoolean("hasWifiPerm", hasWifiScanPermission())
      putString("diagStatus", diagStatus)
      putString("scannerMode", if (isBleScanning || wifiMobileTotal > 0 || cachedCellTowerCount > 0) "NATIVE_MULTI_RADIO" else diagStatus)
    }
    promise.resolve(map)
  }

  @SuppressLint("MissingPermission")
  private fun stopAllHardwareScans() {
    try {
      val cb = activeScanCallback
      if (isBleScanning && cb != null && hasBleScanPermission()) bleScanner?.stopScan(cb)
    } catch (_: Exception) {
    } finally { isBleScanning = false; activeScanCallback = null }
    try {
      val advCb = activeAdvertiseCallback
      if (isBleAdvertising && advCb != null && hasBleAdvertisePermission()) bleAdvertiser?.stopAdvertising(advCb)
    } catch (_: Exception) {
    } finally { isBleAdvertising = false; activeAdvertiseCallback = null }
    try {
      val mgr = nsdManager
      if (mgr != null && nsdListeners.isNotEmpty()) {
        for (l in nsdListeners) { try { mgr.stopServiceDiscovery(l) } catch (_: Exception) {} }
        nsdListeners.clear()
      }
    } catch (_: Exception) {
    } finally { mdnsStarted = false }
    if (receiversRegistered) {
      try { reactContext.unregisterReceiver(radioReceiver) } catch (_: Exception) {}
      receiversRegistered = false
    }
  }

  override fun onHostResume() {
    ensureReceiversRegistered()
    if (hasBleScanPermission()) ensureBleScanningStarted()
  }

  override fun onHostPause() {}

  override fun onHostDestroy() {
    stopAllHardwareScans()
    try { bgExecutor.shutdownNow() } catch (_: Exception) {}
  }
}
`;

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
      const pkgDir = path.join(platformRoot, "app", "src", "main", "java", "com", "bigwarn", "edge");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "BigWarnBleScannerPackage.kt"), PACKAGE_KT, "utf-8");
      fs.writeFileSync(path.join(pkgDir, "BigWarnBleScannerModule.kt"), MODULE_KT, "utf-8");

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
