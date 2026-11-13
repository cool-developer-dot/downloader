package com.vidorax.media.runner

import android.content.Context
import com.vidorax.media.InvalidRequestException

/**
 * H6 (#422): the system notification for a crossed data limit, posted on the finished-downloads channel through
 * [DownloadNotifications.showNotice]. JavaScript decides when a limit is crossed and sends the translated text; one
 * notification per period, so crossing it again replaces the earlier one. Tapping it opens Data usage.
 */
internal object DataLimitNotice {
  /** Below the per-download range and apart from the runner's summary (see DownloadNotificationContent). */
  const val DAY_NOTIFICATION_ID = 0x5640
  const val MONTH_NOTIFICATION_ID = 0x5641
  const val DEEP_LINK = "vidorax://data-usage"
  const val MAX_TITLE = 120
  const val MAX_TEXT = 400

  fun notificationIdFor(period: String): Int? = when (period) {
    "day" -> DAY_NOTIFICATION_ID
    "month" -> MONTH_NOTIFICATION_ID
    else -> null
  }

  /** The texts as posted: control characters removed, trimmed and bounded. Null when the title is empty. */
  fun clean(title: String, text: String): Pair<String, String>? {
    val cleanTitle = title.filterNot { it.isISOControl() }.trim().take(MAX_TITLE)
    if (cleanTitle.isEmpty()) return null
    return cleanTitle to text.filterNot { it.isISOControl() }.trim().take(MAX_TEXT)
  }

  /** True when posted; false without the notification permission (or with notifications turned off for VidoraX). */
  fun show(context: Context, period: String, title: String, text: String): Boolean {
    val id = notificationIdFor(period) ?: throw InvalidRequestException("Unknown data limit period")
    val (cleanTitle, cleanText) = clean(title, text) ?: throw InvalidRequestException("A data limit notice needs a title")
    return DownloadNotifications(context.applicationContext).showNotice(id, cleanTitle, cleanText, DEEP_LINK)
  }
}
