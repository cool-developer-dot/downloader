package com.vidorax.media.runner

import android.content.Context

/**
 * How finished/failed download notifications alert (Notification Sound #452, Vibrate #453, Silent Mode #457).
 * Progress notifications are never affected.
 *
 * The defaults (sound on, vibration off, not silent) are exactly today's behaviour: they use the existing
 * [DownloadNotifications.CHANNEL_STATUS] channel unchanged — that channel plays the default sound and never enabled
 * vibration — and on Android 7.x the builder is left as it was. Android fixes a channel's sound and vibration when
 * it is created, so every other combination gets a channel of its own; existing channel ids are never changed.
 * Silent overrides sound and vibration.
 *
 * Saved in SharedPreferences (written when JavaScript pushes the download settings), so a notification posted by
 * the background runner or the boot job — while no JavaScript runs — follows the user's choice too.
 */
data class NotificationOptions(
  val sound: Boolean = true,
  val vibrate: Boolean = false,
  val silent: Boolean = false,
) {
  /** What the notification actually does: Silent wins over the other two. */
  val playsSound: Boolean get() = sound && !silent
  val vibrates: Boolean get() = vibrate && !silent

  val isDefault: Boolean get() = playsSound == DEFAULT.playsSound && vibrates == DEFAULT.vibrates

  companion object {
    val DEFAULT = NotificationOptions()

    private const val PREFS = "vidorax_notification_options"
    private const val KEY_SOUND = "sound"
    private const val KEY_VIBRATE = "vibrate"
    private const val KEY_SILENT = "silent"

    /** The status channel for these options. Pure. */
    fun statusChannelFor(options: NotificationOptions): StatusChannel = when {
      options.playsSound && !options.vibrates -> StatusChannel.EXISTING
      options.playsSound && options.vibrates -> StatusChannel.SOUND_VIBRATE
      !options.playsSound && options.vibrates -> StatusChannel.VIBRATE_ONLY
      else -> StatusChannel.QUIET
    }

    /**
     * Options pushed from JavaScript: a field it did not send keeps the saved value, so an older JavaScript bundle
     * (which sends none) never changes anything.
     */
    fun merged(saved: NotificationOptions, sound: Boolean?, vibrate: Boolean?, silent: Boolean?): NotificationOptions =
      NotificationOptions(
        sound = sound ?: saved.sound,
        vibrate = vibrate ?: saved.vibrate,
        silent = silent ?: saved.silent,
      )

    fun load(context: Context): NotificationOptions = runCatching {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      NotificationOptions(
        sound = prefs.getBoolean(KEY_SOUND, DEFAULT.sound),
        vibrate = prefs.getBoolean(KEY_VIBRATE, DEFAULT.vibrate),
        silent = prefs.getBoolean(KEY_SILENT, DEFAULT.silent),
      )
    }.getOrDefault(DEFAULT)

    fun save(context: Context, options: NotificationOptions) {
      runCatching {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
          .putBoolean(KEY_SOUND, options.sound)
          .putBoolean(KEY_VIBRATE, options.vibrate)
          .putBoolean(KEY_SILENT, options.silent)
          .apply()
      }
    }

    /** Saves the fields JavaScript sent; does nothing when it sent none. */
    fun saveFromJs(context: Context, sound: Boolean?, vibrate: Boolean?, silent: Boolean?) {
      if (sound == null && vibrate == null && silent == null) return
      save(context, merged(load(context), sound, vibrate, silent))
    }
  }
}

/** One finished/failed-download channel per alert combination. [EXISTING] is today's channel, untouched. */
enum class StatusChannel(
  val id: String,
  val channelName: String,
  val playsSound: Boolean,
  val vibrates: Boolean,
) {
  EXISTING(DownloadNotifications.CHANNEL_STATUS, "Finished downloads", playsSound = true, vibrates = false),
  SOUND_VIBRATE("vidorax_downloads_status_sound_vibrate", "Finished downloads (sound and vibration)", true, true),
  VIBRATE_ONLY("vidorax_downloads_status_vibrate", "Finished downloads (vibration only)", false, true),
  QUIET("vidorax_downloads_status_silent", "Finished downloads (silent)", false, false),
}
