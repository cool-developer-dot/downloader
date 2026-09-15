package com.vidorax.media.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The only store of download and library state: noBackupFilesDir/vidorax-media.db. Application-scoped; obtain it
 * through MediaServices so every component shares one connection pool.
 */
class MediaDatabase(context: Context) : SQLiteOpenHelper(
  context,
  File(context.noBackupFilesDir, NAME).path,
  null,
  Schema.VERSION,
) {
  /** Every database call runs here, never on the main or JavaScript thread. */
  private val dispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(4)

  init {
    setWriteAheadLoggingEnabled(true)
  }

  override fun onConfigure(db: SQLiteDatabase) {
    db.setForeignKeyConstraintsEnabled(true)
  }

  override fun onCreate(db: SQLiteDatabase) {
    Schema.CREATE.forEach(db::execSQL)
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    for (version in oldVersion + 1..newVersion) {
      val statements = Schema.MIGRATIONS[version] ?: error("No migration to database version $version")
      statements.forEach(db::execSQL)
    }
  }

  suspend fun <T> read(block: (SQLiteDatabase) -> T): T = withContext(dispatcher) {
    block(readableDatabase)
  }

  suspend fun <T> transaction(block: (SQLiteDatabase) -> T): T = withContext(dispatcher) {
    val db = writableDatabase
    db.beginTransactionNonExclusive()
    try {
      block(db).also { db.setTransactionSuccessful() }
    } finally {
      db.endTransaction()
    }
  }

  companion object {
    const val NAME = "vidorax-media.db"
  }
}
