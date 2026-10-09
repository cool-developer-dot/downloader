package com.vidorax.media.engine

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.model.wireValueOf
import com.vidorax.media.net.Redact
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

/** A genuine completion waiting for JavaScript to count it (see [DownloadStore.listCompletions]). */
data class CompletionRecord(val downloadId: String, val completedAt: Long)

/** COMPLETED/FAILED/CANCELLED: no worker may leave or overwrite one of these. */
internal val DownloadState.isTerminal: Boolean
  get() = this == DownloadState.COMPLETED || this == DownloadState.FAILED || this == DownloadState.CANCELLED

/** Headers that must never be written to disk, even though the bridge already strips Cookie. */
private val SECRET_HEADERS = setOf("cookie", "authorization", "proxy-authorization")

/**
 * A persisted `downloads` row. `variant_json` holds an HLS or DASH choice; `audio_url` the audio file of a split
 * download (the legacy manifest column stays NULL).
 */
internal data class DownloadRow(
  val id: String,
  val state: DownloadState,
  val kind: SourceKind,
  val url: String,
  /** Already sanitized of secret headers before it reaches here. */
  val request: RequestContext,
  val title: String,
  val site: SiteId,
  val pageUrl: String?,
  val thumbnailUrl: String?,
  val qualityLabel: String?,
  val bytesDone: Long,
  val totalBytes: Long?,
  val errorCode: DownloadErrorCode?,
  val errorMessage: String?,
  val attempts: Int,
  val saveToGallery: Boolean?,
  val createdAt: Long,
  val updatedAt: Long,
  /** The finalized library file, stored relative to filesDir, once the destination is chosen; null until then.
   *  Persisted before the physical move so a crash mid-finalize is recoverable at startup. */
  val filePath: String? = null,
  /** HLS only: which variant to download, so a resumed or restarted download selects the same one. */
  val variant: VariantChoice? = null,
  /** Hashed identity of the video (DownloadIdentity): one live download per video. Null for pre-v4 rows until restore. */
  val identityKey: String? = null,
  /** [SourceKind.SPLIT] only: the audio file merged with the video file [url]. */
  val audioUrl: String? = null,
) {
  /** The public record: libraryItemId equals id once completed (docs/VidoraMedia.types.ts). */
  fun toRecord(): DownloadRecord = DownloadRecord(
    id = id,
    state = state,
    title = title,
    site = site,
    kind = kind,
    pageUrl = pageUrl,
    thumbnailUrl = thumbnailUrl,
    qualityLabel = qualityLabel,
    bytesDone = bytesDone,
    totalBytes = totalBytes,
    errorCode = errorCode,
    errorMessage = errorMessage,
    attempts = attempts,
    libraryItemId = if (state == DownloadState.COMPLETED) id else null,
    createdAt = createdAt,
    updatedAt = updatedAt,
  )
}

/** Persistence of the `downloads` table. The engine serializes access; this only does CRUD. */
internal interface DownloadStore {
  suspend fun create(row: DownloadRow)

  suspend fun find(id: String): DownloadRow?

  suspend fun save(row: DownloadRow)

  /**
   * Saves a row that just reached COMPLETED and records the completion in the outbox JavaScript reads
   * ([listCompletions]) — one transaction, so neither can exist without the other.
   */
  suspend fun saveCompleted(row: DownloadRow)

  /** Completions not yet acknowledged, oldest first. */
  suspend fun listCompletions(): List<CompletionRecord>

  /** Forgets completions JavaScript has counted. */
  suspend fun acknowledgeCompletions(ids: List<String>)

  /** Non-completed rows plus rows completed within the last 24 h (by updatedAt), newest first. */
  suspend fun list(now: Long): List<DownloadRow>

  suspend fun delete(id: String)
}

/** The real SQLite-backed store. Request context is JSON in `request_json`, stripped of secrets on the way in. */
internal class SqliteDownloadStore(private val database: MediaDatabase) : DownloadStore {
  override suspend fun create(row: DownloadRow) {
    database.transaction { db -> db.insertOrThrow(TABLE, null, row.toValues()) }
  }

  override suspend fun find(id: String): DownloadRow? = database.read { db ->
    db.rawQuery("SELECT * FROM $TABLE WHERE id = ?", arrayOf(id)).use { it.readRows().firstOrNull() }
  }

  override suspend fun save(row: DownloadRow) {
    database.transaction { db -> db.update(TABLE, row.toValues(), "id = ?", arrayOf(row.id)) }
  }

  override suspend fun saveCompleted(row: DownloadRow) {
    database.transaction { db ->
      db.update(TABLE, row.toValues(), "id = ?", arrayOf(row.id))
      db.insertWithOnConflict(
        COMPLETIONS,
        null,
        ContentValues().apply {
          put("download_id", row.id)
          put("completed_at", row.updatedAt)
        },
        SQLiteDatabase.CONFLICT_IGNORE,
      )
      // Bounded even if JavaScript never acknowledges (it normally does at every start and foreground).
      db.execSQL(
        "DELETE FROM $COMPLETIONS WHERE download_id NOT IN " +
          "(SELECT download_id FROM $COMPLETIONS ORDER BY completed_at DESC LIMIT $MAX_UNACKNOWLEDGED)",
      )
    }
  }

  override suspend fun listCompletions(): List<CompletionRecord> = database.read { db ->
    db.rawQuery("SELECT download_id, completed_at FROM $COMPLETIONS ORDER BY completed_at ASC", null).use { cursor ->
      buildList(cursor.count) {
        while (cursor.moveToNext()) add(CompletionRecord(cursor.getString(0), cursor.getLong(1)))
      }
    }
  }

  override suspend fun acknowledgeCompletions(ids: List<String>) {
    if (ids.isEmpty()) return
    database.transaction { db ->
      for (chunk in ids.distinct().chunked(200)) {
        val marks = chunk.joinToString(",") { "?" }
        db.delete(COMPLETIONS, "download_id IN ($marks)", chunk.toTypedArray())
      }
    }
  }

  override suspend fun list(now: Long): List<DownloadRow> = database.read { db ->
    val keepCompletedAfter = now - COMPLETED_RETENTION_MS
    db.rawQuery(
      "SELECT * FROM $TABLE WHERE state != ? OR updated_at >= ? ORDER BY created_at DESC",
      arrayOf(DownloadState.COMPLETED.wire, keepCompletedAfter.toString()),
    ).use { it.readRows() }
  }

  override suspend fun delete(id: String) {
    database.transaction { db -> db.delete(TABLE, "id = ?", arrayOf(id)) }
  }

  private fun DownloadRow.toValues() = ContentValues().apply {
    put("id", id)
    put("state", state.wire)
    put("kind", kind.wire)
    put("url", url)
    put("request_json", RequestContextJson.encode(request))
    put("title", title)
    put("site", site.wire)
    put("page_url", pageUrl)
    put("thumbnail_url", thumbnailUrl)
    put("quality_label", qualityLabel)
    put("bytes_done", bytesDone)
    put("total_bytes", totalBytes)
    put("error_code", errorCode?.wire)
    put("error_message", errorMessage)
    put("attempts", attempts)
    put("save_to_gallery", saveToGallery?.let { if (it) 1 else 0 })
    put("created_at", createdAt)
    put("updated_at", updatedAt)
    put("file_path", filePath)
    put("variant_json", variant?.let { VariantChoiceJson.encode(it) })
    put("identity_key", identityKey)
    put("audio_url", audioUrl)
  }

  private fun Cursor.readRows(): List<DownloadRow> = buildList(count) {
    while (moveToNext()) add(readRow())
  }

  private fun Cursor.readRow() = DownloadRow(
    id = text("id"),
    state = wireValueOf<DownloadState>(text("state")) ?: DownloadState.FAILED,
    kind = wireValueOf<SourceKind>(text("kind")) ?: SourceKind.PROGRESSIVE,
    url = text("url"),
    request = RequestContextJson.decode(textOrNull("request_json")),
    title = text("title"),
    site = wireValueOf<SiteId>(text("site")) ?: SiteId.WEB,
    pageUrl = textOrNull("page_url"),
    thumbnailUrl = textOrNull("thumbnail_url"),
    qualityLabel = textOrNull("quality_label"),
    bytesDone = long("bytes_done"),
    totalBytes = longOrNull("total_bytes"),
    errorCode = textOrNull("error_code")?.let { wireValueOf<DownloadErrorCode>(it) },
    errorMessage = textOrNull("error_message"),
    attempts = long("attempts").toInt(),
    saveToGallery = longOrNull("save_to_gallery")?.let { it != 0L },
    createdAt = long("created_at"),
    updatedAt = long("updated_at"),
    filePath = textOrNull("file_path"),
    variant = VariantChoiceJson.decode(textOrNull("variant_json")),
    identityKey = textOrNull("identity_key"),
    audioUrl = textOrNull("audio_url"),
  )

  private companion object {
    const val TABLE = "downloads"
    const val COMPLETIONS = "completions"
    const val MAX_UNACKNOWLEDGED = 500
    const val COMPLETED_RETENTION_MS = 24L * 60 * 60 * 1000
  }
}

/** JSON form of a [RequestContext] for `request_json`; secret headers are dropped defensively on encode. */
internal object RequestContextJson {
  fun encode(context: RequestContext): String {
    val json = JSONObject()
    context.userAgent?.let { json.put("userAgent", it) }
    context.referer?.let { json.put("referer", it) }
    context.origin?.let { json.put("origin", it) }
    json.put("useCookies", context.useCookies)
    val headers = JSONObject()
    for ((name, value) in context.headers) {
      if (name.lowercase() !in SECRET_HEADERS) headers.put(name, value)
    }
    if (headers.length() > 0) json.put("headers", headers)
    return json.toString()
  }

  fun decode(raw: String?): RequestContext {
    if (raw.isNullOrBlank()) return RequestContext(null, null, null, emptyMap(), useCookies = false)
    val json = JSONObject(raw)
    val headers = mutableMapOf<String, String>()
    json.optJSONObject("headers")?.let { obj ->
      for (key in obj.keys()) {
        if (key.lowercase() !in SECRET_HEADERS) headers[key] = obj.getString(key)
      }
    }
    return RequestContext(
      userAgent = json.optString("userAgent").ifBlank { null },
      referer = json.optString("referer").ifBlank { null },
      origin = json.optString("origin").ifBlank { null },
      headers = headers,
      useCookies = json.optBoolean("useCookies", false),
    )
  }
}

/**
 * JSON form of an HLS or DASH [VariantChoice] for `variant_json`. An HLS variant id is a playlist URL: only its
 * scheme://host/path is kept (enough to re-select it from a refreshed playlist), never a signed query. A DASH
 * variant id is the manifest's representation id, kept as the manifest names it (bounded).
 */
internal object VariantChoiceJson {
  private const val MAX_REPRESENTATION_ID = 256

  fun encode(choice: VariantChoice): String {
    val json = JSONObject()
    choice.videoId?.let { json.put("videoId", persistedId(it)) }
    choice.audioId?.let { json.put("audioId", persistedId(it)) }
    choice.maxHeight?.let { json.put("maxHeight", it) }
    return json.toString()
  }

  private fun persistedId(id: String): String =
    if (id.toHttpUrlOrNull() != null) Redact.url(id) else id.take(MAX_REPRESENTATION_ID)

  fun decode(raw: String?): VariantChoice? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
      val json = JSONObject(raw)
      VariantChoice(
        videoId = json.optString("videoId").ifBlank { null },
        audioId = json.optString("audioId").ifBlank { null },
        maxHeight = if (json.has("maxHeight")) json.getInt("maxHeight") else null,
      )
    }.getOrNull()
  }
}

private fun Cursor.text(column: String): String = getString(getColumnIndexOrThrow(column))

private fun Cursor.textOrNull(column: String): String? =
  getColumnIndexOrThrow(column).let { if (isNull(it)) null else getString(it) }

private fun Cursor.long(column: String): Long = getLong(getColumnIndexOrThrow(column))

private fun Cursor.longOrNull(column: String): Long? =
  getColumnIndexOrThrow(column).let { if (isNull(it)) null else getLong(it) }
