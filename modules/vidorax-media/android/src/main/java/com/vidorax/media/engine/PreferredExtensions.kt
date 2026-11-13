package com.vidorax.media.engine

import android.content.Context
import com.vidorax.media.model.Container
import org.json.JSONObject

/**
 * Custom Extension (#494): the file extension a download asked for (`EnqueueRequest.preferredExtension`, Download
 * Settings → File naming). It is used when the finished file is named — and only when it is a safe alias for the
 * container its bytes proved ([resolve]): `mp4` or `m4v` for an MP4 video, `m4a` or `mp4` for an audio-only MP4.
 * Anything else (a WebM, a TS, a QuickTime MOV, an unknown container) keeps its usual extension.
 *
 * Kept across restarts (SharedPreferences `vidorax_download_extension`, key `byId`), because a download can finish
 * after a reboot; downloads that no longer exist are dropped whenever one is added. Nothing stored = today's naming.
 */
internal class PreferredExtensions(private val storage: Storage = Storage.memory()) {
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
  private var byId: Map<String, String> = decode(runCatching { storage.read() }.getOrNull())

  fun get(downloadId: String): String? = byId[downloadId]

  /** Remembers [extension] (already [normalize]d) for [downloadId]; ids not in [live] are dropped in the same write. */
  @Synchronized
  fun put(downloadId: String, extension: String, live: Collection<String>) {
    val keep = live.toSet()
    val next = byId.filterKeys { it in keep } + (downloadId to extension)
    if (next == byId) return
    byId = next
    runCatching { storage.write(encode(next)) }
  }

  private fun encode(map: Map<String, String>): String? =
    if (map.isEmpty()) null else JSONObject().apply { map.forEach { (id, ext) -> put(id, ext) } }.toString()

  private fun decode(json: String?): Map<String, String> {
    if (json.isNullOrBlank()) return emptyMap()
    return runCatching {
      val root = JSONObject(json)
      root.keys().asSequence()
        .filter { it.isNotBlank() && it.length <= MAX_ID_LENGTH }
        .mapNotNull { id -> normalize(root.optString(id))?.let { id to it } }
        .toMap()
    }.getOrDefault(emptyMap())
  }

  companion object {
    private const val MAX_ID_LENGTH = 64

    /** The extensions a download may ask for; anything else is not a preference at all. */
    val ACCEPTED = setOf("mp4", "m4v", "m4a")

    /** `".M4V"` → `"m4v"`; null for anything not in [ACCEPTED]. */
    fun normalize(raw: String?): String? =
      raw?.trim()?.removePrefix(".")?.lowercase()?.takeIf { it in ACCEPTED }

    /**
     * The type a library file is recorded with: [base] (from its container), except that an MP4 named `.m4v` is
     * `video/x-m4v` — what Android's MediaStore and document providers pair with that name, so a gallery copy, a copy
     * to a folder or an export keeps `.m4v` instead of getting `.mp4` added.
     */
    fun libraryMimeType(file: java.io.File, base: String?): String? =
      if (base == "video/mp4" && file.extension.equals("m4v", ignoreCase = true)) "video/x-m4v" else base

    /**
     * The extension to name a finished file with: [preferred] when it is a safe alias for [container] (an MP4: `mp4`
     * or `m4v` for a video, `m4a` or `mp4` when the file has sound and no picture), else null — the usual one.
     */
    fun resolve(preferred: String?, container: Container, audioOnly: Boolean): String? {
      val wanted = normalize(preferred) ?: return null
      if (container != Container.MP4) return null
      return if (audioOnly) wanted.takeIf { it == "m4a" || it == "mp4" } else wanted.takeIf { it == "mp4" || it == "m4v" }
    }
  }
}

/** SharedPreferences `vidorax_download_extension`, key `byId` (JSON object id → extension); no key = none. */
internal class SharedPreferencesPreferredExtensionStorage(context: Context) : PreferredExtensions.Storage {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun read(): String? = prefs.getString(KEY, null)

  override fun write(json: String?) {
    val editor = prefs.edit()
    if (json == null) editor.remove(KEY) else editor.putString(KEY, json)
    editor.apply()
  }

  private companion object {
    const val PREFS = "vidorax_download_extension"
    const val KEY = "byId"
  }
}
