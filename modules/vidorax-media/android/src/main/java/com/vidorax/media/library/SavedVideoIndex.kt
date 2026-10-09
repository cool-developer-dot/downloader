package com.vidorax.media.library

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** A video the user already has: its library item, or only the gallery copy VidoraX saved of it. */
data class SavedCopy(val libraryItemId: String?, val galleryUri: String?)

/**
 * Finds videos the user already has, so the same video is never downloaded twice: by the identity of the source it
 * came from (before a download starts) and by the exact bytes of a finished file (before it joins the library).
 * Library items count only while their file is present; gallery copies only while they still exist in MediaStore —
 * a copy the user deleted is forgotten, and the video can be downloaded again.
 */
class SavedVideoIndex internal constructor(
  private val library: LibraryStore,
  private val gallery: GalleryExport,
) {
  suspend fun findByIdentity(identityKey: String): SavedCopy? {
    val items = library.findByIdentity(identityKey)
    val present = withContext(Dispatchers.IO) { items.firstOrNull { it.file.isFile && it.file.length() > 0 } }
    if (present != null) return SavedCopy(present.id, present.galleryUri)
    // Rows whose file is gone promise a video that is not there: repair them instead of calling it a duplicate.
    if (items.isNotEmpty()) runCatching { library.removeMissingFiles(items.map { it.id }) }
    for (uri in library.galleryCopiesFor(identityKey)) {
      if (withContext(Dispatchers.IO) { gallery.exists(uri) }) return SavedCopy(null, uri)
      library.forgetGalleryCopy(uri)
    }
    return null
  }

  /**
   * A library item (other than [excludeId]) or a VidoraX gallery copy with exactly the bytes of [file]. Sizes are
   * compared first, so the file is hashed only when another file of exactly its size exists; each library item's
   * hash is computed once and kept.
   */
  suspend fun findByContent(file: File, excludeId: String, audioOnly: Boolean): SavedCopy? = withContext(Dispatchers.IO) {
    val size = file.length()
    if (size <= 0) return@withContext null
    val ours by lazy { ContentHash.sha256(file) }
    for ((item, stored) in library.findBySize(size, excludeId)) {
      if (!item.file.isFile || item.file.length() != size) continue
      val theirs = stored ?: runCatching { ContentHash.sha256(item.file) }.getOrNull()
        ?.also { runCatching { library.setContentHash(item.id, it) } }
        ?: continue
      if (theirs == ours) return@withContext SavedCopy(item.id, item.galleryUri)
    }
    gallery.findSameContent(file, audioOnly) { ours }?.let { SavedCopy(null, it) }
  }

  /** Items saved before identities existed get the identity of their recorded source (and page). */
  suspend fun backfillIdentities(identityOf: (sourceUrl: String, pageUrl: String?) -> String?) =
    library.backfillIdentities(identityOf)
}
