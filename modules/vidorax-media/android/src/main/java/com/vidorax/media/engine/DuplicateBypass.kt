package com.vidorax.media.engine

import android.content.Context
import org.json.JSONArray

/**
 * H12 (Duplicate Action #386): downloads the user started although they already have the video — "Keep both", or the
 * new copy of "Replace" — through `EnqueueRequest.allowDuplicate`. Such a download skips the identity check when it is
 * created and the same-bytes check when it is finalized (also when a restart repairs it), so it becomes its own library
 * item. Every other download is checked exactly as before.
 *
 * Kept across restarts (SharedPreferences `vidorax_duplicate_bypass`, key `ids`), because a download can finish after
 * a reboot; ids of downloads that no longer exist are dropped whenever one is added. Nothing stored = nothing bypassed.
 */
internal class DuplicateBypass(private val storage: Storage = Storage.memory()) {
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
  private var ids: Set<String> = decode(runCatching { storage.read() }.getOrNull())

  fun contains(downloadId: String): Boolean = downloadId in ids

  /** Marks [downloadId]; ids not in [live] (finished long ago, removed) are dropped in the same write. */
  @Synchronized
  fun add(downloadId: String, live: Collection<String>) {
    val keep = live.toSet()
    val next = (ids.filter { it in keep } + downloadId).toSet()
    if (next == ids) return
    ids = next
    runCatching { storage.write(encode(next)) }
  }

  internal fun all(): Set<String> = ids

  private fun encode(set: Set<String>): String? = if (set.isEmpty()) null else JSONArray(set.toList()).toString()

  private fun decode(json: String?): Set<String> {
    if (json.isNullOrBlank()) return emptySet()
    return runCatching {
      val array = JSONArray(json)
      (0 until array.length()).mapNotNull { array.optString(it).takeIf { id -> id.isNotBlank() && id.length <= MAX_ID_LENGTH } }.toSet()
    }.getOrDefault(emptySet())
  }

  private companion object {
    const val MAX_ID_LENGTH = 64
  }
}

/** SharedPreferences `vidorax_duplicate_bypass`, key `ids` (JSON array); no key = nothing bypassed. */
internal class SharedPreferencesDuplicateBypassStorage(context: Context) : DuplicateBypass.Storage {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun read(): String? = prefs.getString(KEY, null)

  override fun write(json: String?) {
    val editor = prefs.edit()
    if (json == null) editor.remove(KEY) else editor.putString(KEY, json)
    editor.apply()
  }

  private companion object {
    const val PREFS = "vidorax_duplicate_bypass"
    const val KEY = "ids"
  }
}
