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
import android.net.wifi.WifiManager
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
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

  data class PeerReading(
    var firstRssi: Int,
    var lastRssi: Int,
    var packetCount: Int,
    var lastSeenMs: Long,
    var label: String = ""
  )

  private val mainHandler = Handler(Looper.getMainLooper())
  private val bgExecutor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

  // Radio A: BLE + Classic BT
  private val blePeers = ConcurrentHashMap<String, PeerReading>()
  private val btClassicPeers = ConcurrentHashMap<String, PeerReading>()
  private var bleScanner: BluetoothLeScanner? = null
  private var bleAdvertiser: BluetoothLeAdvertiser? = null
  private var activeScanCallback: ScanCallback? = null
  private var activeAdvertiseCallback: AdvertiseCallback? = null
  private var isBleScanning = false
  private var isBleAdvertising = false
  private var lastClassicBtDiscoveryMs = 0L

  // Radio B: Wi-Fi Hotspots/APs + Wi-Fi Direct P2P + Shared Wi-Fi Room LAN & mDNS
  private val wifiHotspotPeers = ConcurrentHashMap<String, PeerReading>()
  private val wifiFixedAps = ConcurrentHashMap<String, PeerReading>()
  private val wifiP2pPeers = ConcurrentHashMap<String, PeerReading>()
  private val wifiLanPeers = ConcurrentHashMap<String, PeerReading>()
  private val mdnsPeers = ConcurrentHashMap<String, Long>()
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

  private val mobileHotspotPattern = Regex(
    "(?i)(DIRECT-|AndroidAP|AndroidShare|Galaxy|Samsung|Redmi|Xiaomi|POCO|Poco|vivo|OPPO|Realme|OnePlus|iPhone|iPad|Pixel|Nothing|Huawei|Honor|Tecno|Infinix|Itel|Hotspot|Portable|Tether|Car-|Dashcam|DVR|BYD|Toyota|Honda)"
  )

  private val bigWarnServiceUuid = ParcelUuid(UUID.fromString("0000b19a-0000-1000-8000-00805f9b34fb"))

  private val radioReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val action = intent?.action ?: return
      when (action) {
        WifiManager.SCAN_RESULTS_AVAILABLE_ACTION -> {
          refreshWifiApResults()
        }
        WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
          requestP2pPeersSafe()
        }
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
            recordPeer(btClassicPeers, addr, rssi, name)
          }
        }
      }
    }
  }

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = "BigWarnBleScanner"

  private fun hasPermission(perm: String): Boolean {
    return ContextCompat.checkSelfPermission(reactContext, perm) == PackageManager.PERMISSION_GRANTED
  }

  private fun hasFineLocationPermission(): Boolean {
    return hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
  }

  private fun hasAnyLocationPermission(): Boolean {
    return hasFineLocationPermission() || hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
  }

  private fun hasBleScanPermission(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_SCAN)
    } else {
      hasAnyLocationPermission()
    }
  }

  private fun hasBleConnectPermission(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      true
    }
  }

  private fun hasBleAdvertisePermission(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)
    } else {
      hasPermission(Manifest.permission.BLUETOOTH_ADMIN)
    }
  }

  private fun hasWifiScanPermission(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      hasPermission("android.permission.NEARBY_WIFI_DEVICES") || hasFineLocationPermission()
    } else {
      hasAnyLocationPermission()
    }
  }

  private fun isLocationServiceEnabled(): Boolean {
    return try {
      val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        lm.isLocationEnabled
      } else {
        lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
          lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
      }
    } catch (_: Exception) {
      true
    }
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
    label: String = ""
  ) {
    val now = System.currentTimeMillis()
    map.compute(key) { _, existing ->
      if (existing == null) {
        PeerReading(rssi, rssi, 1, now, label)
      } else {
        existing.lastRssi = rssi
        existing.packetCount += 1
        existing.lastSeenMs = now
        if (label.isNotBlank()) existing.label = label
        existing
      }
    }
  }

  private fun pruneMap(map: ConcurrentHashMap<String, PeerReading>, ttl: Long) {
    val cutoff = System.currentTimeMillis() - ttl
    val iter = map.entries.iterator()
    while (iter.hasNext()) {
      if (iter.next().value.lastSeenMs < cutoff) {
        iter.remove()
      }
    }
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
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
              isBleAdvertising = true
            }
            override fun onStartFailure(errorCode: Int) {
              isBleAdvertising = false
            }
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
        val devName = result.scanRecord?.deviceName ?: ""
        recordPeer(blePeers, addr, rssi, devName)
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        for (res in results) {
          val addr = res.device?.address ?: continue
          val rssi = res.rssi
          if (rssi < -98 || rssi >= 0) continue
          recordPeer(blePeers, addr, rssi, res.scanRecord?.deviceName ?: "")
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
    } catch (_: SecurityException) {
      isBleScanning = false
      false
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
            if (hasBleScanPermission() && adapter.isDiscovering) {
              adapter.cancelDiscovery()
            }
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

  @SuppressLint("MissingPermission")
  private fun refreshWifiApResults() {
    val wifiManager = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    if (!wifiManager.isWifiEnabled) return
    try {
      val results = wifiManager.scanResults ?: return
      for (sr in results) {
        val bssid = sr.BSSID ?: continue
        if (sr.level < -88 || sr.level >= 0) continue
        @Suppress("DEPRECATION")
        val ssid = sr.SSID ?: ""
        val isMobile = isLocallyAdministeredMac(bssid) ||
          (ssid.isNotBlank() && mobileHotspotPattern.containsMatchIn(ssid))
        if (isMobile) {
          recordPeer(wifiHotspotPeers, bssid.lowercase(), sr.level, ssid)
        } else {
          recordPeer(wifiFixedAps, bssid.lowercase(), sr.level, ssid)
        }
      }
    } catch (_: SecurityException) {
    } catch (_: Exception) {}
  }

  @SuppressLint("MissingPermission")
  private fun ensureWifiP2pInitialized() {
    if (wifiP2pManager != null && wifiP2pChannel != null) return
    try {
      val mgr = reactContext.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager ?: return
      val ch = mgr.initialize(reactContext, Looper.getMainLooper(), null)
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
          if (!addr.isNullOrBlank()) {
            recordPeer(wifiP2pPeers, addr.lowercase(), -62, dev.deviceName ?: "Android P2P")
          }
        }
      }
    } catch (_: SecurityException) {
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
            override fun onSuccess() {
              requestP2pPeersSafe()
            }
            override fun onFailure(reason: Int) {}
          })
        }
      } catch (_: SecurityException) {
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
        "_airplay._tcp.",
        "_googlecast._tcp.",
        "_companion-link._tcp.",
        "_adb._tcp.",
        "_http._tcp."
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
            mdnsPeers[svcName + ":" + (serviceInfo.serviceType ?: "")] = System.currentTimeMillis()
          }
        }
        nsdListeners.add(listener)
        try {
          mgr.discoverServices(stype, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {}
      }
    } catch (_: Exception) {}
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
        // Send brief mDNS wakeup packet so idle room phones update ARP entries
        try {
          DatagramSocket().use { ds ->
            val msg = byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
            val mcast = InetAddress.getByName("224.0.0.251")
            ds.send(DatagramPacket(msg, msg.size, mcast, 5353))
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
            try {
              val inet = InetAddress.getByAddress(hBytes)
              if (inet.isReachable(120)) {
                alive = true
              } else {
                // Fast TCP RST presence probe against Apple Lockdownd / mDNS ports on local /24 Wi-Fi
                val sock = Socket()
                try {
                  sock.connect(InetSocketAddress(inet, 62078), 110)
                  alive = true
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
              recordPeer(wifiLanPeers, ipStr, -55, "LAN:" + ipStr)
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

  private fun isValidCellMetric(v: Int, minVal: Int, maxVal: Int): Boolean {
    return v != CellInfo.UNAVAILABLE && v in minVal..maxVal
  }

  private fun parseCellInfoList(cells: List<CellInfo>?) {
    if (cells.isNullOrEmpty()) {
      cachedCellTowerCount = 0
      return
    }
    var towerCount = 0
    var bestAssigned = false

    for (ci in cells) {
      if (!ci.isRegistered && ci !is CellInfoLte && ci !is CellInfoNr) continue
      if (ci is CellInfoLte || ci is CellInfoNr || ci is CellInfoWcdma) {
        towerCount += 1
      }
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

        var loadScore = 25.0
        var signalsUsed = 0
        var loadAccum = 0.0

        if (rsrq != Int.MIN_VALUE) {
          loadAccum += max(5.0, min(98.0, ((-3.0 - rsrq) / 17.0) * 100.0))
          signalsUsed += 1
        }
        if (rssnr != Int.MIN_VALUE) {
          // 25 dB = very clean/empty (10% load), -5 dB = heavily loaded (95% load)
          loadAccum += max(8.0, min(98.0, ((25.0 - rssnr) / 30.0) * 90.0))
          signalsUsed += 1
        }
        if (cqi >= 0) {
          loadAccum += max(10.0, min(95.0, ((15.0 - cqi) / 14.0) * 85.0))
          signalsUsed += 1
        }
        if (signalsUsed == 0) {
          // Fallback from signal power + visible LTE neighbor cell density
          val sigLoad = max(12.0, min(85.0, ((-55.0 - rsrp) / 65.0) * 70.0))
          loadScore = sigLoad
        } else {
          loadScore = loadAccum / signalsUsed
        }

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
          val load = if (rsrq != Int.MIN_VALUE) {
            max(8.0, min(98.0, ((-3.0 - rsrq) / 17.0) * 100.0)).roundToInt()
          } else if (sinr != Int.MIN_VALUE) {
            max(8.0, min(95.0, ((25.0 - sinr) / 30.0) * 90.0)).roundToInt()
          } else {
            max(12, min(80, ((-55.0 - rsrp) / 65.0 * 70.0).roundToInt()))
          }
          cachedCellRsrp = rsrp
          cachedCellRsrq = if (rsrq != Int.MIN_VALUE) rsrq else -9
          cachedCellRssnr = if (sinr != Int.MIN_VALUE) sinr else 12
          cachedCellLoadPct = load
          cachedCellNetworkType = "5G_NR"
          bestAssigned = true
        }
      } else if (ci is CellInfoWcdma && !bestAssigned) {
        val ss: CellSignalStrengthWcdma = ci.cellSignalStrength
        val dbm = if (isValidCellMetric(ss.dbm, -130, -40)) ss.dbm else -88
        cachedCellRsrp = dbm
        cachedCellRsrq = -10
        cachedCellLoadPct = max(12, min(80, ((-55.0 - dbm) / 65.0 * 70.0).roundToInt()))
        cachedCellNetworkType = "3G_WCDMA"
        bestAssigned = true
      } else if (ci is CellInfoGsm && !bestAssigned) {
        val ss: CellSignalStrengthGsm = ci.cellSignalStrength
        val dbm = if (isValidCellMetric(ss.dbm, -120, -40)) ss.dbm else -90
        cachedCellRsrp = dbm
        cachedCellRsrq = -10
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
    try {
      parseCellInfoList(tm.allCellInfo)
    } catch (_: SecurityException) {
      cachedCellNetworkType = "NO_PERM"
    } catch (_: Exception) {}

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && now - lastCellRefreshMs >= 10_000L) {
      lastCellRefreshMs = now
      try {
        tm.requestCellInfoUpdate(bgExecutor, object : TelephonyManager.CellInfoCallback() {
          override fun onCellInfo(cellInfo: MutableList<CellInfo>) {
            parseCellInfoList(cellInfo)
          }
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

  private fun countStaticAndMoving(
    peers: Collection<PeerReading>,
    speedKmh: Double
  ): Pair<Int, Int> {
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

    pruneMap(blePeers, peerTtlMs)
    pruneMap(btClassicPeers, peerTtlMs)
    pruneMap(wifiHotspotPeers, wifiPeerTtlMs)
    pruneMap(wifiFixedAps, wifiPeerTtlMs)
    pruneMap(wifiP2pPeers, wifiPeerTtlMs)
    pruneMap(wifiLanPeers, wifiPeerTtlMs)

    val mdnsCutoff = System.currentTimeMillis() - wifiPeerTtlMs
    val mdnsIter = mdnsPeers.entries.iterator()
    while (mdnsIter.hasNext()) {
      if (mdnsIter.next().value < mdnsCutoff) {
        mdnsIter.remove()
      }
    }

    // Deduplicate BLE + Classic BT peers by MAC
    val combinedBt = HashMap<String, PeerReading>(blePeers.size + btClassicPeers.size)
    combinedBt.putAll(blePeers)
    for ((k, v) in btClassicPeers) {
      combinedBt.putIfAbsent(k, v)
    }

    val btTotal = combinedBt.size
    val (btStatic, btMoving) = countStaticAndMoving(combinedBt.values, speedKmh)

    val wifiHotspotCount = wifiHotspotPeers.size
    val wifiP2pCount = wifiP2pPeers.size
    val wifiLanCount = max(wifiLanPeers.size, mdnsPeers.size)
    val wifiMobileTotal = wifiHotspotCount + wifiP2pCount + wifiLanCount
    val (hsSt, hsMv) = countStaticAndMoving(wifiHotspotPeers.values, speedKmh)
    val (p2pSt, p2pMv) = countStaticAndMoving(wifiP2pPeers.values, speedKmh)
    val (lanSt, lanMv) = countStaticAndMoving(wifiLanPeers.values, speedKmh)
    val mdnsExtra = max(0, mdnsPeers.size - wifiLanPeers.size)
    val mdnsExtraSt = if (speedKmh < 3.5) mdnsExtra else 0
    val mdnsExtraMv = mdnsExtra - mdnsExtraSt

    val wifiStatic = hsSt + p2pSt + lanSt + mdnsExtraSt
    val wifiMoving = hsMv + p2pMv + lanMv + mdnsExtraMv

    val rssiSamples = mutableListOf<Int>()
    for (p in combinedBt.values) rssiSamples.add(p.lastRssi)
    for (p in wifiHotspotPeers.values) rssiSamples.add(p.lastRssi)
    val avgRssi = if (rssiSamples.isNotEmpty()) (rssiSamples.sum() / rssiSamples.size) else -70

    val btEnabled = try {
      (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter?.isEnabled == true
    } catch (_: Exception) { false }
    val wifiEnabled = try {
      (reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.isWifiEnabled == true
    } catch (_: Exception) { false }
    val locEnabled = isLocationServiceEnabled()

    val missing = mutableListOf<String>()
    if (!btEnabled) missing.add("BT_OFF")
    if (!hasBleScanPermission()) missing.add("NO_BT_PERM")
    if (!wifiEnabled) missing.add("WIFI_OFF")
    if (!hasWifiScanPermission()) missing.add("NO_WIFI_PERM")
    if (!locEnabled) missing.add("LOC_OFF")
    val diagStatus = if (missing.isEmpty()) "ALL_RADIOS_ACTIVE" else missing.joinToString(",")

    val map = Arguments.createMap().apply {
      putInt("bleCount", btTotal)
      putInt("bleStaticCount", btStatic)
      putInt("bleMovingCount", btMoving)
      putInt("btClassicCount", btClassicPeers.size)
      putInt("wifiMobileCount", wifiMobileTotal)
      putInt("wifiHotspotCount", wifiHotspotCount)
      putInt("wifiP2pCount", wifiP2pCount)
      putInt("wifiLanPeerCount", wifiLanCount)
      putInt("wifiFixedApCount", wifiFixedAps.size)
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
      putString(
        "scannerMode",
        if (isBleScanning || wifiMobileTotal > 0 || cachedCellTowerCount > 0) "NATIVE_MULTI_RADIO" else diagStatus
      )
    }
    promise.resolve(map)
  }

  @SuppressLint("MissingPermission")
  private fun stopAllHardwareScans() {
    try {
      val cb = activeScanCallback
      if (isBleScanning && cb != null && hasBleScanPermission()) {
        bleScanner?.stopScan(cb)
      }
    } catch (_: Exception) {
    } finally {
      isBleScanning = false
      activeScanCallback = null
    }
    try {
      val advCb = activeAdvertiseCallback
      if (isBleAdvertising && advCb != null && hasBleAdvertisePermission()) {
        bleAdvertiser?.stopAdvertising(advCb)
      }
    } catch (_: Exception) {
    } finally {
      isBleAdvertising = false
      activeAdvertiseCallback = null
    }
    try {
      val mgr = nsdManager
      if (mgr != null && nsdListeners.isNotEmpty()) {
        for (l in nsdListeners) {
          try { mgr.stopServiceDiscovery(l) } catch (_: Exception) {}
        }
        nsdListeners.clear()
      }
    } catch (_: Exception) {
    } finally {
      mdnsStarted = false
    }
    if (receiversRegistered) {
      try { reactContext.unregisterReceiver(radioReceiver) } catch (_: Exception) {}
      receiversRegistered = false
    }
  }

  override fun onHostResume() {
    ensureReceiversRegistered()
    if (hasBleScanPermission()) {
      ensureBleScanningStarted()
    }
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
    if (
      !features.some(
        (f) => f.$ && f.$["android:name"] === "android.hardware.bluetooth_le"
      )
    ) {
      features.push({
        $: {
          "android:name": "android.hardware.bluetooth_le",
          "android:required": "false",
        },
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
      fs.writeFileSync(
        path.join(pkgDir, "BigWarnBleScannerPackage.kt"),
        PACKAGE_KT,
        "utf-8"
      );
      fs.writeFileSync(
        path.join(pkgDir, "BigWarnBleScannerModule.kt"),
        MODULE_KT,
        "utf-8"
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
