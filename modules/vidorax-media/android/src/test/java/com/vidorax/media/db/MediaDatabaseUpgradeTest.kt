package com.vidorax.media.db

import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Upgrading an installed database (the v4 schema of `v1.0.0-test1`, and v5 of the F2 builds) with real rows: nothing is
 * lost, the new tables exist, and every migration is safe to run twice.
 */
@RunWith(RobolectricTestRunner::class)
class MediaDatabaseUpgradeTest {
  private val context = RuntimeEnvironment.getApplication()
  private val file = File(context.noBackupFilesDir, MediaDatabase.NAME)

  @After fun tearDown() {
    file.delete()
    File(file.path + "-wal").delete()
    File(file.path + "-shm").delete()
  }

  /** The v4 schema: today's CREATE list without what later versions added. */
  private fun createV4WithRows() {
    file.parentFile?.mkdirs()
    SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
      Schema.CREATE.filterNot { it.contains("download_bandwidth") || it.contains("download_schedule") }.forEach(db::execSQL)
      db.execSQL(
        "INSERT INTO downloads (id, state, kind, url, request_json, title, site, bytes_done, total_bytes, " +
          "created_at, updated_at) VALUES ('paused-1', 'paused', 'hls', 'https://cdn.example/a.m3u8', '{}', " +
          "'A paused stream', 'web', 1000, 5000, 1, 2)",
      )
      db.execSQL(
        "INSERT INTO downloads (id, state, kind, url, request_json, title, site, bytes_done, total_bytes, " +
          "created_at, updated_at) VALUES ('queued-1', 'queued', 'progressive', 'https://cdn.example/b.mp4', '{}', " +
          "'A queued file', 'web', 0, NULL, 3, 4)",
      )
      db.execSQL(
        "INSERT INTO library (id, title, site, file_path, mime_type, container, has_audio, size_bytes, created_at, " +
          "completed_at) VALUES ('lib-1', 'Saved clip', 'web', 'library/web/Saved clip_lib1.mp4', 'video/mp4', 'mp4', " +
          "1, 4096, 1, 2)",
      )
      db.execSQL("INSERT INTO completions (download_id, completed_at) VALUES ('lib-1', 2)")
      db.version = 4
    }
  }

  @Test fun upgradingFromV4KeepsEveryRowAndAddsTheBandwidthTable() {
    createV4WithRows()
    val database = MediaDatabase(context)
    try {
      val db = database.writableDatabase
      assertEquals(Schema.VERSION, db.version)
      db.rawQuery("SELECT state, bytes_done FROM downloads WHERE id = 'paused-1'", null).use {
        assertTrue(it.moveToFirst())
        assertEquals("paused", it.getString(0))
        assertEquals(1000L, it.getLong(1))
      }
      db.rawQuery("SELECT title FROM library WHERE id = 'lib-1'", null).use {
        assertTrue(it.moveToFirst())
        assertEquals("Saved clip", it.getString(0))
      }
      db.rawQuery("SELECT COUNT(*) FROM completions", null).use { it.moveToFirst(); assertEquals(1, it.getInt(0)) }
      db.execSQL("INSERT INTO download_bandwidth (download_id, limit_bps, priority) VALUES ('paused-1', 262144, 1)")
      // Running the v5 migration again (a crash between statements and the version bump) changes nothing.
      Schema.MIGRATIONS.getValue(5).forEach(db::execSQL)
      db.rawQuery("SELECT limit_bps, priority FROM download_bandwidth", null).use {
        assertTrue(it.moveToFirst())
        assertEquals(262144L, it.getLong(0))
        assertEquals(1, it.getInt(1))
      }
      // v6 (F3): the start-time table, and the queued download is still queued.
      db.execSQL("INSERT INTO download_schedule (download_id, start_at) VALUES ('queued-1', 1800000000000)")
      Schema.MIGRATIONS.getValue(6).forEach(db::execSQL)
      db.rawQuery("SELECT start_at FROM download_schedule WHERE download_id = 'queued-1'", null).use {
        assertTrue(it.moveToFirst())
        assertEquals(1800000000000L, it.getLong(0))
      }
      db.rawQuery("SELECT state FROM downloads WHERE id = 'queued-1'", null).use {
        assertTrue(it.moveToFirst())
        assertEquals("queued", it.getString(0))
      }
    } finally {
      database.close()
    }
  }

  @Test fun upgradingFromV5KeepsTheBandwidthRowsAndAddsTheScheduleTable() {
    file.parentFile?.mkdirs()
    SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
      Schema.CREATE.filterNot { it.contains("download_schedule") }.forEach(db::execSQL)
      db.execSQL(
        "INSERT INTO downloads (id, state, kind, url, request_json, title, site, bytes_done, total_bytes, " +
          "created_at, updated_at) VALUES ('d', 'waiting_network', 'progressive', 'https://cdn.example/d.mp4', '{}', " +
          "'Waiting', 'web', 10, 100, 1, 2)",
      )
      db.execSQL("INSERT INTO download_bandwidth (download_id, limit_bps, priority) VALUES ('d', 524288, 0)")
      db.version = 5
    }
    val database = MediaDatabase(context)
    try {
      val db = database.writableDatabase
      assertEquals(Schema.VERSION, db.version)
      db.rawQuery("SELECT limit_bps FROM download_bandwidth WHERE download_id = 'd'", null).use {
        assertTrue(it.moveToFirst())
        assertEquals(524288L, it.getLong(0))
      }
      db.rawQuery("SELECT COUNT(*) FROM download_schedule", null).use { it.moveToFirst(); assertEquals(0, it.getInt(0)) }
    } finally {
      database.close()
    }
  }
}
