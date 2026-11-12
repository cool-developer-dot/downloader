package com.vidorax.media.library

import android.net.Uri
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.NoSpaceException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import com.vidorax.media.incoming.IncomingMedia
import com.vidorax.media.model.LibraryChange
import com.vidorax.media.model.LibraryChangeReason
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.SiteId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.UUID

/**
 * "Save to VidoraX" for a file opened from another app (`importIncomingMedia`): the bytes are copied into the library
 * under the site `device`, unless the library (or a VidoraX gallery copy) already holds exactly these bytes. A file
 * Android cannot decode is still kept — it opens with another app, like a downloaded WMV. Nothing is left behind when
 * an import fails.
 */
class IncomingImport internal constructor(
  private val paths: StoragePaths,
  private val library: LibraryStore,
  private val openStream: (Uri) -> InputStream?,
  private val readMetadata: (File) -> MediaMetadata,
  private val makeThumbnail: (id: String, file: File, metadata: MediaMetadata) -> File?,
  private val findSameContent: suspend (file: File, audioOnly: Boolean) -> SavedCopy?,
  private val freeBytes: () -> Long,
  private val newId: () -> String = { UUID.randomUUID().toString() },
  private val now: () -> Long = System::currentTimeMillis,
) {
  sealed interface Outcome {
    data class Imported(val item: LibraryItem) : Outcome
    data class Duplicate(val copy: SavedCopy) : Outcome
  }

  // One import at a time: a second tap on the same file then finds the first copy instead of making another.
  private val mutex = Mutex()

  suspend fun import(media: IncomingMedia): Outcome = mutex.withLock {
    withContext(Dispatchers.IO) { importNow(media) }
  }

  private suspend fun importNow(media: IncomingMedia): Outcome {
    media.sizeBytes?.let { requireRoom(it) }
    // Imports run one at a time, so anything here is a leftover of one the process died in.
    paths.importRoot.listFiles()?.forEach { it.deleteRecursively() }
    val id = newId()
    val work = paths.importDir(id)
    var target: File? = null
    var thumbnail: File? = null
    var inserted = false
    try {
      work.mkdirs()
      val temp = File(work, "incoming")
      val sha256 = copy(media.uri, temp)
      val metadata = readMetadata(temp)
      val type = typeOf(media, metadata) ?: throw InvalidRequestException("Not an audio or video file")
      findSameContent(temp, type.isAudioOnly)?.let { return Outcome.Duplicate(it) }

      val title = Titles.clamp(media.displayName?.let(::withoutExtension) ?: Titles.FALLBACK)
      val byName = media.displayName?.let(MediaTypes::forFileName)
      val extension = if (byName != null) MediaTypes.extensionOf(media.displayName) else type.extension
      val file = paths.newLibraryFile(SiteId.DEVICE, title, id, extension).also { target = it }
      file.parentFile?.mkdirs()
      thumbnail = if (type.isAudioOnly) null else makeThumbnail(id, temp, metadata)
      if (!temp.renameTo(file)) throw StorageException("Could not move the file into the library")
      val addedAt = now()
      val item = LibraryItem(
        id = id,
        title = title,
        site = SiteId.DEVICE,
        pageUrl = null,
        sourceUrl = null,
        file = file,
        mimeType = MediaTypes.libraryMimeType(type.container, type.mimeType) ?: type.mimeType,
        container = type.container,
        videoCodec = metadata.videoCodec,
        audioCodec = metadata.audioCodec,
        hasAudio = metadata.hasAudio,
        width = metadata.width,
        height = metadata.height,
        durationMs = metadata.durationMs,
        sizeBytes = file.length(),
        thumbnail = thumbnail,
        favorite = false,
        galleryUri = null,
        createdAt = addedAt,
        completedAt = addedAt,
      )
      library.insert(item, announce = false)
      inserted = true
      runCatching { library.setContentHash(id, sha256) }
      library.announce(LibraryChange(LibraryChangeReason.IMPORTED, listOf(id)))
      return Outcome.Imported(library.get(id) ?: item)
    } catch (e: Throwable) {
      if (!inserted) {
        target?.delete()
        thumbnail?.delete()
      }
      throw e
    } finally {
      work.deleteRecursively()
    }
  }

  private fun requireRoom(sizeBytes: Long) {
    val free = runCatching { freeBytes() }.getOrDefault(Long.MAX_VALUE)
    if (free < sizeBytes + FREE_SPACE_MARGIN_BYTES) throw NoSpaceException("Not enough storage left for this file")
  }

  /** Copies [uri] to [target] and returns the SHA-256 of what was copied. */
  private fun copy(uri: Uri, target: File): String {
    val input = try {
      openStream(uri)
    } catch (e: FileNotFoundException) {
      null
    } catch (e: SecurityException) {
      null
    } ?: throw NotFoundException("The file can no longer be read")
    val digest = MessageDigest.getInstance("SHA-256")
    val copied = try {
      DigestInputStream(input, digest).use { source -> target.outputStream().use { source.copyTo(it, BUFFER_BYTES) } }
    } catch (e: IOException) {
      if (isOutOfSpace(e)) throw NoSpaceException("Not enough storage left for this file")
      throw StorageException("Could not copy the file", e)
    }
    if (copied <= 0L) throw InvalidRequestException("The file is empty")
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  /** The type the sending app's file name says, else its MIME type, else what the file reports about itself. */
  private fun typeOf(media: IncomingMedia, metadata: MediaMetadata): MediaType? =
    media.displayName?.let(MediaTypes::forFileName)
      ?: media.mimeType?.let(MediaTypes::forMimeType)
      ?: metadata.containerMimeType?.let(MediaTypes::forMimeType)

  private fun withoutExtension(name: String): String =
    if (MediaTypes.forFileName(name) != null) name.substringBeforeLast('.') else name

  private fun isOutOfSpace(e: IOException): Boolean {
    val message = generateSequence<Throwable>(e) { it.cause }.mapNotNull { it.message }.joinToString(" ")
    return message.contains("ENOSPC", ignoreCase = true) || message.contains("No space left", ignoreCase = true)
  }

  companion object {
    /** Kept free beyond the file's own size, like the download engine's margin. */
    const val FREE_SPACE_MARGIN_BYTES = 32L * 1024 * 1024
    private const val BUFFER_BYTES = 1 shl 16
  }
}
