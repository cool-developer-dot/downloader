package com.vidorax.media.files

import android.content.ContentResolver
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import com.vidorax.media.InvalidRequestException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * F15 (Files: "SD card" and "Folders I added"): folders the user picked in Android's folder picker. Read-only: list
 * the folders VidoraX holds a lasting grant for, and list one folder's children with a single DocumentsContract query
 * (DocumentFile would query once per child). No permission is involved and nothing outside the picked folders is seen.
 */
class FolderAccess(private val resolver: ContentResolver) {

  /** Tree URIs VidoraX holds a lasting read grant for (from any feature that picked a folder). */
  fun grantedTrees(): List<String> =
    resolver.persistedUriPermissions
      .filter { it.isReadPermission && DocumentsContract.isTreeUri(it.uri) }
      .sortedByDescending { it.persistedTime }
      .map { it.uri.toString() }

  /**
   * The children of [parentDocumentId] (null = the picked folder itself) in [treeUri], folders first then by name,
   * at most [limit]. ERR_INVALID_REQUEST for a URI that is not a folder tree.
   */
  suspend fun listDocuments(treeUri: String, parentDocumentId: String?, limit: Int = MAX_CHILDREN): List<FolderDocument> =
    withContext(Dispatchers.IO) {
      val tree = Uri.parse(treeUri)
      if (tree.scheme != ContentResolver.SCHEME_CONTENT || !DocumentsContract.isTreeUri(tree)) {
        throw InvalidRequestException("Not a folder tree: $treeUri")
      }
      val parentId = parentDocumentId ?: DocumentsContract.getTreeDocumentId(tree)
      val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
      resolver.query(children, PROJECTION, null, null, null)?.use { cursor ->
        readDocuments(cursor, limit) { id -> DocumentsContract.buildDocumentUriUsingTree(tree, id).toString() }
      } ?: emptyList()
    }

  companion object {
    const val MAX_CHILDREN = 5000

    val PROJECTION = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )

    /** Reads the query's rows; [uriOf] builds each child's document URI. Hidden ("." names) are skipped. */
    internal fun readDocuments(cursor: Cursor, limit: Int, uriOf: (String) -> String): List<FolderDocument> {
      val idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
      val sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
      val modifiedCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
      val out = ArrayList<FolderDocument>()
      while (cursor.moveToNext() && out.size < limit) {
        val id = if (idCol >= 0) cursor.getString(idCol) else null
        val name = if (nameCol >= 0) cursor.getString(nameCol) else null
        if (id.isNullOrEmpty() || name.isNullOrEmpty() || name.startsWith(".")) continue
        val mime = if (mimeCol >= 0) cursor.getString(mimeCol) else null
        val isDirectory = mime == DocumentsContract.Document.MIME_TYPE_DIR
        out += FolderDocument(
          documentId = id,
          uri = uriOf(id),
          name = name,
          mimeType = if (isDirectory) null else mime,
          sizeBytes = if (isDirectory || sizeCol < 0 || cursor.isNull(sizeCol)) null else cursor.getLong(sizeCol),
          modifiedAt = if (modifiedCol < 0 || cursor.isNull(modifiedCol)) null else cursor.getLong(modifiedCol),
          isDirectory = isDirectory,
        )
      }
      return out.sortedWith(compareBy<FolderDocument>({ !it.isDirectory }, { it.name.lowercase() }, { it.documentId }))
    }
  }
}

data class FolderDocument(
  val documentId: String,
  val uri: String,
  val name: String,
  val mimeType: String?,
  val sizeBytes: Long?,
  val modifiedAt: Long?,
  val isDirectory: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "documentId" to documentId,
    "uri" to uri,
    "name" to name,
    "mimeType" to mimeType,
    "sizeBytes" to sizeBytes?.toDouble(),
    "modifiedAt" to modifiedAt?.toDouble(),
    "isDirectory" to isDirectory,
  )
}
