package com.vidorax.media.library

import android.content.ContentValues
import android.database.Cursor
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabase
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.InvalidStateException
import com.vidorax.media.NotFoundException
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.model.AdjacentItems
import com.vidorax.media.model.Container
import com.vidorax.media.model.LegacyMetadata
import com.vidorax.media.model.LibraryChange
import com.vidorax.media.model.LibraryChangeReason
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.LibraryPage
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.SiteCount
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.wireValueOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The `library` table: every finished item with its private file and thumbnail. A change is announced on [changes]
 * only after it is committed.
 */
class LibraryStore internal constructor(
  private val database: MediaDatabase,
  private val paths: StoragePaths,
) {
  private val changeFlow = MutableSharedFlow<LibraryChange>(
    extraBufferCapacity = 32,
    onBufferOverflow = BufferOverflow.DROP_OLDEST,
  )

  /** Committed changes. Listeners re-query on each one, so a slow collector losing an old change loses nothing. */
  val changes: SharedFlow<LibraryChange> = changeFlow.asSharedFlow()

  /**
   * Adds a finished item whose file (and thumbnail, when set) already sits in the private layout. [announce] false
   * lets a batch report its items in one change.
   */
  suspend fun insert(item: LibraryItem, announce: Boolean = true) {
    val values = item.toValues()
    database.transaction { db ->
      try {
        db.insertOrThrow(TABLE, null, values)
      } catch (e: SQLiteConstraintException) {
        throw InvalidStateException("Library item ${item.id} already exists")
      }
    }
    if (announce) announce(LibraryChange(LibraryChangeReason.ADDED, listOf(item.id)))
  }

  fun announce(change: LibraryChange) {
    if (change.ids.isNotEmpty()) changeFlow.tryEmit(change)
  }

  suspend fun list(query: LibraryQuery): LibraryPage = database.read { db ->
    val filter = LibrarySql.filter(query)
    val args = filter.args.toTypedArray()
    val total = DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM $TABLE ${filter.clause}", args)
    val items = db.rawQuery(
      "SELECT * FROM $TABLE ${filter.clause} ORDER BY ${LibrarySql.orderBy(query.sort)} " +
        "LIMIT ${query.limit} OFFSET ${query.offset}",
      args,
    ).use { it.readItems() }
    LibraryPage(items, total.toInt())
  }

  suspend fun get(id: String): LibraryItem? = database.read { db ->
    db.rawQuery("SELECT * FROM $TABLE WHERE id = ?", arrayOf(id)).use { it.readItems().firstOrNull() }
  }

  /** Items for [ids] that exist, in the order of [ids]. */
  suspend fun getMany(ids: List<String>): List<LibraryItem> {
    if (ids.isEmpty()) return emptyList()
    val byId = database.read { db -> selectByIds(db, ids.distinct()) }.associateBy { it.id }
    return ids.mapNotNull(byId::get)
  }

  /**
   * Like [getMany], but rejects with ERR_NOT_FOUND unless every item exists with its file on disk. An item found
   * without its file is removed first (see [removeMissingFiles]), so the refused action also repairs the library.
   */
  suspend fun requireFiles(ids: List<String>): List<LibraryItem> {
    val items = getMany(ids)
    val present = withContext(Dispatchers.IO) { items.filter { it.file.isFile } }
    if (present.size != ids.size) {
      if (present.size != items.size) runCatching { removeMissingFiles(items.map { it.id }) }
      throw NotFoundException("A library item or its file no longer exists")
    }
    return present
  }

  /** Neighbours of [id] in the order of [query] (paging ignored); both null when [id] is not in the results. */
  suspend fun adjacent(id: String, query: LibraryQuery): AdjacentItems = database.read { db ->
    val filter = LibrarySql.filter(query)
    db.rawQuery(
      "SELECT id FROM $TABLE ${filter.clause} ORDER BY ${LibrarySql.orderBy(query.sort)}",
      filter.args.toTypedArray(),
    ).use { cursor ->
      val ids = generateSequence { if (cursor.moveToNext()) cursor.getString(0) else null }
      LibrarySql.neighbours(ids.iterator(), id)
    }
  }

  /** Item count per site, largest first. */
  suspend fun siteCounts(): List<SiteCount> = database.read { db ->
    db.rawQuery("SELECT site, COUNT(*) AS n FROM $TABLE GROUP BY site ORDER BY n DESC, site ASC", null).use { cursor ->
      buildList {
        while (cursor.moveToNext()) add(SiteCount(siteOf(cursor.getString(0)), cursor.getInt(1)))
      }
    }
  }

  suspend fun totalSizeBytes(): Long = database.read { db ->
    DatabaseUtils.longForQuery(db, "SELECT COALESCE(SUM(size_bytes), 0) FROM $TABLE", null)
  }

  /** Changes the title only; the file keeps its name. */
  suspend fun rename(id: String, title: String): LibraryItem {
    val clean = Titles.validate(title)
      ?: throw InvalidRequestException("A title needs 1 to ${Titles.MAX_LENGTH} characters")
    update(id, ContentValues().apply { put("title", clean) })
    return get(id) ?: throw NotFoundException("Library item $id no longer exists")
  }

  suspend fun setFavorite(id: String, favorite: Boolean) =
    update(id, ContentValues().apply { put("favorite", if (favorite) 1 else 0) })

  /** For a thumbnail finished after the item was added. */
  suspend fun setThumbnail(id: String, thumbnail: File) =
    update(id, ContentValues().apply { put("thumb_path", paths.toStoredPath(thumbnail)) })

  suspend fun setGalleryUri(id: String, galleryUri: String, announce: Boolean = true) =
    update(id, ContentValues().apply { put("gallery_uri", galleryUri) }, announce)

  /** Fills in what the v1 catalog knew. Null fields and unknown ids are skipped. */
  suspend fun applyLegacyMetadata(entries: List<LegacyMetadata>) {
    val updated = database.transaction { db ->
      entries.mapNotNull { entry ->
        val values = entry.toValues()
        entry.id.takeIf { values.size() > 0 && db.update(TABLE, values, "id = ?", arrayOf(entry.id)) > 0 }
      }
    }
    announce(LibraryChange(LibraryChangeReason.UPDATED, updated.distinct()))
  }

  /**
   * Repairs the library after its files changed outside VidoraX: every item whose file is gone (deleted or moved
   * away) or empty is removed with its thumbnail and announced as deleted, so no screen keeps a row that promises a
   * video that cannot play. [ids] limits the check to those items; null checks the whole library. Returns the ids
   * removed. A file the engine is finishing is never affected: an item is inserted only after its file is in place.
   */
  suspend fun removeMissingFiles(ids: List<String>? = null): List<String> {
    val rows: List<Pair<String, File>> = database.read { db ->
      if (ids == null) {
        db.rawQuery("SELECT id, file_path FROM $TABLE", null).use { cursor ->
          buildList { while (cursor.moveToNext()) add(cursor.getString(0) to paths.fromStoredPath(cursor.getString(1))) }
        }
      } else {
        selectByIds(db, ids.distinct()).map { it.id to it.file }
      }
    }
    if (rows.isEmpty()) return emptyList()
    val missing = withContext(Dispatchers.IO) {
      rows.filter { (_, file) -> !file.isFile || file.length() == 0L }.map { it.first }
    }
    if (missing.isNotEmpty()) delete(missing)
    return missing
  }

  /** Removes rows, files and thumbnails. Gallery copies belong to the user and stay. Unknown ids are ignored. */
  suspend fun delete(ids: List<String>) {
    if (ids.isEmpty()) return
    val removed = database.transaction { db ->
      selectByIds(db, ids.distinct()).also { rows ->
        rows.map { it.id }.chunked(LibrarySql.MAX_BOUND_ARGS).forEach { chunk ->
          db.delete(TABLE, "id IN (${LibrarySql.placeholders(chunk.size)})", chunk.toTypedArray())
        }
      }
    }
    if (removed.isEmpty()) return
    withContext(Dispatchers.IO) {
      for (item in removed) {
        item.file.delete()
        item.thumbnail?.delete()
        // Drops the site folder once its last file is gone; File.delete() leaves non-empty folders alone.
        item.file.parentFile?.takeIf { it.parentFile == paths.libraryDir }?.delete()
      }
    }
    announce(LibraryChange(LibraryChangeReason.DELETED, removed.map { it.id }))
  }

  private suspend fun update(id: String, values: ContentValues, announce: Boolean = true) {
    val changed = database.transaction { db -> db.update(TABLE, values, "id = ?", arrayOf(id)) }
    if (changed == 0) throw NotFoundException("Library item $id does not exist")
    if (announce) announce(LibraryChange(LibraryChangeReason.UPDATED, listOf(id)))
  }

  private fun selectByIds(db: SQLiteDatabase, ids: List<String>): List<LibraryItem> =
    ids.chunked(LibrarySql.MAX_BOUND_ARGS).flatMap { chunk ->
      db.rawQuery(
        "SELECT * FROM $TABLE WHERE id IN (${LibrarySql.placeholders(chunk.size)})",
        chunk.toTypedArray(),
      ).use { it.readItems() }
    }

  private fun Cursor.readItems(): List<LibraryItem> = buildList(count) {
    while (moveToNext()) add(readItem())
  }

  private fun Cursor.readItem(): LibraryItem {
    val container = wireValueOf<Container>(text("container")) ?: Container.UNKNOWN
    val storedMime = text("mime_type")
    return readItem(container, MediaTypes.libraryMimeType(container, storedMime) ?: storedMime)
  }

  /** [mimeType] follows the file's proven container, so a MOV recorded as `video/mp4` by older builds reads right. */
  private fun Cursor.readItem(container: Container, mimeType: String) = LibraryItem(
    id = text("id"),
    title = text("title"),
    site = siteOf(text("site")),
    pageUrl = textOrNull("page_url"),
    sourceUrl = textOrNull("source_url"),
    file = paths.fromStoredPath(text("file_path")),
    mimeType = mimeType,
    container = container,
    videoCodec = textOrNull("video_codec"),
    audioCodec = textOrNull("audio_codec"),
    hasAudio = long("has_audio") != 0L,
    width = longOrNull("width")?.toInt(),
    height = longOrNull("height")?.toInt(),
    durationMs = longOrNull("duration_ms"),
    sizeBytes = long("size_bytes"),
    thumbnail = textOrNull("thumb_path")?.let(paths::fromStoredPath),
    favorite = long("favorite") != 0L,
    galleryUri = textOrNull("gallery_uri"),
    createdAt = long("created_at"),
    completedAt = long("completed_at"),
  )

  private fun LibraryItem.toValues() = ContentValues().apply {
    put("id", id)
    put("title", title)
    put("site", site.wire)
    put("page_url", pageUrl)
    put("source_url", sourceUrl)
    put("file_path", paths.toStoredPath(file))
    put("mime_type", mimeType)
    put("container", container.wire)
    put("video_codec", videoCodec)
    put("audio_codec", audioCodec)
    put("has_audio", if (hasAudio) 1 else 0)
    put("width", width)
    put("height", height)
    put("duration_ms", durationMs)
    put("size_bytes", sizeBytes)
    put("thumb_path", thumbnail?.let(paths::toStoredPath))
    put("favorite", if (favorite) 1 else 0)
    put("gallery_uri", galleryUri)
    put("created_at", createdAt)
    put("completed_at", completedAt)
  }

  private fun LegacyMetadata.toValues() = ContentValues().apply {
    title?.let { put("title", Titles.clamp(it)) }
    site?.let { put("site", it.wire) }
    pageUrl?.let { put("page_url", it) }
    favorite?.let { put("favorite", if (it) 1 else 0) }
  }

  private companion object {
    const val TABLE = "library"
  }
}

private fun siteOf(wire: String): SiteId = wireValueOf<SiteId>(wire) ?: SiteId.WEB

private fun Cursor.text(column: String): String = getString(getColumnIndexOrThrow(column))

private fun Cursor.textOrNull(column: String): String? =
  getColumnIndexOrThrow(column).let { if (isNull(it)) null else getString(it) }

private fun Cursor.long(column: String): Long = getLong(getColumnIndexOrThrow(column))

private fun Cursor.longOrNull(column: String): Long? =
  getColumnIndexOrThrow(column).let { if (isNull(it)) null else getLong(it) }
