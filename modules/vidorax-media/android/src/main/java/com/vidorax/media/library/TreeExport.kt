package com.vidorax.media.library

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.FileNotFoundException
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException

/** The folder the user picked can no longer be written: the grant was revoked, or the folder was moved or deleted. */
class FolderAccessLostException(message: String) : CodedException("ERR_FOLDER_ACCESS", message, null)

/**
 * Save Location (#297, #465, #395, #382-#384): an extra copy of a finished library item in a folder the user picked
 * with the Storage Access Framework (a tree URI whose permission JavaScript persisted when it was picked). The private
 * library file is only ever read; it stays the library's copy, and nothing here deletes or changes an external copy
 * once it is written. No storage permission is involved.
 *
 * The copy streams with a fixed buffer, so a large video never sits in memory. A name that already exists gets the
 * document provider's own unique name ("Title (1).mp4"). A half-written copy is removed again.
 */
internal class TreeExport(
  private val context: Context,
  private val library: LibraryStore,
) {
  private val resolver: ContentResolver get() = context.contentResolver

  /** Result of one copy, as JavaScript records it for Show in Folder. */
  data class Copy(val documentUri: String, val folderUri: String, val name: String, val bytes: Long)

  /**
   * Copies library item [id] into [treeUri], inside [subfolders] (created when missing). Rejects with
   * ERR_FOLDER_ACCESS when the folder can no longer be written, ERR_NOT_FOUND for an unknown item or a missing file,
   * ERR_INVALID_REQUEST for a URI that is not a picked folder, and ERR_STORAGE when the copy fails.
   */
  suspend fun copy(id: String, treeUri: String, subfolders: List<String>): Copy {
    val tree = parseTree(treeUri)
    val item = library.get(id) ?: throw NotFoundException("Unknown library item $id")
    if (!item.file.isFile) throw NotFoundException("The file of $id is missing")
    return withContext(Dispatchers.IO) {
      if (!canWrite(tree)) throw FolderAccessLostException("The chosen folder can no longer be written")
      val progress = LongArray(2).also { it[1] = item.file.length() }
      running[id] = progress
      try {
        val folder = try {
          folderFor(tree, subfolders.filter { it.isNotBlank() }.take(MAX_DEPTH).map(::safeFolderName))
        } catch (e: FileNotFoundException) {
          // The picked folder itself is gone (moved or deleted outside VidoraX): the grant points nowhere.
          throw FolderAccessLostException("The chosen folder was moved or deleted")
        }
        val name = galleryFileName(item.title, item.file.extension)
        val document = try {
          DocumentsContract.createDocument(resolver, folder, item.mimeType, name)
        } catch (e: SecurityException) {
          throw FolderAccessLostException("The chosen folder can no longer be written")
        } ?: throw StorageException("The folder did not create the file")
        try {
          val copied = resolver.openOutputStream(document, "w")?.use { output ->
            item.file.inputStream().use { input ->
              val buffer = ByteArray(COPY_BUFFER_BYTES)
              var total = 0L
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                total += read
                progress[0] = total
              }
              total
            }
          } ?: throw StorageException("The folder did not open the new file")
          if (copied != item.file.length()) throw IOException("Copied $copied of ${item.file.length()} bytes")
          Copy(document.toString(), folder.toString(), displayName(document) ?: name, copied)
        } catch (e: Exception) {
          // Never leave a partial copy behind; the library file was only read.
          runCatching { DocumentsContract.deleteDocument(resolver, document) }
          throw e
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: CodedException) {
        throw e
      } catch (e: SecurityException) {
        throw FolderAccessLostException("The chosen folder can no longer be written")
      } catch (e: Exception) {
        throw StorageException("Could not copy $id to the chosen folder", e)
      } finally {
        running.remove(id)
      }
    }
  }

  /** Bytes copied so far and the total, while a copy of [id] runs; null otherwise. */
  fun progress(id: String): Pair<Long, Long>? = running[id]?.let { it[0] to it[1] }

  /** True while VidoraX still holds a persisted write grant for [treeUri]. */
  fun hasAccess(treeUri: String): Boolean = runCatching { canWrite(parseTree(treeUri)) }.getOrDefault(false)

  /** Gives the grant back (Remove / Change). Never throws; unknown URIs are ignored. */
  fun release(treeUri: String) {
    runCatching {
      resolver.releasePersistableUriPermission(
        parseTree(treeUri),
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
      )
    }
  }

  /** The picked folder's own name ("Movies", "VidoraX"), or null when the provider does not say. */
  suspend fun folderName(treeUri: String): String? = withContext(Dispatchers.IO) {
    runCatching {
      val tree = parseTree(treeUri)
      displayName(DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)))
    }.getOrNull()
  }

  /**
   * Show in Folder (#398), best effort: asks the files app to show the folder [folderUri] (a document URI this class
   * returned). False when no installed app opens folders, so JavaScript can say where the copy is instead.
   */
  fun openFolder(activity: Activity?, folderUri: String): Boolean {
    val uri = runCatching { Uri.parse(folderUri) }.getOrNull() ?: return false
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) return false
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      (activity ?: context).startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      false
    }
  }

  private fun parseTree(treeUri: String): Uri {
    // The grant is held for the URI without a trailing slash (expo-file-system adds one to directory URIs).
    val uri = runCatching { Uri.parse(treeUri.trimEnd('/')) }.getOrNull()
    if (uri == null || uri.scheme != ContentResolver.SCHEME_CONTENT || !DocumentsContract.isTreeUri(uri)) {
      throw InvalidRequestException("Not a picked folder")
    }
    return uri
  }

  private fun canWrite(tree: Uri): Boolean =
    resolver.persistedUriPermissions.any { it.uri == tree && it.isWritePermission }

  /** The document URI of [names] below the tree's root, each folder found by name or created. */
  private fun folderFor(tree: Uri, names: List<String>): Uri {
    var parentId = DocumentsContract.getTreeDocumentId(tree)
    var parent = DocumentsContract.buildDocumentUriUsingTree(tree, parentId)
    for (name in names) {
      val existing = childFolderId(tree, parentId, name)
      parent = if (existing != null) {
        DocumentsContract.buildDocumentUriUsingTree(tree, existing)
      } else {
        DocumentsContract.createDocument(resolver, parent, DocumentsContract.Document.MIME_TYPE_DIR, name)
          ?: throw StorageException("Could not create the folder $name")
      }
      parentId = DocumentsContract.getDocumentId(parent)
    }
    return parent
  }

  private fun childFolderId(tree: Uri, parentId: String, name: String): String? {
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )
    resolver.query(children, projection, null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val isFolder = cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR
        if (isFolder && cursor.getString(1) == name) return cursor.getString(0)
      }
    }
    return null
  }

  private fun displayName(document: Uri): String? =
    runCatching {
      resolver.query(document, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    }.getOrNull()?.ifBlank { null }

  internal companion object {
    const val COPY_BUFFER_BYTES = 1 shl 16

    /** Type and site folders: two levels are all the options ever ask for; more is a malformed request. */
    const val MAX_DEPTH = 2

    /** Copies in flight: bytes done and total, for the progress JavaScript polls. Memory only. */
    private val running = ConcurrentHashMap<String, LongArray>()

    /**
     * A folder name as JavaScript built it, made safe again here: letters of every script (Urdu included) are kept,
     * characters no file system accepts become spaces, and leading dots are dropped, so "." / ".." can never climb out
     * of the tree and no folder is hidden. Never empty.
     */
    fun safeFolderName(name: String): String = FileNames.safeTitle(name)
  }
}
