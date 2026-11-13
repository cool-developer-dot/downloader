package com.vidorax.media

import android.content.Context
import android.os.StatFs
import com.vidorax.media.analyze.BrowserIdentity
import com.vidorax.media.analyze.PageFetcher
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.files.FileActions
import com.vidorax.media.incoming.IncomingMediaRegistry
import com.vidorax.media.library.IncomingImport
import com.vidorax.media.library.GalleryExport
import com.vidorax.media.library.LegacyImport
import com.vidorax.media.library.LibraryStore
import com.vidorax.media.library.MediaInfo
import com.vidorax.media.library.SavedVideoIndex
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.library.StorageUsage
import com.vidorax.media.library.Thumbnails
import com.vidorax.media.net.NetworkOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Process-wide services shared by [VidoraMediaModule] and the download engine. Created once per process, so a
 * JavaScript reload never reopens the database or restarts the legacy import.
 */
class MediaServices private constructor(context: Context) {
  val paths = StoragePaths.from(context)
  val database = MediaDatabase(context)
  val library = LibraryStore(database, paths)
  val mediaInfo = MediaInfo(context)
  val thumbnails = Thumbnails(paths)
  val galleryExport = GalleryExport(context, library)
  val savedVideos = SavedVideoIndex(library, galleryExport)
  val fileActions = FileActions(context)
  val storageUsage = StorageUsage(paths, library)
  val legacyImport = LegacyImport(context, paths, library, mediaInfo, thumbnails)

  /** Files other apps opened in VidoraX during this process, by token. */
  val incomingMedia = IncomingMediaRegistry()

  /** "Save to VidoraX" for those files. */
  val incomingImport = IncomingImport(
    paths = paths,
    library = library,
    openStream = { uri -> context.contentResolver.openInputStream(uri) },
    readMetadata = mediaInfo::read,
    makeThumbnail = thumbnails::create,
    findSameContent = { file, audioOnly -> savedVideos.findByContent(file, excludeId = "", audioOnly = audioOnly) },
    freeBytes = { StatFs(paths.filesDir.path).availableBytes },
  )

  // Advanced network: the saved User-Agent and timeouts apply from process start, before any JavaScript runs.
  init {
    NetworkOptions.restore(context)
  }

  /** Pasted/shared links read for their video before the tab plays anything (`fetchPage`). */
  internal val pageFetcher: PageFetcher by lazy {
    PageFetcher.create(
      defaultUserAgent = { BrowserIdentity.userAgent(context) },
      acceptLanguage = { BrowserIdentity.acceptLanguage() },
    )
  }

  /** For work that must outlive the JavaScript runtime that started it. */
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  companion object {
    @Volatile
    private var instance: MediaServices? = null

    fun get(context: Context): MediaServices =
      instance ?: synchronized(this) {
        instance ?: MediaServices(context.applicationContext).also { instance = it }
      }
  }
}
