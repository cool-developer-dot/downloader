package com.vidorax.media.cast

import android.content.Context
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions

/**
 * P13 #667: the Cast SDK's options, named in this module's AndroidManifest.xml (`OPTIONS_PROVIDER_CLASS_NAME`).
 *
 * - The receiver is Google's Default Media Receiver: no receiver app of our own, no Cast developer account.
 * - The Cast SDK's own media notification, lock-screen controls and media session are off: the phone's Player stays
 *   the one control surface (its controls drive the TV), and the app's media session is left as it is.
 * - No reconnection service and no saved-session resume: a cast ends with the app, and a new one starts only from
 *   the Player's Cast button.
 */
class CastOptionsProvider : OptionsProvider {
  override fun getCastOptions(context: Context): CastOptions =
    CastOptions.Builder()
      .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
      .setCastMediaOptions(
        CastMediaOptions.Builder()
          .setNotificationOptions(null)
          .setMediaSessionEnabled(false)
          .build(),
      )
      .setEnableReconnectionService(false)
      .setResumeSavedSession(false)
      .setStopReceiverApplicationWhenEndingSession(true)
      .build()

  override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
