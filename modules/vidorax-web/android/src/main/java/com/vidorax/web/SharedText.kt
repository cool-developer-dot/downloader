package com.vidorax.web

import android.content.Intent

private const val CONSUMED_EXTRA = "com.vidorax.web.extra.SHARED_TEXT_CONSUMED"

/**
 * EXTRA_TEXT of an ACTION_SEND text/plain intent (a link shared from another app), at most once per intent. The intent
 * is marked as consumed so a JS reload does not open the same link again.
 */
internal fun takeSharedText(intent: Intent?): String? {
  if (intent == null || intent.action != Intent.ACTION_SEND || intent.type?.startsWith("text/plain") != true) {
    return null
  }
  if (intent.getBooleanExtra(CONSUMED_EXTRA, false)) {
    return null
  }
  val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() } ?: return null
  intent.putExtra(CONSUMED_EXTRA, true)
  return text
}
