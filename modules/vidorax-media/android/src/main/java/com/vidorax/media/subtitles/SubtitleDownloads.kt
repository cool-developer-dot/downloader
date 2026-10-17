package com.vidorax.media.subtitles

import android.content.Context
import com.vidorax.media.MediaServices
import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.engine.DownloadRow
import com.vidorax.media.engine.SqliteDownloadStore
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.LibraryChangeReason
import com.vidorax.media.net.HttpClient
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/** H19: what is known about one download's subtitles. Never a URL. */
data class SubtitleRecord(
  val trackIds: List<String>,
  val state: State,
  val files: List<SavedSubtitle>,
  val failed: Int,
  /** [SubtitleFetcher] note code, for Download Details. */
  val note: String?,
) {
  enum class State(val wire: String) { PENDING("pending"), DONE("done"), FAILED("failed") }
}

/** A subtitle file beside its video ([path] relative to the app's files folder). */
data class SavedSubtitle(val language: String?, val name: String?, val path: String, val bytes: Long)

/** SharedPreferences `vidorax_subtitles`: one JSON record per download id. */
internal class SubtitleStore(private val read: (String) -> String?, private val write: (String, String?) -> Unit, private val keys: () -> Set<String>) {
  fun get(id: String): SubtitleRecord? = read(KEY_PREFIX + id)?.let(::decode)

  fun put(id: String, record: SubtitleRecord?) = write(KEY_PREFIX + id, record?.let(::encode))

  fun ids(): List<String> = keys().filter { it.startsWith(KEY_PREFIX) }.map { it.removePrefix(KEY_PREFIX) }

  private fun encode(record: SubtitleRecord): String = JSONObject()
    .put("ids", JSONArray(record.trackIds))
    .put("state", record.state.wire)
    .put(
      "files",
      JSONArray(
        record.files.map { file ->
          JSONObject().put("language", file.language).put("name", file.name).put("path", file.path).put("bytes", file.bytes)
        },
      ),
    )
    .put("failed", record.failed)
    .put("note", record.note)
    .toString()

  private fun decode(json: String): SubtitleRecord? = runCatching {
    val root = JSONObject(json)
    val ids = root.optJSONArray("ids") ?: JSONArray()
    val files = root.optJSONArray("files") ?: JSONArray()
    SubtitleRecord(
      trackIds = (0 until ids.length()).map { ids.getString(it) },
      state = SubtitleRecord.State.entries.firstOrNull { it.wire == root.optString("state") } ?: SubtitleRecord.State.PENDING,
      files = (0 until files.length()).map { index ->
        val file = files.getJSONObject(index)
        SavedSubtitle(
          language = file.optString("language").takeIf { file.has("language") && !file.isNull("language") },
          name = file.optString("name").takeIf { file.has("name") && !file.isNull("name") },
          path = file.getString("path"),
          bytes = file.optLong("bytes"),
        )
      },
      failed = root.optInt("failed"),
      note = root.optString("note").takeIf { root.has("note") && !root.isNull("note") },
    )
  }.getOrNull()

  companion object {
    private const val PREFS = "vidorax_subtitles"
    private const val KEY_PREFIX = "dl:"

    fun of(context: Context): SubtitleStore {
      val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return SubtitleStore(
        read = { prefs.getString(it, null) },
        write = { key, value -> prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply() },
        keys = { prefs.all.keys },
      )
    }

    fun inMemory(): SubtitleStore {
      val map = java.util.concurrent.ConcurrentHashMap<String, String>()
      return SubtitleStore(read = { map[it] }, write = { key, value -> if (value == null) map.remove(key) else map[key] = value }, keys = { map.keys.toSet() })
    }
  }
}

/**
 * H19 Subtitles: after a v2 download COMPLETED (verified), the subtitle tracks the user chose for it are fetched and
 * written beside the video. A subtitle failure is a note, never a failed video. The files go with their video when it
 * is deleted. Nothing chosen (the default: the setting is off) = nothing happens.
 */
internal class SubtitleDownloads(
  private val store: SubtitleStore,
  private val fetcher: SubtitleFetcher,
  /** The download's row: its source, kind and request details (headers, cookie choice). */
  private val downloadRow: suspend (String) -> DownloadRow?,
  /** The finished video of a download (its library item's file); null until it completed. */
  private val videoFile: suspend (String) -> File?,
  private val paths: StoragePaths,
  private val scope: CoroutineScope,
) {
  /** Records are only read and written under it. */
  private val lock = Mutex()

  suspend fun record(id: String): SubtitleRecord? = lock.withLock { store.get(id) }

  /** The subtitle tracks the stream offers right now (for the choice JavaScript makes when it enqueues). */
  suspend fun tracks(url: String, kind: com.vidorax.media.model.SourceKind?, context: com.vidorax.media.model.RequestContext): List<SubtitleTrack> =
    fetcher.list(url, kind, context)

  /** The tracks the user chose for [downloadId]; fetched now when the video already completed. */
  suspend fun choose(downloadId: String, trackIds: List<String>) {
    val ids = trackIds.filter { it.isNotBlank() && it.length <= MAX_TRACK_ID_LENGTH }.distinct().take(MAX_TRACKS)
    lock.withLock {
      if (ids.isEmpty()) {
        store.get(downloadId)?.takeIf { it.state == SubtitleRecord.State.PENDING }?.let { store.put(downloadId, null) }
        return
      }
      if (store.get(downloadId)?.state == SubtitleRecord.State.DONE) return
      store.put(downloadId, SubtitleRecord(ids, SubtitleRecord.State.PENDING, emptyList(), 0, null))
    }
    if (downloadRow(downloadId)?.state == DownloadState.COMPLETED) fetchPending(downloadId)
  }

  /** Downloads whose subtitles are being fetched right now (guarded by [lock]). */
  private val inFlight = HashSet<String>()

  /**
   * Fetches [downloadId]'s chosen subtitles if they are still pending and its video is there. The network work runs
   * outside [lock]; a record that changed meanwhile (the video was deleted, the choice changed) is not overwritten,
   * and files written for it are removed again.
   */
  suspend fun fetchPending(downloadId: String) {
    val record = lock.withLock {
      val pending = store.get(downloadId)?.takeIf { it.state == SubtitleRecord.State.PENDING } ?: return
      if (!inFlight.add(downloadId)) return
      pending
    }
    try {
      val row = downloadRow(downloadId)
      val video = videoFile(downloadId)
      if (row == null || video == null || !video.isFile) {
        // Nothing to put subtitles beside: a download that is gone or was cancelled forgets its choice; one that may
        // still complete (queued, failed and retried later) keeps it.
        if (row == null || row.state == DownloadState.CANCELLED) {
          lock.withLock { if (store.get(downloadId) == record) store.put(downloadId, null) }
        }
        return
      }
      val outcome = fetcher.fetch(row.url, row.kind, row.request, record.trackIds, video)
      lock.withLock {
        if (store.get(downloadId) != record) {
          outcome.written.forEach { runCatching { it.file.delete() } }
          return@withLock
        }
        val files = outcome.written.map {
          SavedSubtitle(it.track.language, it.track.name, paths.toStoredPath(it.file), it.file.length())
        }
        val state = if (files.isEmpty()) SubtitleRecord.State.FAILED else SubtitleRecord.State.DONE
        store.put(downloadId, record.copy(state = state, files = files, failed = outcome.failed, note = outcome.note))
      }
    } finally {
      lock.withLock { inFlight.remove(downloadId) }
    }
  }

  /** At start-up: chosen subtitles of downloads that completed while nothing fetched them. */
  suspend fun fetchAllPending() {
    for (id in store.ids()) {
      if (store.get(id)?.state == SubtitleRecord.State.PENDING) fetchPending(id)
    }
  }

  /**
   * At start-up: saved subtitles whose video is gone (deleted while nothing listened for it) are deleted too. A record
   * still waiting for its video is left alone.
   */
  suspend fun pruneOrphans() {
    val orphans = store.ids().filter { id ->
      store.get(id)?.state != SubtitleRecord.State.PENDING && videoFile(id)?.isFile != true
    }
    if (orphans.isNotEmpty()) forget(orphans)
  }

  /** A deleted video's subtitle files and record go with it. */
  suspend fun forget(ids: List<String>) {
    lock.withLock {
      for (id in ids) {
        val record = store.get(id) ?: continue
        for (saved in record.files) {
          val file = paths.fromStoredPath(saved.path)
          runCatching { file.delete() }
          // The video's site folder goes once nothing is left in it (the library leaves non-empty folders).
          file.parentFile?.takeIf { it.parentFile == paths.libraryDir && it.listFiles().isNullOrEmpty() }?.delete()
        }
        store.put(id, null)
      }
    }
  }

  /** The subtitle file [index] of [downloadId], or null. */
  suspend fun file(downloadId: String, index: Int): File? =
    record(downloadId)?.files?.getOrNull(index)?.let { paths.fromStoredPath(it.path) }?.takeIf { it.isFile }

  fun attach(engine: DownloadEngineApi, libraryChanges: kotlinx.coroutines.flow.Flow<com.vidorax.media.model.LibraryChange>) {
    scope.launch {
      engine.stateChanges.collect { if (it.state == DownloadState.COMPLETED) runCatching { fetchPending(it.id) } }
    }
    scope.launch {
      libraryChanges.collect { if (it.reason == LibraryChangeReason.DELETED) runCatching { forget(it.ids) } }
    }
    scope.launch {
      runCatching { pruneOrphans() }
      runCatching { fetchAllPending() }
    }
  }

  companion object {
    const val MAX_TRACKS = 20
    const val MAX_TRACK_ID_LENGTH = 300

    @Volatile
    private var instance: SubtitleDownloads? = null

    /** Built once with the engine (DownloadEngineProvider); null before that. */
    fun current(): SubtitleDownloads? = instance

    /** The instance, after [buildEngine] made sure the engine (and with it this) exists. */
    fun require(buildEngine: () -> Any): SubtitleDownloads {
      buildEngine()
      return instance ?: throw IllegalStateException("Subtitles are not available")
    }

    fun install(context: Context, engine: DownloadEngineApi, services: MediaServices) {
      if (instance != null) return
      val store = SqliteDownloadStore(services.database)
      val downloads = SubtitleDownloads(
        store = SubtitleStore.of(context),
        fetcher = SubtitleFetcher(HttpClient.create()),
        downloadRow = { store.find(it) },
        videoFile = { services.library.get(it)?.file },
        paths = services.paths,
        scope = services.scope,
      )
      instance = downloads
      downloads.attach(engine, services.library.changes)
    }

    internal fun resetForTests() {
      instance = null
    }
  }
}
