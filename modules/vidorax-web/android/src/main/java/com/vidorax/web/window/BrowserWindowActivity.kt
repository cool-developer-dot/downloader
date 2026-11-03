package com.vidorax.web.window

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import com.vidorax.web.R
import com.vidorax.web.profiles.WebProfiles

/**
 * B20 #16 Move tab to new window: one tab in a window of its own, so it can sit next to the app in split screen (or
 * in its own window on a tablet or Chromebook). It is a small browser — back, forward, reload, the page's title and
 * address, "Move to main window" and Close — with the main browser's safety settings (no mixed content, no file or
 * content access) in the tab's own profile. Links it doesn't show and downloads go to the main window
 * ([WindowUrlPolicy]), so every browser rule still applies to them.
 *
 * With App Lock on, the window doesn't stay behind on its own: when the user leaves it, it closes and its tab goes
 * back into the main window, which asks for the PIN.
 */
class BrowserWindowActivity : Activity() {
  private lateinit var request: BrowserWindowRequest
  private var webView: WebView? = null
  private lateinit var titleView: TextView
  private lateinit var hostView: TextView
  private lateinit var progressBar: ProgressBar
  private lateinit var backButton: ImageButton
  private lateinit var forwardButton: ImageButton
  private lateinit var reloadButton: ImageButton
  private var loading = false
  private var handedOver = false
  private var backCallback: Any? = null

  internal val profileName: String
    get() = if (::request.isInitialized) request.profile else ""

  override fun onCreate(savedInstanceState: Bundle?) {
    val parsed = BrowserWindowRequest.from(intent)
    setTheme(
      if (parsed?.dark == false) android.R.style.Theme_Material_Light_NoActionBar else android.R.style.Theme_Material_NoActionBar,
    )
    super.onCreate(savedInstanceState)
    if (parsed == null) {
      finishAndRemoveTask()
      return
    }
    request = parsed
    setTitle(parsed.title.ifBlank { hostOf(parsed.url) })
    setContentView(buildLayout())
    applySystemBars()
    registerBack()
    BrowserWindows.register(this)

    val view = createWebView()
    webView = view
    (findViewById<ViewGroup>(CONTENT_ID)).addView(
      view,
      LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
    )
    if (savedInstanceState == null || view.restoreState(savedInstanceState) == null) {
      view.loadUrl(parsed.url)
    }
    showPage(parsed.url, parsed.title)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    webView?.saveState(outState)
  }

  override fun onResume() {
    super.onResume()
    webView?.onResume()
  }

  override fun onPause() {
    webView?.onPause()
    CookieManager.getInstance().flush()
    WebProfiles.cookies().flush()
    super.onPause()
  }

  override fun onStop() {
    super.onStop()
    // App Lock: a window the user left must not show the page without the PIN, so its tab goes back (behind).
    if (::request.isInitialized && request.lockOnLeave && !isChangingConfigurations && !isFinishing) {
      handBack(foreground = false)
    }
  }

  override fun onDestroy() {
    BrowserWindows.unregister(this)
    if (::request.isInitialized && isFinishing && !handedOver) {
      // Swiped away from Recents or closed by Android: the tab can still be reopened from the main window.
      handedOver = true
      BrowserWindows.emit("closed", request, currentUrl(), currentTitle())
    }
    unregisterBack()
    webView?.let {
      (it.parent as? ViewGroup)?.removeView(it)
      it.stopLoading()
      it.destroy()
    }
    webView = null
    super.onDestroy()
  }

  @Deprecated("Android 13+ uses OnBackInvokedCallback (registerBack)")
  override fun onBackPressed() {
    goBackOrClose()
  }

  /** Main thread; the window's profile is ending (guest mode, a deleted profile). */
  internal fun closeForProfileEnd() {
    handedOver = true
    finishAndRemoveTask()
  }

  private fun goBackOrClose() {
    val view = webView
    if (view != null && view.canGoBack()) {
      view.goBack()
    } else {
      close()
    }
  }

  private fun close() {
    if (!handedOver) {
      handedOver = true
      BrowserWindows.emit("closed", request, currentUrl(), currentTitle())
    }
    finishAndRemoveTask()
  }

  private fun handBack(foreground: Boolean) {
    if (!handedOver) {
      handedOver = true
      BrowserWindows.emit("returned", request, currentUrl(), currentTitle(), foreground)
    }
    if (foreground) bringAppToFront()
    finishAndRemoveTask()
  }

  private fun openInApp(url: String) {
    BrowserWindows.emit("openInApp", request, url, "", foreground = true)
    bringAppToFront()
  }

  private fun bringAppToFront() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    try {
      startActivity(launch)
    } catch (_: RuntimeException) {
      // The tab is in the main window anyway; the user opens it from the launcher.
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun createWebView(): WebView {
    val view = WebView(this)
    // Before anything else touches the WebView: it joins the tab's profile (its cookies and site data).
    WebProfiles.applyNamed(view, request.profile)
    view.setBackgroundColor(request.colors.background)
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      allowFileAccess = false
      allowContentAccess = false
      @Suppress("DEPRECATION")
      allowFileAccessFromFileURLs = false
      @Suppress("DEPRECATION")
      allowUniversalAccessFromFileURLs = false
      setGeolocationEnabled(false)
      mediaPlaybackRequiresUserGesture = true
      builtInZoomControls = true
      displayZoomControls = false
      // window.open and target=_blank load here: one window shows one tab.
      setSupportMultipleWindows(false)
      javaScriptCanOpenWindowsAutomatically = false
      request.userAgent?.let { userAgentString = it }
      if (request.userAgent != null) {
        useWideViewPort = true
        loadWithOverviewMode = true
      }
    }
    view.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        val url = request.url.toString()
        return when (WindowUrlPolicy.decide(url)) {
          WindowUrlPolicy.Decision.STAY -> false
          WindowUrlPolicy.Decision.OPEN_IN_APP -> {
            openInApp(url)
            true
          }
          WindowUrlPolicy.Decision.BLOCK -> true
        }
      }

      override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        setLoading(true)
        showPage(url, view.title.orEmpty())
      }

      override fun onPageFinished(view: WebView, url: String) {
        setLoading(false)
        showPage(url, view.title.orEmpty())
        if (WindowUrlPolicy.canOpen(url)) {
          BrowserWindows.emit("visit", this@BrowserWindowActivity.request, url, view.title.orEmpty())
        }
      }

      override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
        updateNavigationButtons()
      }

      // A crashed or killed renderer must not take the app down with it: the tab goes back to the main window.
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        webView = null
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        handBack(foreground = false)
        return true
      }
    }
    view.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) {
        progressBar.progress = newProgress
      }

      override fun onReceivedTitle(view: WebView, title: String?) {
        showPage(view.url.orEmpty(), title.orEmpty())
      }
    }
    // Downloads go through the main window, where the download rules and the download sheet are.
    view.setDownloadListener { url, _, _, _, _ ->
      if (WindowUrlPolicy.canOpen(url)) openInApp(url)
    }
    return view
  }

  private fun buildLayout(): View {
    val colors = request.colors
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(colors.surface)
      layoutDirection = if (request.rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
    }
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      minimumHeight = dp(56)
      setPaddingRelative(dp(4), 0, dp(4), 0)
    }
    backButton = iconButton(R.drawable.vx_window_back, request.labels.back) { webView?.takeIf { it.canGoBack() }?.goBack() }
    forwardButton = iconButton(R.drawable.vx_window_forward, request.labels.forward) {
      webView?.takeIf { it.canGoForward() }?.goForward()
    }
    reloadButton = iconButton(R.drawable.vx_window_reload, request.labels.reload) {
      val view = webView ?: return@iconButton
      if (loading) view.stopLoading() else view.reload()
    }
    val texts = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPaddingRelative(dp(8), 0, dp(8), 0)
    }
    titleView = text(15f, colors.text)
    hostView = text(12f, colors.textSecondary)
    texts.addView(titleView)
    texts.addView(hostView)
    bar.addView(backButton)
    bar.addView(forwardButton)
    bar.addView(reloadButton)
    bar.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    bar.addView(iconButton(R.drawable.vx_window_move_back, request.labels.moveBack) { handBack(foreground = true) })
    bar.addView(iconButton(R.drawable.vx_window_close, request.labels.close) { close() })
    root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
      max = 100
      progressTintList = ColorStateList.valueOf(colors.accent)
      progressBackgroundTintList = ColorStateList.valueOf(colors.surface)
      visibility = View.INVISIBLE
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    root.addView(progressBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))

    val content = LinearLayout(this).apply {
      id = CONTENT_ID
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(colors.background)
    }
    root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    return root
  }

  private fun iconButton(icon: Int, label: String, onClick: () -> Unit): ImageButton =
    ImageButton(this).apply {
      setImageResource(icon)
      imageTintList = ColorStateList.valueOf(request.colors.text)
      contentDescription = label
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) tooltipText = label
      val ripple = TypedValue()
      theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true)
      setBackgroundResource(ripple.resourceId)
      minimumWidth = dp(48)
      minimumHeight = dp(48)
      layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
      setOnClickListener { onClick() }
    }

  private fun text(sizeSp: Float, color: Int): TextView =
    TextView(this).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      setTextColor(color)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      textAlignment = View.TEXT_ALIGNMENT_VIEW_START
      textDirection = View.TEXT_DIRECTION_FIRST_STRONG
    }

  private fun applySystemBars() {
    val root = findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
    window.setBackgroundDrawable(ColorDrawable(request.colors.background))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.setDecorFitsSystemWindows(false)
      root.setOnApplyWindowInsetsListener { view, insets ->
        val bars = insets.getInsets(
          WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout(),
        )
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        WindowInsets.CONSUMED
      }
      val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
      window.insetsController?.setSystemBarsAppearance(if (request.dark) 0 else light, light)
    } else {
      @Suppress("DEPRECATION")
      window.statusBarColor = request.colors.surface
      @Suppress("DEPRECATION")
      window.navigationBarColor = request.colors.background
      if (!request.dark) {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
      }
    }
  }

  private fun registerBack() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val callback = OnBackInvokedCallback { goBackOrClose() }
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback)
      backCallback = callback
    }
  }

  private fun unregisterBack() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      (backCallback as? OnBackInvokedCallback)?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
      backCallback = null
    }
  }

  private fun setLoading(value: Boolean) {
    loading = value
    progressBar.visibility = if (value) View.VISIBLE else View.INVISIBLE
    reloadButton.setImageResource(if (value) R.drawable.vx_window_close else R.drawable.vx_window_reload)
    val label = if (value) request.labels.stop else request.labels.reload
    reloadButton.contentDescription = label
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) reloadButton.tooltipText = label
    updateNavigationButtons()
  }

  private fun showPage(url: String, title: String) {
    val host = hostOf(url)
    titleView.text = title.ifBlank { host }
    hostView.text = host
    setTitle(title.ifBlank { host })
    updateNavigationButtons()
  }

  private fun updateNavigationButtons() {
    val view = webView
    backButton.isEnabled = view?.canGoBack() == true
    backButton.alpha = if (backButton.isEnabled) 1f else 0.38f
    forwardButton.isEnabled = view?.canGoForward() == true
    forwardButton.alpha = if (forwardButton.isEnabled) 1f else 0.38f
  }

  private fun currentUrl(): String = webView?.url?.takeIf { WindowUrlPolicy.canOpen(it) } ?: request.url

  private fun currentTitle(): String = webView?.title.orEmpty().ifBlank { request.title }

  private fun hostOf(url: String): String = Uri.parse(url).host.orEmpty().removePrefix("www.").ifBlank { url }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private companion object {
    val CONTENT_ID = View.generateViewId()
  }
}
