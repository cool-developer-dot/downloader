package com.vidorax.web.window

import android.content.Intent
import com.vidorax.web.profiles.WebProfileNames

/**
 * B20 #16: one tab moved into its own window: the page, the browser profile it belongs to, its User-Agent (desktop
 * mode), and the app's language direction, theme colours and labels (the app's language is its own setting, not the
 * phone's, so the window gets its words from JS). Parsed defensively: anything malformed falls back or is refused.
 */
internal data class BrowserWindowRequest(
  val windowId: String,
  val url: String,
  val title: String,
  val profile: String,
  val userAgent: String?,
  val lockOnLeave: Boolean,
  val rtl: Boolean,
  val dark: Boolean,
  val colors: Colors,
  val labels: Labels,
) {
  data class Colors(val background: Int, val surface: Int, val text: Int, val textSecondary: Int, val accent: Int)

  data class Labels(
    val back: String,
    val forward: String,
    val reload: String,
    val stop: String,
    val moveBack: String,
    val close: String,
  )

  fun writeTo(intent: Intent): Intent =
    intent
      .putExtra(EXTRA_WINDOW_ID, windowId)
      .putExtra(EXTRA_URL, url)
      .putExtra(EXTRA_TITLE, title)
      .putExtra(EXTRA_PROFILE, profile)
      .putExtra(EXTRA_USER_AGENT, userAgent)
      .putExtra(EXTRA_LOCK_ON_LEAVE, lockOnLeave)
      .putExtra(EXTRA_RTL, rtl)
      .putExtra(EXTRA_DARK, dark)
      .putExtra(EXTRA_COLORS, intArrayOf(colors.background, colors.surface, colors.text, colors.textSecondary, colors.accent))
      .putExtra(
        EXTRA_LABELS,
        arrayOf(labels.back, labels.forward, labels.reload, labels.stop, labels.moveBack, labels.close),
      )

  companion object {
    private const val EXTRA_WINDOW_ID = "com.vidorax.web.window.ID"
    private const val EXTRA_URL = "com.vidorax.web.window.URL"
    private const val EXTRA_TITLE = "com.vidorax.web.window.TITLE"
    private const val EXTRA_PROFILE = "com.vidorax.web.window.PROFILE"
    private const val EXTRA_USER_AGENT = "com.vidorax.web.window.USER_AGENT"
    private const val EXTRA_LOCK_ON_LEAVE = "com.vidorax.web.window.LOCK_ON_LEAVE"
    private const val EXTRA_RTL = "com.vidorax.web.window.RTL"
    private const val EXTRA_DARK = "com.vidorax.web.window.DARK"
    private const val EXTRA_COLORS = "com.vidorax.web.window.COLORS"
    private const val EXTRA_LABELS = "com.vidorax.web.window.LABELS"

    const val MAX_TITLE_LENGTH = 300
    const val MAX_USER_AGENT_LENGTH = 512
    const val MAX_LABEL_LENGTH = 80
    private val WINDOW_ID = Regex("^[A-Za-z0-9_-]{1,64}$")

    private val LIGHT = Colors(0xFFFFFFFF.toInt(), 0xFFF4F4F5.toInt(), 0xFF111114.toInt(), 0xFF6B6B73.toInt(), 0xFFE5262E.toInt())
    private val DARK = Colors(0xFF0F0F12.toInt(), 0xFF1C1C21.toInt(), 0xFFF4F4F5.toInt(), 0xFFA1A1AA.toInt(), 0xFFF0444B.toInt())
    private val ENGLISH = Labels("Back", "Forward", "Reload", "Stop", "Move to main window", "Close window")

    /** From JS (VidoraWeb.openBrowserWindow); null when the page can't be shown in a window. */
    fun of(
      windowId: String,
      url: String,
      title: String,
      profile: String,
      userAgent: String?,
      lockOnLeave: Boolean,
      rtl: Boolean,
      dark: Boolean,
      colors: Map<String, String>,
      labels: Map<String, String>,
    ): BrowserWindowRequest? {
      if (!WINDOW_ID.matches(windowId) || !WindowUrlPolicy.canOpen(url) || !WebProfileNames.isValid(profile)) return null
      val fallback = if (dark) DARK else LIGHT
      return BrowserWindowRequest(
        windowId = windowId,
        url = url.trim(),
        title = title.take(MAX_TITLE_LENGTH),
        profile = profile,
        userAgent = userAgent?.takeIf { it.isNotBlank() && it.length <= MAX_USER_AGENT_LENGTH && it.none(Char::isISOControl) },
        lockOnLeave = lockOnLeave,
        rtl = rtl,
        dark = dark,
        colors = Colors(
          background = parseColor(colors["background"]) ?: fallback.background,
          surface = parseColor(colors["surface"]) ?: fallback.surface,
          text = parseColor(colors["text"]) ?: fallback.text,
          textSecondary = parseColor(colors["textSecondary"]) ?: fallback.textSecondary,
          accent = parseColor(colors["accent"]) ?: fallback.accent,
        ),
        labels = Labels(
          back = label(labels["back"], ENGLISH.back),
          forward = label(labels["forward"], ENGLISH.forward),
          reload = label(labels["reload"], ENGLISH.reload),
          stop = label(labels["stop"], ENGLISH.stop),
          moveBack = label(labels["moveBack"], ENGLISH.moveBack),
          close = label(labels["close"], ENGLISH.close),
        ),
      )
    }

    fun from(intent: Intent?): BrowserWindowRequest? {
      intent ?: return null
      val colors = intent.getIntArrayExtra(EXTRA_COLORS)?.takeIf { it.size == 5 }
      val labels = intent.getStringArrayExtra(EXTRA_LABELS)?.takeIf { it.size == 6 }
      val dark = intent.getBooleanExtra(EXTRA_DARK, false)
      val parsed = of(
        windowId = intent.getStringExtra(EXTRA_WINDOW_ID).orEmpty(),
        url = intent.getStringExtra(EXTRA_URL).orEmpty(),
        title = intent.getStringExtra(EXTRA_TITLE).orEmpty(),
        profile = intent.getStringExtra(EXTRA_PROFILE) ?: WebProfileNames.DEFAULT,
        userAgent = intent.getStringExtra(EXTRA_USER_AGENT),
        lockOnLeave = intent.getBooleanExtra(EXTRA_LOCK_ON_LEAVE, false),
        rtl = intent.getBooleanExtra(EXTRA_RTL, false),
        dark = dark,
        colors = emptyMap(),
        labels = emptyMap(),
      ) ?: return null
      return parsed.copy(
        colors = colors?.let { Colors(it[0], it[1], it[2], it[3], it[4]) } ?: parsed.colors,
        labels = labels?.let {
          Labels(
            label(it[0], ENGLISH.back),
            label(it[1], ENGLISH.forward),
            label(it[2], ENGLISH.reload),
            label(it[3], ENGLISH.stop),
            label(it[4], ENGLISH.moveBack),
            label(it[5], ENGLISH.close),
          )
        } ?: parsed.labels,
      )
    }

    /** `#RRGGBB` or `#AARRGGBB`. */
    fun parseColor(value: String?): Int? {
      val hex = value?.trim()?.removePrefix("#") ?: return null
      if (hex.length != 6 && hex.length != 8) return null
      val parsed = hex.toLongOrNull(16) ?: return null
      return if (hex.length == 6) (0xFF000000L or parsed).toInt() else parsed.toInt()
    }

    private fun label(value: String?, fallback: String): String =
      value?.trim()?.takeIf { it.isNotEmpty() && it.none(Char::isISOControl) }?.take(MAX_LABEL_LENGTH) ?: fallback
  }
}
