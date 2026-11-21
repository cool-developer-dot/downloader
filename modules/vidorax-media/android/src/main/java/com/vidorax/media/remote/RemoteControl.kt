package com.vidorax.media.remote

import android.app.Activity
import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Bundle
import android.util.Log
import com.vidorax.media.MediaServices
import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.engine.DownloadEngineProvider
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.runner.BackgroundDownloads
import com.vidorax.media.runner.DownloadNotificationText
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.Inet4Address
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet

/** `startRemoteControl`: the phone is on no Wi-Fi network. */
class NoWifiException : CodedException("ERR_NO_WIFI", "Connect to Wi-Fi to use Remote control", null)

/** `startRemoteControl`: no port could be opened. */
class RemoteStartException(cause: Throwable?) : CodedException("ERR_REMOTE_START", "Remote control could not start", cause)

/** Process-wide P6 state that exists whether or not the server runs: tokens, waiting links, the sent list. */
internal class RemoteComponents private constructor(context: Context) {
  val auth = RemoteAuth(SharedPreferencesPairedClientStorage(context))
  val inbox = LinkInbox(SharedPreferencesPendingLinkStorage(context))
  val sent = SentList(
    storage = SharedPreferencesSentItemStorage(context),
    resolveFile = { libraryItemId ->
      MediaServices.get(context).library.get(libraryItemId)?.let { SentFile(it.file, it.file.name, it.mimeType) }
    },
  )

  companion object {
    @Volatile private var instance: RemoteComponents? = null

    fun get(context: Context): RemoteComponents =
      instance ?: synchronized(this) { instance ?: RemoteComponents(context.applicationContext).also { instance = it } }
  }
}

/** The phone's IPv4 address on a Wi-Fi (or wired) network, never mobile data or a VPN. */
internal object LanAddress {
  data class Found(val network: Network, val address: String)

  @Suppress("DEPRECATION")
  fun all(context: Context): List<Found> {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
    return manager.allNetworks.mapNotNull { network ->
      val caps = manager.getNetworkCapabilities(network) ?: return@mapNotNull null
      if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return@mapNotNull null
      val wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
      if (!wifi && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return@mapNotNull null
      val address = manager.getLinkProperties(network)?.linkAddresses
        ?.map { it.address }
        ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress && !it.isAnyLocalAddress }
        ?.hostAddress ?: return@mapNotNull null
      (if (wifi) 0 else 1) to Found(network, address)
    }.sortedBy { it.first }.map { it.second }
  }
}

/** Whether VidoraX has a started activity; the server must not outlive the app unless downloads keep it up. */
private object AppVisibility : Application.ActivityLifecycleCallbacks {
  private var installed = false
  private var started = 0

  @Volatile var backgroundSince: Long? = null
    private set

  /** Called from a tap in the app, so the app is in front now. */
  @Synchronized
  fun install(context: Context) {
    if (installed) return
    val app = context.applicationContext as? Application ?: return
    app.registerActivityLifecycleCallbacks(this)
    installed = true
    started = 1
    backgroundSince = null
  }

  @Synchronized
  override fun onActivityStarted(activity: Activity) {
    started += 1
    backgroundSince = null
  }

  @Synchronized
  override fun onActivityStopped(activity: Activity) {
    started = (started - 1).coerceAtLeast(0)
    if (started == 0) backgroundSince = System.currentTimeMillis()
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

  override fun onActivityResumed(activity: Activity) = Unit

  override fun onActivityPaused(activity: Activity) = Unit

  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

  override fun onActivityDestroyed(activity: Activity) = Unit
}

/**
 * P6 Remote control (#439, #438): the phone's local web server, off by default and started only from the app.
 *
 * - Listens on the phone's Wi-Fi address (and on loopback, for a computer on USB through `adb forward`; loopback
 *   is not reachable from the network), on a random port kept for next time.
 * - Pairing shows a 6-digit PIN (and a QR code of the address and PIN) on the phone; see [RemoteAuth].
 * - Stops after 30 minutes without a request, when the Wi-Fi network goes away, and a minute after VidoraX leaves
 *   the screen unless downloads are running ([RemoteStopPolicy]). It never starts a service: while downloads run, the
 *   existing download runner already keeps the process alive.
 */
object RemoteControl {
  data class Status(
    val running: Boolean,
    val address: String?,
    val port: Int?,
    val pin: String?,
    val lockedUntil: Long?,
    val pinWithdrawn: Boolean,
    val stopReason: RemoteStopReason?,
    val idleStopsAt: Long?,
    val clients: List<PairedClient>,
  ) {
    val url: String? get() = if (address != null && port != null) "http://$address:$port" else null
  }

  private class Running(
    val servers: List<RemoteServer>,
    val address: String,
    val port: Int,
    val network: Network,
    val jobs: List<Job>,
    val callback: ConnectivityManager.NetworkCallback?,
  )

  private const val TAG = "VidoraRemote"
  private const val PORT_KEY = "port"
  private const val MIN_PORT = 20_000
  private const val PORT_SPAN = 40_000
  private const val PORT_TRIES = 8
  private const val SOCKET_TIMEOUT_MS = 20_000

  @Volatile private var running: Running? = null
  @Volatile private var lastRequestAt = 0L
  @Volatile private var lastStopReason: RemoteStopReason? = null
  private val listeners = CopyOnWriteArraySet<() -> Unit>()
  private val progress = ConcurrentHashMap<String, DownloadProgress>()
  private val assetCache = ConcurrentHashMap<String, ByteArray>()
  private val random = SecureRandom()

  fun addListener(listener: () -> Unit) {
    listeners.add(listener)
  }

  fun removeListener(listener: () -> Unit) {
    listeners.remove(listener)
  }

  private fun notifyChanged() {
    listeners.forEach { runCatching { it() } }
  }

  val isRunning: Boolean get() = running != null

  fun status(context: Context): Status {
    val auth = components(context).auth
    val current = running
    val pin = auth.pinState()
    return Status(
      running = current != null,
      address = current?.address,
      port = current?.port,
      pin = if (current != null) pin.pin else null,
      lockedUntil = if (current != null) pin.lockedUntil else null,
      pinWithdrawn = current != null && pin.closedByFailures,
      stopReason = if (current == null) lastStopReason else null,
      idleStopsAt = current?.let { lastRequestAt + RemoteStopPolicy.IDLE_TIMEOUT_MS },
      clients = auth.clients(),
    )
  }

  @Synchronized
  fun start(context: Context): Status {
    if (running != null) return status(context)
    val app = context.applicationContext
    val lan = LanAddress.all(app).firstOrNull() ?: throw NoWifiException()
    val parts = components(app)
    val engine = DownloadEngineProvider.get(app)
    AppVisibility.install(app)
    parts.auth.onChange = ::notifyChanged
    val prefs = app.getSharedPreferences(RemotePrefs.FILE, Context.MODE_PRIVATE)
    val saved = prefs.getInt(PORT_KEY, 0).takeIf { it in MIN_PORT until MIN_PORT + PORT_SPAN }
    val candidates = (listOfNotNull(saved) + List(PORT_TRIES) { MIN_PORT + random.nextInt(PORT_SPAN) }).distinct()
    var lastError: Throwable? = null
    for (port in candidates) {
      val lanServer = RemoteServer(lan.address, port, router(app, engine, parts, RemoteHostPolicy(lan.address, port)))
      try {
        lanServer.start(SOCKET_TIMEOUT_MS, true)
      } catch (e: Exception) {
        lastError = e
        continue
      }
      val loopback = RemoteServer(LOOPBACK, port, router(app, engine, parts, RemoteHostPolicy(LOOPBACK, port, acceptLoopbackNames = true)))
      val servers = if (runCatching { loopback.start(SOCKET_TIMEOUT_MS, true) }.isSuccess) listOf(lanServer, loopback) else listOf(lanServer)
      prefs.edit().putInt(PORT_KEY, port).apply()
      lastRequestAt = System.currentTimeMillis()
      lastStopReason = null
      parts.auth.newPin()
      val scope = MediaServices.get(app).scope
      val progressJob = scope.launch { engine.progress.collect { progress[it.id] = it } }
      val watchdog = scope.launch {
        while (isActive) {
          delay(RemoteStopPolicy.CHECK_INTERVAL_MS)
          check(app)
        }
      }
      running = Running(servers, lan.address, port, lan.network, listOf(progressJob, watchdog), watchNetwork(app))
      Log.i(TAG, "remote control on, port $port")
      notifyChanged()
      return status(app)
    }
    throw RemoteStartException(lastError)
  }

  fun stop(reason: RemoteStopReason) {
    val stopped = synchronized(this) {
      val current = running ?: return
      running = null
      current
    }
    stopped.servers.forEach { runCatching { it.stop() } }
    stopped.jobs.forEach { it.cancel() }
    stopped.callback?.let { callback ->
      instanceContext?.getSystemService(ConnectivityManager::class.java)?.let { runCatching { it.unregisterNetworkCallback(callback) } }
    }
    instanceContext?.let { components(it).auth.closePairing() }
    progress.clear()
    lastStopReason = reason
    Log.i(TAG, "remote control off: ${reason.wire}")
    notifyChanged()
  }

  /** A fresh PIN on the phone (also lifts a PIN lock). */
  fun newPin(context: Context): Status {
    if (running != null) components(context).auth.newPin()
    return status(context)
  }

  /** #511: adds a link — and, for a finished download, its video — to the Web UI's "Sent from phone" list. */
  suspend fun sendToComputer(context: Context, url: String?, title: String, downloadId: String?): SentItem? {
    val app = context.applicationContext
    var pageUrl = url
    var libraryItemId: String? = null
    var size: Long? = null
    if (!downloadId.isNullOrBlank()) {
      val record = runCatching { DownloadEngineProvider.get(app).listDownloads().firstOrNull { it.id == downloadId } }.getOrNull()
      val item = MediaServices.get(app).library.get(record?.libraryItemId ?: downloadId)
      if (item != null && item.file.isFile) {
        libraryItemId = item.id
        size = item.sizeBytes
        if (pageUrl == null) pageUrl = item.pageUrl
      } else if (pageUrl == null) {
        pageUrl = record?.pageUrl
      }
    }
    return components(app).sent.add(title, pageUrl, libraryItemId, size).also { notifyChanged() }
  }

  internal fun components(context: Context): RemoteComponents {
    instanceContext = context.applicationContext
    return RemoteComponents.get(context)
  }

  @Volatile private var instanceContext: Context? = null

  private fun check(context: Context) {
    val current = running ?: return
    val addresses = LanAddress.all(context).map { it.address }
    val reason = RemoteStopPolicy.check(
      now = System.currentTimeMillis(),
      lastRequestAt = lastRequestAt,
      backgroundSince = AppVisibility.backgroundSince,
      hasLiveWork = BackgroundDownloads.hasLiveWork(),
      boundAddress = current.address,
      currentLanAddress = current.address.takeIf { it in addresses },
    )
    if (reason != null) stop(reason)
  }

  /** Wi-Fi loss is acted on at once, not at the next watchdog look. */
  private fun watchNetwork(context: Context): ConnectivityManager.NetworkCallback? {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return null
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onLost(network: Network) {
        if (running?.network == network) stop(RemoteStopReason.WIFI_LOST)
      }

      override fun onLinkPropertiesChanged(network: Network, linkProperties: android.net.LinkProperties) {
        val current = running ?: return
        if (current.network != network) return
        if (linkProperties.linkAddresses.none { it.address.hostAddress == current.address }) stop(RemoteStopReason.WIFI_LOST)
      }
    }
    val request = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
      .build()
    return runCatching { manager.registerNetworkCallback(request, callback) }.map { callback }.getOrNull()
  }

  private fun router(context: Context, engine: DownloadEngineApi, parts: RemoteComponents, hosts: RemoteHostPolicy) = RemoteRouter(
    auth = parts.auth,
    queue = EngineRemoteQueue(engine, progress),
    links = parts.inbox,
    sent = parts.sent,
    hosts = hosts,
    assets = { name -> asset(context, name) },
    language = { DownloadNotificationText.language },
    onRequest = { lastRequestAt = System.currentTimeMillis() },
  )

  private fun asset(context: Context, name: String): ByteArray? = assetCache[name] ?: runCatching {
    context.assets.open("$ASSET_DIR/$name").use { it.readBytes() }
  }.getOrNull()?.also { assetCache[name] = it }

  private const val LOOPBACK = "127.0.0.1"
  private const val ASSET_DIR = "vidorax-remote"
}

/** The Web UI's queue: the engine's own records and calls, with the latest progress event of each download. */
private class EngineRemoteQueue(
  private val engine: DownloadEngineApi,
  private val progress: Map<String, DownloadProgress>,
) : RemoteQueue {
  override suspend fun list(): List<RemoteDownload> = engine.listDownloads().map { RemoteDownload.from(it, progress[it.id]) }

  override suspend fun pause(id: String) = engine.pause(id)

  override suspend fun resume(id: String) = engine.resume(id)

  override suspend fun retry(id: String) = engine.retry(id)

  override suspend fun cancel(id: String) = engine.cancel(id)

  override suspend fun pauseAll() = engine.pauseAll()

  override suspend fun resumeAll() = engine.resumeAll()
}
