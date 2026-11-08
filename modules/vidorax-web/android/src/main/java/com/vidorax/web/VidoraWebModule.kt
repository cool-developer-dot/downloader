package com.vidorax.web

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.security.NetworkSecurityPolicy
import android.view.ActionMode
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import com.facebook.react.bridge.ReactContext
import com.reactnativecommunity.webview.RNCWebView
import com.reactnativecommunity.webview.RNCWebViewHooks
import com.reactnativecommunity.webview.RNCWebViewModule
import com.reactnativecommunity.webview.RNCWebViewWrapper
import com.vidorax.web.display.LayerPaint
import com.vidorax.web.display.PageLayout
import com.vidorax.web.keys.VidoraKeyChannel
import com.vidorax.web.performance.AppTraffic
import com.vidorax.web.performance.ImageBlocking
import com.vidorax.web.performance.PowerSaving
import com.vidorax.web.memory.AppMemory
import com.vidorax.web.navigation.NavigationMode
import com.vidorax.web.navigation.WebHistoryWindow
import com.vidorax.web.network.DnsPrefetcher
import com.vidorax.web.network.NetworkMediaObserver
import com.vidorax.web.network.ServiceWorkerRequests
import com.vidorax.web.network.WebDownloadRoute
import com.vidorax.web.privacy.SitePrivacy
import com.vidorax.web.profiles.WebProfiles
import com.vidorax.web.selection.SelectionMenu
import com.vidorax.web.shortcuts.BookmarkShortcuts
import com.vidorax.web.selection.SelectionMenuCallback
import com.vidorax.web.window.BrowserWindowRecord
import com.vidorax.web.window.BrowserWindows
import com.vidorax.web.snapshot.WebViewSnapshots
import com.vidorax.web.startpage.StartPageImages
import com.vidorax.web.startpage.StartPagePhotoContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.io.File
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val ON_NETWORK_MEDIA = "onNetworkMedia"
private const val ON_WEB_DOWNLOAD = "onWebDownload"
private const val ON_SHARED_TEXT = "onSharedText"
private const val ON_CAPTURED_KEY = "onCapturedKey"
private const val ON_BROWSER_WINDOW = "onBrowserWindow"
private const val ON_SELECTION_ACTION = "onSelectionAction"
private const val ON_SHORTCUT_OPEN = "onShortcutOpen"

// react-native-webview's own download defaults (RNCWebViewManagerImpl).
private const val DOWNLOADING_MESSAGE = "Downloading"
private val INVALID_FILE_NAME_CHARS = Regex("[\\\\/%\"]")

/** Contract: modules/vidorax-web/src/VidoraWeb.types.ts. */
class VidoraWebModule : Module() {
  private val networkObserver = NetworkMediaObserver { observations ->
    sendEvent(ON_NETWORK_MEDIA, mapOf("observations" to observations))
  }

  @Volatile private var hasWebDownloadListeners = false
  @Volatile private var hasSharedTextListeners = false
  @Volatile private var hasShortcutListeners = false

  // B9 #87: a bookmark shortcut tapped while JS was not listening, handed out by consumeShortcutUrl.
  private val unclaimedShortcutUrl = AtomicReference<String?>(null)

  // A link shared while JS was not listening, handed out by consumeSharedText.
  private val unclaimedSharedText = AtomicReference<String?>(null)

  // B1: JPEG encoding of tab previews, off the main thread; one at a time is plenty (≤ 1 per tab switch).
  private val snapshotEncoder: ExecutorService by lazy { Executors.newSingleThreadExecutor() }

  // B6 #55: DNS lookups ahead of a likely page load.
  private val dnsPrefetcher by lazy { DnsPrefetcher() }

  // B8: the app's items in the text-selection menu (from JS), used only while JS listens to onSelectionAction.
  private val selectionMenu = AtomicReference<SelectionMenu.Config?>(null)
  @Volatile private var hasSelectionListeners = false

  // B21 #245: the system Photo Picker (or document picker) for the start page's background.
  private lateinit var startPagePhotoLauncher: AppContextActivityResultLauncher<StartPagePhotoContract.Request, android.net.Uri?>

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val webViewHooks = object : RNCWebViewHooks.Listener {
    // B20: a new WebView joins the active browser profile before react-native-webview sets it up.
    override fun beforeWebViewSetup(webView: RNCWebView) {
      WebProfiles.apply(webView)
    }

    override fun onWebViewCreated(webView: RNCWebView) {
      ServiceWorkerRequests.install()
    }

    override fun observeRequest(view: WebView?, request: WebResourceRequest) {
      networkObserver.observe(view, request)
    }

    override fun onDownloadStart(
      webView: RNCWebView,
      url: String,
      userAgent: String?,
      contentDisposition: String?,
      mimeType: String?,
      contentLength: Long,
    ): Boolean {
      if (!hasWebDownloadListeners || !isHttpUrl(url)) {
        return false
      }
      // Videos go to the detection pipeline, and app or program files (H17) to JavaScript for the warning before
      // DownloadManager; every other download goes to DownloadManager as before.
      val hint = when (val route = WebDownloadRoute.of(url, mimeType, contentDisposition)) {
        is WebDownloadRoute.Detect -> route.hint.value
        WebDownloadRoute.Warn -> WebDownloadRoute.RISKY_HINT
        WebDownloadRoute.System -> return false
      }
      sendEvent(
        ON_WEB_DOWNLOAD,
        mapOf(
          "viewTag" to RNCWebViewWrapper.getReactTagFromWebView(webView),
          "url" to url,
          "userAgent" to (userAgent ?: webView.settings.userAgentString),
          "contentDisposition" to contentDisposition?.takeIf { it.isNotBlank() },
          "mimeType" to mimeType?.takeIf { it.isNotBlank() },
          "contentLength" to contentLength.takeIf { it > 0 },
          "hint" to hint,
        ),
      )
      return true
    }

    // B8: adds the app's items (Search, …) to the page's own text-selection menu; see SelectionMenuCallback.
    override fun wrapSelectionMenu(webView: RNCWebView, callback: ActionMode.Callback): ActionMode.Callback {
      val config = selectionMenu.get()
      if (config == null || !hasSelectionListeners) return callback
      val viewTag = RNCWebViewWrapper.getReactTagFromWebView(webView)
      return SelectionMenuCallback(webView, callback, config) { itemId, text ->
        sendEvent(ON_SELECTION_ACTION, mapOf("viewTag" to viewTag, "itemId" to itemId, "text" to text))
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("VidoraWeb")

    Events(ON_NETWORK_MEDIA, ON_WEB_DOWNLOAD, ON_SHARED_TEXT, ON_CAPTURED_KEY, ON_BROWSER_WINDOW, ON_SELECTION_ACTION, ON_SHORTCUT_OPEN)

    OnCreate {
      RNCWebViewHooks.setListener(webViewHooks)
    }

    OnDestroy {
      RNCWebViewHooks.removeListener(webViewHooks)
      networkObserver.setHasListeners(false)
      VidoraKeyChannel.setListener(null)
      BrowserWindows.setListener(null)
    }

    OnStartObserving(ON_NETWORK_MEDIA) { networkObserver.setHasListeners(true) }
    OnStopObserving(ON_NETWORK_MEDIA) { networkObserver.setHasListeners(false) }
    OnStartObserving(ON_WEB_DOWNLOAD) { hasWebDownloadListeners = true }
    OnStopObserving(ON_WEB_DOWNLOAD) { hasWebDownloadListeners = false }
    OnStartObserving(ON_SHARED_TEXT) { hasSharedTextListeners = true }
    OnStartObserving(ON_SHORTCUT_OPEN) { hasShortcutListeners = true }
    OnStopObserving(ON_SHORTCUT_OPEN) { hasShortcutListeners = false }
    OnStopObserving(ON_SHARED_TEXT) { hasSharedTextListeners = false }
    // B6 #240: keys are only ever taken while JS listens for them.
    OnStartObserving(ON_CAPTURED_KEY) {
      VidoraKeyChannel.setListener { key, repeat ->
        sendEvent(ON_CAPTURED_KEY, mapOf("key" to key, "repeat" to repeat))
      }
    }
    OnStopObserving(ON_CAPTURED_KEY) { VidoraKeyChannel.setListener(null) }
    // B20 #16: what happens in separate browser windows (see BrowserWindows).
    OnStartObserving(ON_BROWSER_WINDOW) {
      BrowserWindows.setListener { event -> sendEvent(ON_BROWSER_WINDOW, event) }
    }
    OnStopObserving(ON_BROWSER_WINDOW) { BrowserWindows.setListener(null) }
    // B8: the selection menu gets the app's items only while JS listens.
    OnStartObserving(ON_SELECTION_ACTION) { hasSelectionListeners = true }
    OnStopObserving(ON_SELECTION_ACTION) { hasSelectionListeners = false }

    // B21 #245: the start page's background photo — picked without a permission, copied and scaled into app storage.
    RegisterActivityContracts {
      startPagePhotoLauncher = registerForActivityResult(StartPagePhotoContract())
    }

    AsyncFunction("pickStartPageImage") Coroutine { maxSize: Int ->
      val uri = startPagePhotoLauncher.launch(StartPagePhotoContract.Request()) ?: return@Coroutine null
      val resolver = context.contentResolver
      val directory = File(context.filesDir, StartPageImages.DIRECTORY)
      val saved = withContext(Dispatchers.IO) {
        StartPageImages.copyScaled({ resolver.openInputStream(uri) }, directory, maxSize, System.currentTimeMillis())
      } ?: return@Coroutine mapOf("error" to "unreadable")
      mapOf("uri" to Uri.fromFile(saved.file).toString(), "width" to saved.width, "height" to saved.height)
    }

    // B9 #87: bookmark shortcuts on the home screen (see BookmarkShortcuts).
    Function("canPinShortcuts") {
      BookmarkShortcuts.canPin(context)
    }

    AsyncFunction("pinBookmarkShortcut") { url: String, title: String ->
      BookmarkShortcuts.pin(context, url, title)
    }.runOnQueue(Queues.MAIN)

    Function("consumeShortcutUrl") {
      unclaimedShortcutUrl.getAndSet(null) ?: BookmarkShortcuts.takeShortcutUrl(appContext.currentActivity?.intent)
    }

    // B3 #190: the app's memory use for Browser settings (background queue; a few ms).
    AsyncFunction("getAppMemory") {
      AppMemory.toMap(AppMemory.read(context))
    }

    AsyncFunction("clearStartPageImage") {
      StartPageImages.clear(File(context.filesDir, StartPageImages.DIRECTORY))
    }

    // B8: the app's text-selection menu items (`ids` / `titles` pair up) and the script that reads the selection.
    Function("setSelectionMenu") { ids: List<String>, titles: List<String>, readScript: String ->
      selectionMenu.set(SelectionMenu.configOf(ids, titles, readScript))
    }

    Function("setNetworkObservationEnabled") { enabled: Boolean ->
      networkObserver.setEnabled(enabled)
    }

    AsyncFunction("setWebViewActive") { viewTag: Int, active: Boolean ->
      setWebViewActive(viewTag, active)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("snapshotWebView") { viewTag: Int, maxWidth: Int, key: String, promise: Promise ->
      snapshotWebView(viewTag, maxWidth, key, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getWebViewHistory") { viewTag: Int ->
      getWebViewHistory(viewTag)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("goBackOrForward") { viewTag: Int, steps: Int ->
      goBackOrForward(viewTag, steps)
    }.runOnQueue(Queues.MAIN)

    Function("setKeyCapture") { volumeKeys: Boolean, combos: List<String> ->
      VidoraKeyChannel.configure(volumeKeys, combos)
    }

    Function("getNavigationMode") {
      NavigationMode.read(context)
    }

    Function("prefetchDns") { host: String ->
      dnsPrefetcher.prefetch(host)
      Unit
    }

    AsyncFunction("flushCookies") {
      CookieManager.getInstance().flush()
      WebProfiles.cookies().flush()
    }

    // B20: browser profiles. See WebProfiles.
    // Main thread: asking loads the WebView provider, which belongs there.
    AsyncFunction("isWebProfileSupported") {
      WebProfiles.isSupported()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setWebProfile") { name: String ->
      WebProfiles.setActive(name)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("deleteWebProfile") { name: String ->
      WebProfiles.delete(name)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getWebProfileNames") {
      WebProfiles.names()
    }.runOnQueue(Queues.MAIN)

    // B12 privacy controls, for the active browser profile (see SitePrivacy).
    AsyncFunction("setCookiesEnabled") { enabled: Boolean ->
      SitePrivacy.setCookiesEnabled(enabled)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getCertificate") { viewTag: Int ->
      SitePrivacy.certificate(webViewFor(viewTag))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("listSiteData") { promise: Promise ->
      SitePrivacy.listOrigins { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearSiteData") { origin: String, promise: Promise ->
      SitePrivacy.clearOrigin(origin) { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearAllSiteData") { promise: Promise ->
      SitePrivacy.clearAll { promise.resolve(true) }
    }.runOnQueue(Queues.MAIN)

    Function("getCookieCount") { url: String ->
      SitePrivacy.cookieCount(url)
    }

    // B12 #124: whether this build may open plain http at all (release builds don't: no cleartext in the manifest).
    Function("isCleartextAllowed") {
      NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted
    }

    // B20 #16 Move tab to new window.
    AsyncFunction("openBrowserWindow") { record: BrowserWindowRecord ->
      val request = record.toRequest() ?: return@AsyncFunction false
      BrowserWindows.open(context, appContext.currentActivity, request)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("closeBrowserWindows") { profile: String ->
      BrowserWindows.closeProfile(profile)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("launchIntentUri") { uri: String ->
      launchIntentUri(uri)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startSystemDownload") { url: String, userAgent: String?, contentDisposition: String?, mimeType: String? ->
      startSystemDownload(url, userAgent, contentDisposition, mimeType)
    }.runOnQueue(Queues.MAIN)

    // Settings → Theme, told to Android so the launch screen follows it (see AppNightMode).
    Function("setAppNightMode") { mode: String ->
      AppNightMode.apply(context, mode)
    }

    Function("getDefaultUserAgent") {
      WebSettings.getDefaultUserAgent(context)
    }

    Function("consumeSharedText") {
      unclaimedSharedText.getAndSet(null) ?: takeSharedText(appContext.currentActivity?.intent)
    }

    Function("isDefaultBrowser") {
      DefaultBrowser.isHeld(context)
    }

    Function("canRequestDefaultBrowser") {
      DefaultBrowser.canRequest(context)
    }

    AsyncFunction("requestDefaultBrowser") {
      DefaultBrowser.request(appContext.currentActivity, context)
    }.runOnQueue(Queues.MAIN)

    // B16 #169 / #165 / #163: text reflow, default zoom, darkening on Android 13+ (see PageLayout).
    AsyncFunction("setPageLayout") { viewTag: Int, textAutosizing: Boolean, initialScale: Int, algorithmicDarkening: Boolean ->
      val webView = webViewFor(viewTag) ?: return@AsyncFunction false
      PageLayout.apply(webView, textAutosizing, initialScale, algorithmicDarkening)
      true
    }.runOnQueue(Queues.MAIN)

    Function("canDarkenPagesAlgorithmically") {
      PageLayout.canDarkenAlgorithmically()
    }

    // B16 #179 / #180: the page's colour filter and night light as one 4x5 colour matrix on the WebView's layer.
    AsyncFunction("setDisplayFilter") { viewTag: Int, matrix: List<Double>? ->
      val webView = webViewFor(viewTag) ?: return@AsyncFunction false
      LayerPaint.setColorMatrix(webView, LayerPaint.validMatrix(matrix))
      true
    }.runOnQueue(Queues.MAIN)

    // B18 #183 / #193 / #184: pictures off for this tab (WebSettings.setBlockNetworkImage).
    AsyncFunction("setBlockNetworkImage") { viewTag: Int, block: Boolean ->
      val webView = webViewFor(viewTag) ?: return@AsyncFunction false
      ImageBlocking.apply(webView, block)
      true
    }.runOnQueue(Queues.MAIN)

    // B18 #189: hardware acceleration off for this tab = a software layer (LayerPaint keeps B16's filter).
    AsyncFunction("setSoftwareLayer") { viewTag: Int, software: Boolean ->
      val webView = webViewFor(viewTag) ?: return@AsyncFunction false
      LayerPaint.setSoftware(webView, software)
      true
    }.runOnQueue(Queues.MAIN)

    // B18 #185: this app's network bytes since the phone started (TrafficStats), with the boot count.
    Function("getAppTraffic") {
      AppTraffic.toMap(AppTraffic.read(context))
    }

    // B18 #191: the phone's Battery Saver.
    Function("isPowerSaveMode") {
      PowerSaving.isOn(context)
    }

    OnNewIntent { intent ->
      // B9 #87: a bookmark shortcut tapped while the app runs.
      BookmarkShortcuts.takeShortcutUrl(intent)?.let { url ->
        if (hasShortcutListeners) sendEvent(ON_SHORTCUT_OPEN, mapOf("url" to url)) else unclaimedShortcutUrl.set(url)
        return@OnNewIntent
      }
      val text = takeSharedText(intent) ?: return@OnNewIntent
      if (hasSharedTextListeners) {
        sendEvent(ON_SHARED_TEXT, mapOf("text" to text))
      } else {
        unclaimedSharedText.set(text)
      }
    }
  }

  /**
   * A parked tab's WebView stays attached (so its history and scroll survive) but must stop working. `onPause` hides
   * its page from Chromium: `document.hidden` turns true, rAF and compositor frames stop, timers are throttled and
   * media is suspended; `onResume` reverses that. Not `pauseTimers`, which is process-wide. Its media requests are
   * also dropped natively, so a parked page never costs a bridge event. Returns false when the view is gone.
   */
  private fun setWebViewActive(viewTag: Int, active: Boolean): Boolean {
    val wrapper = try {
      appContext.findView<RNCWebViewWrapper>(viewTag)
    } catch (_: RuntimeException) {
      null
    }
    networkObserver.setViewSuspended(viewTag, !active && wrapper != null)
    val webView = wrapper?.webView ?: return false
    if (active) webView.onResume() else webView.onPause()
    return true
  }

  private fun webViewFor(viewTag: Int): WebView? =
    try {
      appContext.findView<RNCWebViewWrapper>(viewTag)?.webView
    } catch (_: RuntimeException) {
      null
    }

  /** B6 #44: the WebView's own back/forward list around the current page; see WebHistoryWindow. */
  private fun getWebViewHistory(viewTag: Int): Map<String, Any>? {
    val list = webViewFor(viewTag)?.copyBackForwardList() ?: return null
    val window = WebHistoryWindow.of(list.size, list.currentIndex) { index ->
      val item = list.getItemAtIndex(index)
      WebHistoryWindow.Entry(item?.url.orEmpty(), item?.title.orEmpty())
    }
    return mapOf(
      "currentIndex" to window.currentIndex,
      "entries" to window.entries.map { mapOf("url" to it.url, "title" to it.title) },
    )
  }

  /** B6 #44: several history steps at once (negative = back). */
  private fun goBackOrForward(viewTag: Int, steps: Int): Boolean {
    val webView = webViewFor(viewTag) ?: return false
    if (steps == 0 || !webView.canGoBackOrForward(steps)) return false
    webView.goBackOrForward(steps)
    return true
  }

  /**
   * B1 #14: draws the tab's WebView now (main thread, where views may be drawn) and encodes the JPEG on
   * [snapshotEncoder]; resolves `{ uri, width, height }` or null. See WebViewSnapshots.
   */
  private fun snapshotWebView(viewTag: Int, maxWidth: Int, key: String, promise: Promise) {
    if (!WebViewSnapshots.isSafeKey(key)) {
      promise.resolve(null)
      return
    }
    val webView = try {
      appContext.findView<RNCWebViewWrapper>(viewTag)?.webView
    } catch (_: RuntimeException) {
      null
    }
    val bitmap = webView?.let { WebViewSnapshots.capture(it, maxWidth) }
    if (bitmap == null) {
      promise.resolve(null)
      return
    }
    val target = WebViewSnapshots.fileFor(context.cacheDir, key)
    snapshotEncoder.execute {
      val written = WebViewSnapshots.writeJpeg(bitmap, target)
      val result = if (written) {
        mapOf("uri" to android.net.Uri.fromFile(target).toString(), "width" to bitmap.width, "height" to bitmap.height)
      } else {
        null
      }
      bitmap.recycle()
      promise.resolve(result)
    }
  }

  /**
   * Gives a download claimed by [webViewHooks] back to Android's DownloadManager, exactly as react-native-webview's
   * own DownloadListener would have started it (cookies, User-Agent, public Downloads folder, the storage permission
   * prompt below Android 10). Used when JS finds that a claimed download is not a video after all.
   */
  private fun startSystemDownload(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?): Boolean {
    if (!isHttpUrl(url)) return false
    val module = (appContext.reactContext as? ReactContext)?.getNativeModule(RNCWebViewModule::class.java) ?: return false
    val request = try {
      DownloadManager.Request(Uri.parse(url))
    } catch (_: IllegalArgumentException) {
      return false
    }
    val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType).replace(INVALID_FILE_NAME_CHARS, "_")
    WebProfiles.cookies().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
    request.addRequestHeader("User-Agent", userAgent ?: WebSettings.getDefaultUserAgent(context))
    request.setTitle(fileName)
    request.setDescription("$DOWNLOADING_MESSAGE $fileName")
    request.allowScanningByMediaScanner()
    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
    module.setDownloadRequest(request)
    if (module.grantFileDownloaderPermissions(DOWNLOADING_MESSAGE, null)) {
      module.downloadFile(DOWNLOADING_MESSAGE)
    }
    return true
  }

  private fun launchIntentUri(uri: String): Boolean {
    val intent = IntentUris.toSafeIntent(uri) ?: return false
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  private fun isHttpUrl(url: String) =
    url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)
}
