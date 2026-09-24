package com.vidorax.web

import android.content.Intent

private const val CONSUMED_EXTRA = "com.vidorax.web.extra.SHARED_TEXT_CONSUMED"

/**
 * The link an intent brought into the app, at most once per intent: EXTRA_TEXT of an ACTION_SEND text/plain
 * share, or the http(s) address of an ACTION_VIEW — which is what the system sends when VidoraX is the
 * device's browser. The intent is marked as consumed so a JS reload does not open the same link again.
 */
internal fun takeSharedText(intent: Intent?): String? {
  if (intent == null) return null
  if (intent.getBooleanExtra(CONSUMED_EXTRA, false)) return null
  val text = when {
    intent.action == Intent.ACTION_SEND && intent.type?.startsWith("text/plain") == true ->
      intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    intent.action == Intent.ACTION_VIEW ->
      intent.data?.takeIf { it.scheme == "http" || it.scheme == "https" }?.toString()
    else -> null
  }
  val link = text?.takeIf { it.isNotBlank() } ?: return null
  intent.putExtra(CONSUMED_EXTRA, true)
  return link
}
