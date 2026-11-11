package com.vidorax.media.engine

import android.content.Context
import android.content.SharedPreferences

/**
 * Download Settings → Advanced network → "Retry limit" (#332): how many transient failures in a row (a dropped
 * connection, a truncated read, a 5xx/408/429), without progress in between, a download waits out before it fails.
 *
 * Null — nothing set — is "Automatic": [DownloadEngine.MAX_NETWORK_ATTEMPTS] (5), exactly today's behaviour. A set
 * value is clamped to [MIN]..[MAX]. It only changes that budget in `transferWithRecovery`: the budget still refills
 * whenever bytes advance, and the backoff between attempts is unchanged.
 *
 * Saved with the other download settings (SharedPreferences `vidorax-media-settings`, key `retryLimit`; no key =
 * Automatic) and read back on first use, so a download the system resumes after a reboot — before any JavaScript
 * runs — obeys it too.
 */
internal object RetryLimit {
  const val MIN = 1
  const val MAX = 10

  /** What "Automatic" means: today's budget. */
  const val AUTOMATIC = DownloadEngine.MAX_NETWORK_ATTEMPTS

  private const val PREFS = "vidorax-media-settings"
  private const val KEY = "retryLimit"

  @Volatile
  private var value: Int? = null

  /** False until the saved value was read or JavaScript set one in this process. */
  @Volatile
  private var known = false

  /** A limit JavaScript or storage gave, clamped; null (Automatic) stays null. */
  fun clamp(raw: Int?): Int? = raw?.coerceIn(MIN, MAX)

  /** The attempts a download gets for [limit]: Automatic is today's [AUTOMATIC]. */
  fun attempts(limit: Int?): Int = clamp(limit) ?: AUTOMATIC

  /** The user's limit, or null for Automatic; the saved value is read once per process. Never throws. */
  fun current(context: Context): Int? {
    if (!known) {
      synchronized(this) {
        if (!known) {
          value = runCatching { load(prefs(context)) }.getOrNull()
          known = true
        }
      }
    }
    return value
  }

  /** What JavaScript sent with `setDownloadSettings` (null = Automatic), made current and saved only when it changed. */
  @Synchronized
  fun applyFromJs(context: Context, raw: Int?) {
    val next = clamp(raw)
    val previous = current(context)
    value = next
    if (previous != next) runCatching { save(prefs(context), next) }
  }

  fun load(prefs: SharedPreferences): Int? = clamp(prefs.getInt(KEY, 0).takeIf { it > 0 })

  /** Writes [limit]; Automatic removes the key, so nothing is stored unless the user chose a limit. */
  fun save(prefs: SharedPreferences, limit: Int?) {
    val editor = prefs.edit()
    if (limit != null) editor.putInt(KEY, limit) else editor.remove(KEY)
    editor.apply()
  }

  fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Synchronized
  internal fun resetForTests() {
    value = null
    known = false
  }
}
