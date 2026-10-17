package com.vidorax.media.files

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.ProxyFileDescriptorCallback
import android.os.storage.StorageManager
import android.system.ErrnoException
import android.system.OsConstants
import androidx.annotation.RequiresApi
import java.io.FileNotFoundException
import java.io.IOException
import java.io.RandomAccessFile

/**
 * H20 Play While Downloading (#411): serves a download's growing `.part` to the in-app player (expo-video reads a
 * `content://` URI through Media3's ContentDataSource). Not exported: only VidoraX itself can open it.
 *
 * A plain `file://` of the `.part` does not work: Media3 fixes the file's length when it opens it and fails a few
 * seconds after playback reaches the end of what is downloaded. Here the player gets a seekable file descriptor whose
 * size is the whole download ([StorageManager.openProxyFileDescriptor], API 26+): reads within the downloaded bytes are
 * served at once, a read past them waits for the download ([GrowingFileReader]) — so the player buffers at the edge
 * instead of ending — and fails only when nothing more arrives in time (paused, failed, offline).
 *
 * URI: `content://<applicationId>.vidorax.growing/v/<token>`; the token comes from [PlaybackSessions] (VidoraMediaModule
 * `getPlayableSource`) and names no download.
 */
class GrowingFileProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun getType(uri: Uri): String = "video/mp4"

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw FileNotFoundException("Read only")
    if (Build.VERSION.SDK_INT < PlayWhileDownloading.MIN_SDK) throw FileNotFoundException("Not supported on this Android version")
    val token = uri.pathSegments.takeIf { it.size == 2 && it[0] == PATH }?.get(1) ?: throw FileNotFoundException("Unknown URI")
    val session = PlaybackSessions.get(token) ?: throw FileNotFoundException("This playback has ended")
    val context = context ?: throw FileNotFoundException("No context")
    return open(context, session)
  }

  @RequiresApi(Build.VERSION_CODES.O)
  private fun open(context: Context, session: PlaybackSessions.Session): ParcelFileDescriptor {
    val file = try {
      RandomAccessFile(session.partFile, "r")
    } catch (e: IOException) {
      throw FileNotFoundException("The download is gone")
    }
    val reader = GrowingFileReader(file, session.totalBytes, session.partFile)
    // One thread per open descriptor: a read that waits for the download must not hold up another player's reads.
    val thread = HandlerThread("vidorax-growing-file").apply { start() }
    val storage = context.getSystemService(StorageManager::class.java)
    val callback = object : ProxyFileDescriptorCallback() {
      override fun onGetSize(): Long = reader.size()

      override fun onRead(offset: Long, size: Int, data: ByteArray): Int = try {
        reader.read(offset, size, data)
      } catch (e: IOException) {
        throw ErrnoException("onRead", OsConstants.EIO)
      }

      override fun onRelease() {
        runCatching { file.close() }
        thread.quitSafely()
      }
    }
    return try {
      storage.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, callback, Handler(thread.looper))
    } catch (e: IOException) {
      runCatching { file.close() }
      thread.quitSafely()
      throw FileNotFoundException("Could not open the download for playback")
    }
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

  companion object {
    private const val PATH = "v"

    /** The authority declared in the module manifest (`${applicationId}.vidorax.growing`). */
    fun authority(context: Context): String = "${context.packageName}.vidorax.growing"

    fun uriFor(context: Context, token: String): Uri =
      Uri.Builder().scheme("content").authority(authority(context)).appendPath(PATH).appendPath(token).build()
  }
}
