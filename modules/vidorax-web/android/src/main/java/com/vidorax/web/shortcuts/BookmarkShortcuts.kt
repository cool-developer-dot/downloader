package com.vidorax.web.shortcuts

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.Icon
import android.os.Build
import java.security.MessageDigest

/**
 * B9 #87 — "Add to home screen" for a bookmark: a pinned launcher shortcut (`ShortcutManager.requestPinShortcut`,
 * Android 8+; no permission, the launcher asks the user). Its icon is the site's first letter on a colour picked from
 * the address. Tapping it starts the app with a private action (not a VIEW, so it never goes through the shared-link
 * path) carrying the address; JS opens it in a new tab once App Lock is unlocked.
 */
object BookmarkShortcuts {
  const val ACTION_OPEN = "com.vidorax.web.action.OPEN_BOOKMARK_SHORTCUT"
  const val EXTRA_URL = "com.vidorax.web.extra.SHORTCUT_URL"
  private const val EXTRA_CONSUMED = "com.vidorax.web.extra.SHORTCUT_CONSUMED"
  private const val MAX_URL = 4096
  private const val MAX_LABEL = 25

  private val PALETTE = intArrayOf(
    0xFF1E88E5.toInt(), 0xFF43A047.toInt(), 0xFFE53935.toInt(), 0xFF8E24AA.toInt(),
    0xFFF4511E.toInt(), 0xFF00897B.toInt(), 0xFF3949AB.toInt(), 0xFF6D4C41.toInt(),
  )

  fun isWebUrl(url: String): Boolean =
    url.length in 1..MAX_URL && (url.startsWith("https://", true) || url.startsWith("http://", true)) && url.none { it.isWhitespace() }

  /** The host of an http(s) address, without `www.`; '' when there is none. */
  fun hostOf(url: String): String {
    val rest = url.substringAfter("://", "")
    val host = rest.substringBefore('/').substringBefore('?').substringBefore('#').substringAfterLast('@').substringBefore(':')
    return host.lowercase().removePrefix("www.")
  }

  /** The first letter or digit of the title, else of the host; '?' when neither has one. Upper case where it has one. */
  fun letterOf(title: String, url: String): String {
    val source = title.firstOrNull { Character.isLetterOrDigit(it) } ?: hostOf(url).firstOrNull { Character.isLetterOrDigit(it) }
    return source?.uppercaseChar()?.toString() ?: "?"
  }

  fun colorFor(url: String): Int {
    val host = hostOf(url).ifEmpty { url }
    var hash = 0
    for (c in host) hash = hash * 31 + c.code
    return PALETTE[Math.floorMod(hash, PALETTE.size)]
  }

  /** One shortcut per address: pinning the same bookmark again updates it instead of adding a second. */
  fun shortcutId(url: String): String {
    val digest = MessageDigest.getInstance("SHA-1").digest(url.toByteArray(Charsets.UTF_8))
    return "bookmark-" + digest.take(8).joinToString("") { "%02x".format(it) }
  }

  fun label(title: String, url: String): String = (title.trim().ifEmpty { hostOf(url).ifEmpty { url } }).take(MAX_LABEL)

  fun letterIcon(letter: String, color: Int, sizePx: Int): Bitmap {
    val size = sizePx.coerceIn(48, 432)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = color
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    paint.color = Color.WHITE
    paint.typeface = Typeface.DEFAULT_BOLD
    paint.textSize = size * 0.5f
    paint.textAlign = Paint.Align.CENTER
    val baseline = size / 2f - (paint.descent() + paint.ascent()) / 2f
    canvas.drawText(letter, size / 2f, baseline, paint)
    return bitmap
  }

  /** The intent the shortcut starts: the app's launcher activity with the private action and the address. */
  fun openIntent(context: Context, url: String): Intent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    return Intent(ACTION_OPEN)
      .setPackage(context.packageName)
      .apply { launch?.component?.let { component = it } }
      .putExtra(EXTRA_URL, url)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }

  /** The address a shortcut started the app with, at most once per intent (a JS reload doesn't open it again). */
  fun takeShortcutUrl(intent: Intent?): String? {
    if (intent == null || intent.action != ACTION_OPEN || intent.getBooleanExtra(EXTRA_CONSUMED, false)) return null
    val url = intent.getStringExtra(EXTRA_URL)?.takeIf { isWebUrl(it) } ?: return null
    intent.putExtra(EXTRA_CONSUMED, true)
    return url
  }

  fun canPin(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return context.getSystemService(ShortcutManager::class.java)?.isRequestPinShortcutSupported == true
  }

  /** `pinned` (the launcher shows its own confirmation), `unsupported` (this launcher can't pin), `invalid`, `failed`. */
  fun pin(context: Context, url: String, title: String): String {
    if (!isWebUrl(url)) return "invalid"
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "unsupported"
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return "unsupported"
    if (!manager.isRequestPinShortcutSupported) return "unsupported"
    return try {
      val sizePx = (108 * context.resources.displayMetrics.density).toInt()
      val info = ShortcutInfo.Builder(context, shortcutId(url))
        .setShortLabel(label(title, url))
        .setLongLabel(title.trim().ifEmpty { url }.take(MAX_LABEL * 2))
        .setIcon(Icon.createWithBitmap(letterIcon(letterOf(title, url), colorFor(url), sizePx)))
        .setIntent(openIntent(context, url))
        .build()
      if (manager.requestPinShortcut(info, null)) "pinned" else "failed"
    } catch (_: RuntimeException) {
      "failed"
    }
  }
}
