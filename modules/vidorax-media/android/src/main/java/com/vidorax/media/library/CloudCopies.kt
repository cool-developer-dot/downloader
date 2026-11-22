package com.vidorax.media.library

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import com.vidorax.media.incoming.IncomingMedia
import com.vidorax.media.incoming.IncomingMediaIntents
import expo.modules.kotlin.exception.CodedException
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.cancellation.CancellationException

/**
 * #512 Save to cloud: "Save a copy to…" — Android's own save screen (ACTION_CREATE_DOCUMENT), where the user's cloud
 * apps (Google Drive, OneDrive, Dropbox…) appear next to the phone's folders; VidoraX writes the finished file to the
 * place picked. No account, no upload code of our own: the cloud app does the upload. The library file is only read.
 */
internal class SaveCopyAs(
  private val context: Context,
  private val library: LibraryStore,
  private val activity: () -> Activity?,
) {
  private val resolver: ContentResolver get() = context.contentResolver

  /** "saved" with the new file's name and size, or "cancelled" when the user closed the screen. */
  suspend fun save(id: String): Map<String, Any?> {
    val item = library.get(id) ?: throw NotFoundException("Unknown library item $id")
    if (!item.file.isFile) throw NotFoundException("The file of $id is missing")
    val name = galleryFileName(item.title, item.file.extension)
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType(item.mimeType)
      .putExtra(Intent.EXTRA_TITLE, name)
    val target = pick(intent) ?: return mapOf("status" to "cancelled")
    return withContext(Dispatchers.IO) {
      val total = item.file.length()
      progress.set(id to LongArray(2).also { it[1] = total })
      try {
        val copied = resolver.openOutputStream(target, "w")?.use { output ->
          item.file.inputStream().use { input ->
            val buffer = ByteArray(COPY_BUFFER_BYTES)
            var written = 0L
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              output.write(buffer, 0, read)
              written += read
              progress.get()?.second?.set(0, written)
            }
            written
          }
        } ?: throw StorageException("The chosen place did not open the new file")
        if (copied != total) throw IOException("Copied $copied of $total bytes")
        mapOf("status" to "saved", "name" to (displayName(target) ?: name), "bytes" to copied.toDouble())
      } catch (e: CancellationException) {
        runCatching { DocumentsContract.deleteDocument(resolver, target) }
        throw e
      } catch (e: CodedException) {
        runCatching { DocumentsContract.deleteDocument(resolver, target) }
        throw e
      } catch (e: Exception) {
        // Never leave a partial copy behind.
        runCatching { DocumentsContract.deleteDocument(resolver, target) }
        throw StorageException("Could not save a copy of $id", e)
      } finally {
        progress.set(null)
      }
    }
  }

  private suspend fun pick(intent: Intent): Uri? {
    val waiter = CompletableDeferred<Uri?>()
    if (!pending.compareAndSet(null, waiter)) throw InvalidRequestException("Another save screen is open")
    try {
      val started = withContext(Dispatchers.Main) {
        val current = activity() ?: return@withContext false
        runCatching { current.startActivityForResult(intent, REQUEST_CODE) }.isSuccess
      }
      if (!started) throw InvalidRequestException("The save screen could not be opened")
      return withTimeoutOrNull(TIMEOUT_MS) { waiter.await() }
    } finally {
      pending.compareAndSet(waiter, null)
    }
  }

  private fun displayName(uri: Uri): String? = runCatching {
    resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    }
  }.getOrNull()

  companion object {
    /** Apart from the gallery delete consent (0x5648) and vidorax-web's default-browser request (0x5644). */
    const val REQUEST_CODE = 0x564A
    private const val TIMEOUT_MS = 15 * 60 * 1000L
    private const val COPY_BUFFER_BYTES = 256 * 1024

    private val pending = AtomicReference<CompletableDeferred<Uri?>?>(null)
    private val progress = AtomicReference<Pair<String, LongArray>?>(null)

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_CODE) return
      pending.get()?.complete(if (resultCode == Activity.RESULT_OK) data?.data else null)
    }

    /** Bytes written and the total while a copy of [id] runs; null otherwise. */
    fun progress(id: String): Pair<Long, Long>? = progress.get()?.takeIf { it.first == id }?.second?.let { it[0] to it[1] }
  }
}

/**
 * #507 Cloud folder: the videos of a folder the user picked (a cloud app's folder — OneDrive, Dropbox, Nextcloud — or
 * any folder on the phone) are copied into the library one by one, through the same import as a video opened from
 * another app, so a video already in the library is skipped. Audio-only files are left out. At most [MAX_FILES]
 * files, [MAX_DEPTH] folders deep.
 */
internal class FolderImport(
  private val context: Context,
  private val importOne: suspend (IncomingMedia) -> IncomingImport.Outcome,
) {
  data class Summary(val found: Int, val imported: Int, val duplicates: Int, val failed: Int, val stopped: Boolean)

  private val resolver: ContentResolver get() = context.contentResolver

  suspend fun run(treeUri: String): Summary {
    val tree = Uri.parse(treeUri)
    if (tree.scheme != ContentResolver.SCHEME_CONTENT || !DocumentsContract.isTreeUri(tree)) {
      throw InvalidRequestException("Not a picked folder")
    }
    if (!state.compareAndSet(null, IntArray(5))) throw InvalidRequestException("A folder import is already running")
    cancelled = false
    try {
      val files = withContext(Dispatchers.IO) { videosIn(tree) }
      state.get()?.set(0, files.size)
      var imported = 0
      var duplicates = 0
      var failed = 0
      for (file in files) {
        if (cancelled) break
        try {
          when (importOne(file)) {
            is IncomingImport.Outcome.Imported -> imported += 1
            is IncomingImport.Outcome.Duplicate -> duplicates += 1
          }
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          failed += 1
        }
        state.get()?.let {
          it[1] = imported + duplicates + failed
          it[2] = imported
          it[3] = duplicates
          it[4] = failed
        }
      }
      return Summary(files.size, imported, duplicates, failed, cancelled)
    } finally {
      state.set(null)
    }
  }

  private fun videosIn(tree: Uri): List<IncomingMedia> {
    val out = mutableListOf<IncomingMedia>()
    fun walk(documentId: String, depth: Int) {
      val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
      val columns = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
      )
      val folders = mutableListOf<String>()
      runCatching {
        resolver.query(children, columns, null, null, null)?.use { c ->
          while (c.moveToNext() && out.size < MAX_FILES) {
            val id = c.getString(0) ?: continue
            val name = c.getString(1)
            val mime = c.getString(2)?.lowercase()
            if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
              folders += id
              continue
            }
            val byName = name?.let(MediaTypes::forFileName)
            val video = mime?.startsWith("video/") == true || (byName != null && !byName.isAudioOnly)
            if (!video) continue
            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
            out += IncomingMedia(
              token = IncomingMediaIntents.tokenFor(uri),
              uri = uri,
              displayName = name,
              mimeType = mime?.takeIf { it.startsWith("video/") } ?: byName?.mimeType,
              sizeBytes = if (c.isNull(3)) null else c.getLong(3).takeIf { it > 0 },
              kind = IncomingMedia.Kind.VIDEO,
            )
          }
        }
      }
      if (depth < MAX_DEPTH) for (folder in folders) if (out.size < MAX_FILES) walk(folder, depth + 1)
    }
    walk(DocumentsContract.getTreeDocumentId(tree), 0)
    return out
  }

  companion object {
    const val MAX_FILES = 500
    const val MAX_DEPTH = 3

    /** found, done, imported, duplicates, failed — while an import runs. */
    private val state = AtomicReference<IntArray?>(null)
    @Volatile private var cancelled = false

    fun progress(): Map<String, Any?>? = state.get()?.let {
      mapOf("found" to it[0], "done" to it[1], "imported" to it[2], "duplicates" to it[3], "failed" to it[4])
    }

    fun cancel() {
      cancelled = true
    }
  }
}
