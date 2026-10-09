package com.vidorax.media.model

import java.io.File

/** A library row with its file locations resolved. */
data class LibraryItem(
  val id: String,
  val title: String,
  val site: SiteId,
  val pageUrl: String?,
  val sourceUrl: String?,
  val file: File,
  val mimeType: String,
  val container: Container,
  val videoCodec: String?,
  val audioCodec: String?,
  val hasAudio: Boolean,
  val width: Int?,
  val height: Int?,
  val durationMs: Long?,
  val sizeBytes: Long,
  /** Null while generating or when no frame could be extracted. */
  val thumbnail: File?,
  val favorite: Boolean,
  /** `content://` URI of the gallery copy. */
  val galleryUri: String?,
  val createdAt: Long,
  val completedAt: Long,
  /** Hash of the source identity it was downloaded from (engine/DownloadIdentity); null for imported items. */
  val identityKey: String? = null,
  /** True until the automatic gallery copy of a new item is saved (survives a process death mid-copy). */
  val galleryPending: Boolean = false,
)

data class LibraryQuery(
  val search: String? = null,
  val site: SiteId? = null,
  val favoritesOnly: Boolean = false,
  val sort: LibrarySort = LibrarySort.NEWEST,
  val limit: Int = DEFAULT_LIMIT,
  val offset: Int = 0,
) {
  companion object {
    const val DEFAULT_LIMIT = 50
    const val MAX_LIMIT = 200
  }
}

data class LibraryPage(val items: List<LibraryItem>, val total: Int)

data class SiteCount(val site: SiteId, val count: Int)

data class AdjacentItems(val previous: String?, val next: String?)

data class LibraryChange(val reason: LibraryChangeReason, val ids: List<String>)

/** Metadata the JavaScript migration read from the v1 catalog. Null fields leave the stored value unchanged. */
data class LegacyMetadata(
  val id: String,
  val title: String?,
  val site: SiteId?,
  val pageUrl: String?,
  val favorite: Boolean?,
)

data class StorageStats(
  val libraryBytes: Long,
  val thumbnailBytes: Long,
  val tempBytes: Long,
  val freeBytes: Long,
  val totalBytes: Long,
)
