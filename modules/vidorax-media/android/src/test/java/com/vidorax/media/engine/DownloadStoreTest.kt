package com.vidorax.media.engine

import android.database.sqlite.SQLiteDatabase
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.library.LibraryStore
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class DownloadStoreTest {
  private val context = RuntimeEnvironment.getApplication()
  private lateinit var database: MediaDatabase
  private lateinit var store: SqliteDownloadStore

  @Before fun setUp() {
    database = MediaDatabase(context)
    store = SqliteDownloadStore(database)
  }

  @After fun tearDown() {
    database.close()
    File(context.noBackupFilesDir, MediaDatabase.NAME).delete()
  }

  private fun row(
    id: String,
    state: DownloadState,
    updatedAt: Long = 1_000L,
    headers: Map<String, String> = emptyMap(),
  ) = DownloadRow(
    id = id,
    state = state,
    kind = SourceKind.PROGRESSIVE,
    url = "https://cdn.example/$id.mp4",
    request = RequestContext("UA", "https://page", "https://page", headers, useCookies = true),
    title = "Clip $id",
    site = SiteId.WEB,
    pageUrl = "https://page/$id",
    thumbnailUrl = null,
    qualityLabel = "1080p",
    bytesDone = 10,
    totalBytes = 100,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    saveToGallery = null,
    createdAt = 500,
    updatedAt = updatedAt,
  )

  @Test fun roundTripsARow() = runBlocking {
    store.create(row("a", DownloadState.DOWNLOADING))
    val found = store.find("a")!!
    assertEquals("a", found.id)
    assertEquals(DownloadState.DOWNLOADING, found.state)
    assertEquals("https://cdn.example/a.mp4", found.url)
    assertEquals(100L, found.totalBytes)
    assertEquals("UA", found.request.userAgent)
    assertTrue(found.request.useCookies)
  }

  @Test fun requestJsonDropsSecretHeaders() = runBlocking {
    store.create(row("s", DownloadState.QUEUED, headers = mapOf("Cookie" to "SID", "Authorization" to "Bearer X", "X-Ok" to "1")))
    val headers = store.find("s")!!.request.headers
    assertNull(headers["Cookie"])
    assertNull(headers["Authorization"])
    assertEquals("1", headers["X-Ok"])
  }

  @Test fun streamVariantChoicesSurviveTheStore() = runBlocking {
    // The worker reads its row back from here: a DASH representation id must come back exactly, not redacted as a URL.
    store.create(row("d", DownloadState.QUEUED).copy(kind = SourceKind.DASH, variant = VariantChoice("av-480", null, 480)))
    assertEquals(VariantChoice("av-480", null, 480), store.find("d")!!.variant)
    // An HLS variant id is a playlist URL: kept without its signed query.
    val hls = VariantChoice("https://cdn.example/v/720.m3u8?sig=SECRET", null, 720)
    store.create(row("h", DownloadState.QUEUED).copy(kind = SourceKind.HLS, variant = hls))
    assertEquals(VariantChoice("https://cdn.example/v/720.m3u8", null, 720), store.find("h")!!.variant)
  }

  @Test fun saveUpdatesExistingRow() = runBlocking {
    store.create(row("u", DownloadState.DOWNLOADING))
    store.save(store.find("u")!!.copy(state = DownloadState.COMPLETED, bytesDone = 100))
    val updated = store.find("u")!!
    assertEquals(DownloadState.COMPLETED, updated.state)
    assertEquals(100L, updated.bytesDone)
  }

  @Test fun listKeepsActiveAndRecentCompletedButDropsOldCompleted() = runBlocking {
    val now = 100_000_000L
    store.create(row("active", DownloadState.DOWNLOADING, updatedAt = now))
    store.create(row("recent", DownloadState.COMPLETED, updatedAt = now - 1000))
    store.create(row("old", DownloadState.COMPLETED, updatedAt = now - 48L * 60 * 60 * 1000))

    val ids = store.list(now).map { it.id }.toSet()
    assertTrue(ids.contains("active"))
    assertTrue(ids.contains("recent"))
    assertFalse(ids.contains("old"))
  }

  @Test fun deleteRemovesRow() = runBlocking {
    store.create(row("d", DownloadState.FAILED))
    store.delete("d")
    assertNull(store.find("d"))
  }

  @Test fun persistsAndReadsFilePath() = runBlocking {
    store.create(row("fp", DownloadState.PROCESSING).copy(filePath = "library/web/clip.mp4"))
    assertEquals("library/web/clip.mp4", store.find("fp")!!.filePath)
    assertNull("file_path defaults to null", store.find(run { store.create(row("np", DownloadState.QUEUED)); "np" })!!.filePath)
  }

  @Test fun migratesV1DatabaseAddingFilePathWithoutDataLoss() = runBlocking {
    database.close()
    val dbFile = File(context.noBackupFilesDir, MediaDatabase.NAME)
    dbFile.delete()
    // Hand-build a v1 database (no file_path column) with one row, marked schema version 1.
    SQLiteDatabase.openOrCreateDatabase(dbFile, null).use { raw ->
      raw.execSQL(
        "CREATE TABLE downloads (id TEXT PRIMARY KEY, state TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, " +
          "audio_url TEXT, manifest_text TEXT, variant_json TEXT, request_json TEXT NOT NULL, title TEXT NOT NULL, " +
          "site TEXT NOT NULL, page_url TEXT, thumbnail_url TEXT, quality_label TEXT, bytes_done INTEGER NOT NULL " +
          "DEFAULT 0, total_bytes INTEGER, error_code TEXT, error_message TEXT, attempts INTEGER NOT NULL DEFAULT 0, " +
          "next_retry_at INTEGER, save_to_gallery INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      )
      raw.execSQL(
        "INSERT INTO downloads (id,state,kind,url,request_json,title,site,bytes_done,total_bytes,attempts,created_at,updated_at) " +
          "VALUES ('legacy','downloading','progressive','https://cdn.example/x.mp4','{}','Old','web',5,10,0,1,1)",
      )
      raw.version = 1
    }

    // Reopening through MediaDatabase (version 2) runs the ADD COLUMN migration.
    val upgraded = SqliteDownloadStore(MediaDatabase(context))
    val migrated = upgraded.find("legacy")!!
    assertEquals(DownloadState.DOWNLOADING, migrated.state)
    assertEquals(5L, migrated.bytesDone)
    assertNull("existing rows get a null file_path", migrated.filePath)

    upgraded.save(migrated.copy(filePath = "library/web/legacy.mp4"))
    assertEquals("library/web/legacy.mp4", upgraded.find("legacy")!!.filePath)
  }

  @Test fun completionIsRecordedWithTheCompletedStateAndReportedUntilAcknowledged() = runBlocking {
    store.create(row("done", DownloadState.PROCESSING))
    store.create(row("other", DownloadState.DOWNLOADING))

    store.saveCompleted(row("done", DownloadState.COMPLETED, updatedAt = 7_000L))
    assertEquals(DownloadState.COMPLETED, store.find("done")!!.state)
    assertEquals(listOf(CompletionRecord("done", 7_000L)), store.listCompletions())

    // A repeated commit (a repair re-run) never reports the same download twice.
    store.saveCompleted(row("done", DownloadState.COMPLETED, updatedAt = 9_000L))
    assertEquals(listOf(CompletionRecord("done", 7_000L)), store.listCompletions())

    // Other states are never completions.
    store.save(row("other", DownloadState.FAILED))
    assertEquals(listOf("done"), store.listCompletions().map { it.downloadId })

    store.acknowledgeCompletions(listOf("done", "unknown"))
    assertTrue(store.listCompletions().isEmpty())
    assertEquals("the download record itself is untouched", DownloadState.COMPLETED, store.find("done")!!.state)
  }

  @Test fun completionsAreListedOldestFirst() = runBlocking {
    for ((id, at) in listOf("b" to 20L, "a" to 10L, "c" to 30L)) {
      store.create(row(id, DownloadState.PROCESSING))
      store.saveCompleted(row(id, DownloadState.COMPLETED, updatedAt = at))
    }
    assertEquals(listOf("a", "b", "c"), store.listCompletions().map { it.downloadId })
  }

  @Test fun migratesV2DatabaseAddingTheCompletionsOutbox() = runBlocking {
    database.close()
    val dbFile = File(context.noBackupFilesDir, MediaDatabase.NAME)
    dbFile.delete()
    SQLiteDatabase.openOrCreateDatabase(dbFile, null).use { raw ->
      raw.execSQL(
        "CREATE TABLE downloads (id TEXT PRIMARY KEY, state TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, " +
          "audio_url TEXT, manifest_text TEXT, variant_json TEXT, request_json TEXT NOT NULL, title TEXT NOT NULL, " +
          "site TEXT NOT NULL, page_url TEXT, thumbnail_url TEXT, quality_label TEXT, bytes_done INTEGER NOT NULL " +
          "DEFAULT 0, total_bytes INTEGER, error_code TEXT, error_message TEXT, attempts INTEGER NOT NULL DEFAULT 0, " +
          "next_retry_at INTEGER, save_to_gallery INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, " +
          "file_path TEXT)",
      )
      raw.execSQL(
        "INSERT INTO downloads (id,state,kind,url,request_json,title,site,bytes_done,total_bytes,attempts,created_at,updated_at) " +
          "VALUES ('before','processing','progressive','https://cdn.example/x.mp4','{}','Old','web',10,10,0,1,1)",
      )
      raw.version = 2
    }

    val upgraded = SqliteDownloadStore(MediaDatabase(context))
    assertTrue("a download completed before the upgrade is not a new completion", upgraded.listCompletions().isEmpty())
    val existing = upgraded.find("before")!!
    upgraded.saveCompleted(existing.copy(state = DownloadState.COMPLETED, updatedAt = 42L))
    assertEquals(listOf(CompletionRecord("before", 42L)), upgraded.listCompletions())
  }

  @Test fun realLibraryWriterIsIdempotentOnDuplicateCompletion() = runBlocking {
    val paths = StoragePaths(context.filesDir, context.noBackupFilesDir)
    val writer = RealLibraryWriter(LibraryStore(database, paths))
    val item = libraryItem(paths, "lib-1")

    assertTrue("first insert succeeds", writer.insertCompleted(item))
    assertFalse("a duplicate completion is idempotent, not an error", writer.insertCompleted(item))
  }

  private fun libraryItem(paths: StoragePaths, id: String) = LibraryItem(
    id = id,
    title = "Clip",
    site = SiteId.WEB,
    pageUrl = null,
    sourceUrl = "https://cdn.example/$id",
    file = File(paths.libraryDir, "web/$id.mp4"),
    mimeType = "video/mp4",
    container = Container.MP4,
    videoCodec = "video/avc",
    audioCodec = null,
    hasAudio = false,
    width = 1280,
    height = 720,
    durationMs = 1000,
    sizeBytes = 2048,
    thumbnail = null,
    favorite = false,
    galleryUri = null,
    createdAt = 1,
    completedAt = 2,
  )
}
