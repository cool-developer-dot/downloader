package com.vidorax.media.library

import android.app.Activity
import android.app.RecoverableSecurityException
import android.content.Context
import android.content.IntentSender
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.vidorax.media.db.MediaDatabase
import java.io.File
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** How "Also remove the Gallery copy" ended (H21). */
internal enum class GalleryRemovalOutcome(val wire: String) {
  REMOVED("removed"),

  /** The copy was already gone (deleted in the gallery app): nothing to do. */
  GONE("gone"),

  /** Not a copy VidoraX recorded making, or not in VidoraX's own gallery folders: never touched. */
  NOT_OURS("not_ours"),

  /** Android asked the user, and the user said no. */
  DECLINED("declined"),
  FAILED("failed"),
}

/** VidoraX's own record of the gallery copies it made (`gallery_exports`). */
internal interface GalleryCopyRecords {
  suspend fun isRecorded(uri: String): Boolean

  suspend fun forget(uri: String)
}

/** One delete of a MediaStore item, as Android answered it. */
internal sealed interface GalleryDeleteAttempt {
  object Deleted : GalleryDeleteAttempt

  object Gone : GalleryDeleteAttempt

  /**
   * Android needs the user's consent first ([request] shows its own dialog). [retryAfterConsent]: Android 10 grants
   * access and the delete is repeated; from Android 11 the dialog performs the delete itself.
   */
  class NeedsConsent(val request: IntentSender, val retryAfterConsent: Boolean) : GalleryDeleteAttempt

  class Failed(val error: Throwable) : GalleryDeleteAttempt
}

/** The MediaStore operations the removal needs (the real one is [AndroidGalleryMediaStore]). */
internal interface GalleryMediaStore {
  /** The item's folder below shared storage (`Movies/VidoraX/Web/`), or null when the item no longer exists. */
  fun folderOf(uri: String): String?

  fun delete(uri: String): GalleryDeleteAttempt
}

/** Shows Android's consent dialog for a delete; true when the user allowed it. */
internal fun interface GalleryDeleteConsent {
  suspend fun ask(request: IntentSender): Boolean
}

/**
 * H21 "Also remove the Gallery copy": deletes the gallery copy VidoraX itself made of a video moved into Private —
 * and nothing else. A copy is removed only when it is
 * - recorded in `gallery_exports` (VidoraX made it), and
 * - still in VidoraX's own gallery folders (`Movies/VidoraX/…`, `Music/VidoraX/…`).
 * Anything else is [GalleryRemovalOutcome.NOT_OURS] and left exactly as it is. Where Android requires it (a copy made
 * before a reinstall, Android 10's scoped storage) the user is asked through Android's own delete dialog. Once the copy
 * is gone, its record is forgotten, so the video is no longer counted as downloaded.
 */
internal class GalleryCopyRemoval(
  private val records: GalleryCopyRecords,
  private val store: GalleryMediaStore,
  private val consent: GalleryDeleteConsent,
) {
  suspend fun remove(uri: String): GalleryRemovalOutcome {
    val target = uri.trim()
    if (!isMediaStoreUri(target) || !records.isRecorded(target)) return GalleryRemovalOutcome.NOT_OURS
    val folder = withContext(Dispatchers.IO) { store.folderOf(target) }
    if (folder == null) {
      records.forget(target)
      return GalleryRemovalOutcome.GONE
    }
    if (!isInOwnGalleryFolder(folder)) return GalleryRemovalOutcome.NOT_OURS
    return when (val attempt = withContext(Dispatchers.IO) { store.delete(target) }) {
      GalleryDeleteAttempt.Deleted -> removed(target)
      GalleryDeleteAttempt.Gone -> removed(target, GalleryRemovalOutcome.GONE)
      is GalleryDeleteAttempt.Failed -> GalleryRemovalOutcome.FAILED
      is GalleryDeleteAttempt.NeedsConsent -> afterConsent(target, attempt)
    }
  }

  private suspend fun afterConsent(uri: String, attempt: GalleryDeleteAttempt.NeedsConsent): GalleryRemovalOutcome {
    if (!consent.ask(attempt.request)) return GalleryRemovalOutcome.DECLINED
    if (attempt.retryAfterConsent) {
      return when (withContext(Dispatchers.IO) { store.delete(uri) }) {
        GalleryDeleteAttempt.Deleted, GalleryDeleteAttempt.Gone -> removed(uri)
        else -> GalleryRemovalOutcome.FAILED
      }
    }
    // Android 11+: the dialog deleted it; confirm before saying so.
    return if (withContext(Dispatchers.IO) { store.folderOf(uri) } == null) removed(uri) else GalleryRemovalOutcome.FAILED
  }

  private suspend fun removed(uri: String, outcome: GalleryRemovalOutcome = GalleryRemovalOutcome.REMOVED): GalleryRemovalOutcome {
    runCatching { records.forget(uri) }
    return outcome
  }

  companion object {
    /** The app's own removal: `gallery_exports`, the device's MediaStore, Android's dialog from [activity]. */
    fun create(context: Context, database: MediaDatabase, library: LibraryStore, activity: () -> Activity?) =
      GalleryCopyRemoval(
        LibraryGalleryCopyRecords(database, library),
        AndroidGalleryMediaStore(context.applicationContext),
        ActivityGalleryDeleteConsent(activity),
      )

    fun isMediaStoreUri(uri: String): Boolean = uri.startsWith("content://media/")

    /** `Movies/VidoraX/…` or `Music/VidoraX/…` (see [galleryRoot]); a leading slash and letter case do not matter. */
    fun isInOwnGalleryFolder(folder: String): Boolean {
      val normalized = folder.trim().trimStart('/').let { if (it.endsWith('/')) it else "$it/" }
      return listOf(galleryRoot(audioOnly = false), galleryRoot(audioOnly = true)).any { root ->
        normalized.startsWith("$root/", ignoreCase = true)
      }
    }
  }
}

/** `gallery_exports` through the library's database. */
internal class LibraryGalleryCopyRecords(
  private val database: MediaDatabase,
  private val library: LibraryStore,
) : GalleryCopyRecords {
  override suspend fun isRecorded(uri: String): Boolean = database.read { db ->
    db.rawQuery("SELECT 1 FROM ${LibraryStore.GALLERY_EXPORTS} WHERE uri = ? LIMIT 1", arrayOf(uri)).use { it.moveToFirst() }
  }

  override suspend fun forget(uri: String) = library.forgetGalleryCopy(uri)
}

internal class AndroidGalleryMediaStore(private val context: Context) : GalleryMediaStore {
  override fun folderOf(uri: String): String? {
    val parsed = Uri.parse(uri)
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        context.contentResolver.query(parsed, arrayOf(MediaStore.MediaColumns.RELATIVE_PATH), null, null, null)
          ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0).orEmpty() else null }
      } else {
        legacyFile(parsed)?.parentFile?.let(::relativeToSharedStorage)
      }
    } catch (e: RuntimeException) {
      null
    }
  }

  override fun delete(uri: String): GalleryDeleteAttempt {
    val parsed = Uri.parse(uri)
    val legacy = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) legacyFile(parsed) else null
    return try {
      val rows = context.contentResolver.delete(parsed, null, null)
      // Android 9 and older: the copy is a real file in Movies/VidoraX; make sure it went with its row.
      legacy?.takeIf { it.exists() }?.delete()
      if (rows > 0) GalleryDeleteAttempt.Deleted else GalleryDeleteAttempt.Gone
    } catch (e: SecurityException) {
      consentFor(parsed, e) ?: GalleryDeleteAttempt.Failed(e)
    } catch (e: RuntimeException) {
      GalleryDeleteAttempt.Failed(e)
    }
  }

  private fun consentFor(uri: Uri, error: SecurityException): GalleryDeleteAttempt.NeedsConsent? = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
      runCatching { MediaStore.createDeleteRequest(context.contentResolver, listOf(uri)).intentSender }.getOrNull()
        ?.let { GalleryDeleteAttempt.NeedsConsent(it, retryAfterConsent = false) }
    Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && error is RecoverableSecurityException ->
      GalleryDeleteAttempt.NeedsConsent(error.userAction.actionIntent.intentSender, retryAfterConsent = true)
    else -> null
  }

  @Suppress("DEPRECATION")
  private fun legacyFile(uri: Uri): File? =
    context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)
      ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0)?.let(::File) else null }

  @Suppress("DEPRECATION")
  private fun relativeToSharedStorage(folder: File): String? {
    val root = Environment.getExternalStorageDirectory().absoluteFile.normalize()
    val relative = folder.absoluteFile.normalize().toRelativeString(root)
    return relative.takeUnless { it.startsWith("..") }?.replace(File.separatorChar, '/')?.plus("/")
  }
}

/**
 * Android's delete dialog shown from the current activity; its answer comes back through the module's
 * OnActivityResult. One request at a time; no answer within [TIMEOUT_MS] counts as "no".
 */
internal class ActivityGalleryDeleteConsent(private val activity: () -> Activity?) : GalleryDeleteConsent {
  override suspend fun ask(request: IntentSender): Boolean {
    val waiter = CompletableDeferred<Boolean>()
    if (!pending.compareAndSet(null, waiter)) return false
    try {
      val started = withContext(Dispatchers.Main) {
        val current = activity() ?: return@withContext false
        runCatching { current.startIntentSenderForResult(request, REQUEST_CODE, null, 0, 0, 0) }.isSuccess
      }
      if (!started) return false
      return withTimeoutOrNull(TIMEOUT_MS) { waiter.await() } ?: false
    } finally {
      pending.compareAndSet(waiter, null)
    }
  }

  companion object {
    /** Apart from vidorax-web's default-browser request (0x5644). */
    const val REQUEST_CODE = 0x5648
    const val TIMEOUT_MS = 5 * 60 * 1000L

    /** Shared by every module instance: the activity result arrives wherever the module lives now. */
    private val pending = AtomicReference<CompletableDeferred<Boolean>?>(null)

    fun onActivityResult(requestCode: Int, resultCode: Int) {
      if (requestCode == REQUEST_CODE) pending.get()?.complete(resultCode == Activity.RESULT_OK)
    }
  }
}
