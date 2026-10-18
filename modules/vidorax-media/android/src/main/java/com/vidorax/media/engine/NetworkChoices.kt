package com.vidorax.media.engine

import android.content.Context
import org.json.JSONObject

/**
 * Per-download "Wi-Fi only" (#480): what a download asked for in the quality sheet's Options
 * (`EnqueueRequest.wifiOnly`). The engine waits for, and keeps to, the network this allows; a download that asked
 * nothing follows Download Settings ([DownloadSettings.wifiOnly]) exactly as before.
 *
 * Kept across restarts (SharedPreferences `vidorax_download_wifi_only`, key `byId`), because a download can resume
 * after a reboot before any JavaScript runs; downloads that no longer exist are dropped whenever one is added. No
 * table changes.
 */
internal class NetworkChoices(private val storage: Storage = Storage.memory()) {
  interface Storage {
    fun read(): String?

    /** Null removes what was stored. */
    fun write(json: String?)

    companion object {
      fun memory(): Storage = object : Storage {
        @Volatile private var value: String? = null

        override fun read(): String? = value

        override fun write(json: String?) {
          value = json
        }
      }
    }
  }

  @Volatile
  private var byId: Map<String, Boolean> = decode(runCatching { storage.read() }.getOrNull())

  /** The download's own choice; null = follow the app setting. */
  fun wifiOnly(downloadId: String): Boolean? = byId[downloadId]

  /** Remembers [wifiOnly] for [downloadId]; ids not in [live] are dropped in the same write. */
  @Synchronized
  fun put(downloadId: String, wifiOnly: Boolean, live: Collection<String>) {
    val keep = live.toSet()
    val next = byId.filterKeys { it in keep } + (downloadId to wifiOnly)
    if (next == byId) return
    byId = next
    runCatching { storage.write(encode(next)) }
  }

  private fun encode(map: Map<String, Boolean>): String? =
    if (map.isEmpty()) null else JSONObject().apply { map.forEach { (id, value) -> put(id, value) } }.toString()

  private fun decode(json: String?): Map<String, Boolean> {
    if (json.isNullOrBlank()) return emptyMap()
    return runCatching {
      val root = JSONObject(json)
      root.keys().asSequence()
        .filter { it.isNotBlank() && it.length <= MAX_ID_LENGTH }
        .mapNotNull { id -> (root.opt(id) as? Boolean)?.let { id to it } }
        .toMap()
    }.getOrDefault(emptyMap())
  }

  companion object {
    private const val MAX_ID_LENGTH = 64

    /** The rule the engine applies: the download's own choice, else the app setting. */
    fun effective(own: Boolean?, setting: Boolean): Boolean = own ?: setting
  }
}

/** SharedPreferences `vidorax_download_wifi_only`, key `byId` (JSON object id → true/false); no key = none. */
internal class SharedPreferencesNetworkChoiceStorage(context: Context) : NetworkChoices.Storage {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun read(): String? = prefs.getString(KEY, null)

  override fun write(json: String?) {
    val editor = prefs.edit()
    if (json == null) editor.remove(KEY) else editor.putString(KEY, json)
    editor.apply()
  }

  private companion object {
    const val PREFS = "vidorax_download_wifi_only"
    const val KEY = "byId"
  }
}
