package com.vidorax.web.voice

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.speech.RecognizerIntent
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

/**
 * #31 Voice Search / #282 Voice Commands: Android's own voice input screen (RecognizerIntent) turns what the user says
 * into text; VidoraX then treats it like a typed search or address. No microphone permission: the system screen
 * (Google's or the phone maker's) listens, never VidoraX, and only the words come back.
 */
internal class VoiceSearchContract : AppContextActivityResultContract<VoiceSearchContract.Request, String?> {
  /** [language]: a BCP 47 tag such as `ur-PK`, or null for the phone's own voice language. */
  class Request(val language: String?) : Serializable

  override fun createIntent(context: Context, input: Request): Intent = VoiceSearch.intent(input.language)

  override fun parseResult(input: Request, resultCode: Int, intent: Intent?): String? =
    if (resultCode == Activity.RESULT_OK) VoiceSearch.firstTranscript(intent?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)) else null
}

internal object VoiceSearch {
  fun intent(language: String?): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      if (!language.isNullOrBlank()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
    }

  /** Whether this phone has a voice input screen at all (declared in `<queries>`, so Android 11+ can see it). */
  fun isAvailable(context: Context): Boolean =
    runCatching { context.packageManager.queryIntentActivities(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0).isNotEmpty() }
      .getOrDefault(false)

  /** The best transcript, trimmed; null when nothing usable was heard. */
  fun firstTranscript(results: List<String?>?): String? =
    results?.firstNotNullOfOrNull { it?.trim()?.takeIf { text -> text.isNotEmpty() } }?.take(MAX_LENGTH)

  private const val MAX_LENGTH = 2_000
}
