package com.vidorax.media.archive

import android.net.Uri
import com.vidorax.media.NoSpaceException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import com.vidorax.media.incoming.IncomingMedia
import com.vidorax.media.incoming.IncomingMediaIntents
import com.vidorax.media.library.FileNames
import com.vidorax.media.library.IncomingImport
import com.vidorax.media.library.MediaTypes
import com.vidorax.media.safety.ContentSniff
import com.vidorax.media.subtitles.SrtToVtt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.util.Locale

/**
 * P8 #407 Extract Archive: a `.zip` another app opened in (or shared to) VidoraX. Its bytes are copied once into the
 * app's own no-backup folder, its entries listed under [ZipArchive]'s guards, and on the user's go-ahead its videos
 * are imported one by one through [IncomingImport] (duplicates are skipped there) with matching `.srt`/`.vtt`
 * subtitles saved beside them. Programs inside are never extracted; a "video" entry whose bytes are a program or an
 * archive is skipped as disguised. Nothing is left behind afterwards.
 */
class ArchiveImport internal constructor(
  private val workRoot: File,
  private val openStream: (Uri) -> InputStream?,
  private val freeBytes: () -> Long,
  private val importFile: suspend (IncomingMedia) -> IncomingImport.Outcome,
  private val saveSubtitles: suspend (itemId: String, subtitles: List<LocalSubtitle>) -> Unit,
) {
  data class LocalSubtitle(val language: String?, val vtt: String)

  data class Inspection(val listing: ZipListing)

  data class Summary(
    val imported: List<String>,
    val duplicates: Int,
    val subtitles: Int,
    val disguised: List<String>,
    val failed: Int,
  )

  private val mutex = Mutex()

  suspend fun inspect(media: IncomingMedia): ZipListing = mutex.withLock {
    withContext(Dispatchers.IO) {
      val copy = try {
        localCopy(media)
      } catch (e: ArchiveRefusedException) {
        return@withContext ZipListing.Refused(e.refusal)
      }
      FileArchiveSource(copy).use { ZipArchive.list(it) }
    }
  }

  suspend fun extract(media: IncomingMedia): Summary = mutex.withLock {
    withContext(Dispatchers.IO) {
      val copy = localCopy(media)
      try {
        FileArchiveSource(copy).use { source -> extractFrom(source) }
      } finally {
        clear()
      }
    }
  }

  /** Forgets a copied archive (the user closed the screen without extracting). */
  suspend fun discard() = mutex.withLock { withContext(Dispatchers.IO) { clear() } }

  private suspend fun extractFrom(source: ArchiveSource): Summary {
    val entries = when (val listing = ZipArchive.list(source)) {
      is ZipListing.Ok -> listing.entries
      is ZipListing.Refused -> throw ArchiveRefusedException(listing.refusal, "Archive refused")
    }
    val videos = entries.filter { it.kind == ArchiveEntryKind.VIDEO && it.readable }
    val subtitles = entries.filter { it.kind == ArchiveEntryKind.SUBTITLE && it.readable && it.uncompressedSize <= MAX_SUBTITLE_BYTES }
    val imported = ArrayList<String>()
    val disguised = ArrayList<String>()
    var duplicates = 0
    var failed = 0
    var savedSubtitles = 0
    val outFolder = File(workRoot, "out").apply { mkdirs() }

    for (entry in videos) {
      val prefix = ZipArchive.prefix(source, entry)
      if (ContentSniff.kindOf(prefix) != null) {
        disguised += entry.baseName
        continue
      }
      requireRoom(entry.uncompressedSize)
      val temp = File(outFolder, FileNames.safeId(entry.baseName).ifEmpty { "video" })
      try {
        temp.outputStream().use { ZipArchive.extract(source, entry, it) }
        val uri = Uri.fromFile(temp)
        val media = IncomingMedia(
          token = IncomingMediaIntents.tokenFor(uri),
          uri = uri,
          displayName = entry.baseName,
          mimeType = MediaTypes.forFileName(entry.baseName)?.mimeType,
          sizeBytes = temp.length(),
          kind = IncomingMedia.Kind.VIDEO,
        )
        when (val outcome = importFile(media)) {
          is IncomingImport.Outcome.Imported -> {
            imported += outcome.item.id
            val mine = subtitles.filter { belongsTo(it, entry, videos) }
            val converted = mine.mapNotNull { subtitle -> subtitleOf(source, subtitle) }
            if (converted.isNotEmpty()) {
              runCatching { saveSubtitles(outcome.item.id, converted) }.onSuccess { savedSubtitles += converted.size }
            }
          }
          is IncomingImport.Outcome.Duplicate -> duplicates += 1
        }
      } catch (e: NoSpaceException) {
        throw e
      } catch (e: Exception) {
        failed += 1
      } finally {
        temp.delete()
      }
    }
    return Summary(imported, duplicates, savedSubtitles, disguised, failed)
  }

  /** `Movie.en.srt` belongs to `Movie.mp4`; with a single video in the archive every subtitle belongs to it. */
  private fun belongsTo(subtitle: ZipEntryInfo, video: ZipEntryInfo, videos: List<ZipEntryInfo>): Boolean {
    if (videos.size == 1) return true
    val videoStem = video.baseName.substringBeforeLast('.').lowercase(Locale.ROOT)
    val parts = subtitle.baseName.substringBeforeLast('.').lowercase(Locale.ROOT)
    return parts == videoStem || parts.substringBeforeLast('.') == videoStem
  }

  private fun subtitleOf(source: ArchiveSource, entry: ZipEntryInfo): LocalSubtitle? {
    val bytes = runCatching {
      java.io.ByteArrayOutputStream().also { ZipArchive.extract(source, entry, it) }.toByteArray()
    }.getOrNull() ?: return null
    val text = String(bytes, Charsets.UTF_8)
    val vtt = if (entry.baseName.lowercase(Locale.ROOT).endsWith(".vtt")) {
      text.takeIf { it.removePrefix("﻿").trimStart().startsWith("WEBVTT") }
    } else {
      SrtToVtt.convert(text)
    } ?: return null
    return LocalSubtitle(languageOf(entry.baseName), vtt)
  }

  /** `Movie.en.srt` → `en`; null when the name carries no short language tag. */
  private fun languageOf(name: String): String? {
    val stem = name.substringBeforeLast('.')
    val tag = stem.substringAfterLast('.', "")
    return tag.takeIf { it.length in 2..3 && it.all(Char::isLetter) }?.lowercase(Locale.ROOT)
  }

  /** The archive's bytes in [workRoot] (one archive at a time), copied at most once per incoming file. */
  private fun localCopy(media: IncomingMedia): File {
    val target = File(workRoot, "${media.token}.zip")
    if (target.isFile && (media.sizeBytes == null || target.length() == media.sizeBytes)) return target
    clear()
    workRoot.mkdirs()
    media.sizeBytes?.let {
      if (it > MAX_ARCHIVE_BYTES) throw ArchiveRefusedException(ArchiveRefusal.TOO_LARGE, "Archive too large")
      requireRoom(it)
    }
    val input = try {
      openStream(media.uri)
    } catch (e: FileNotFoundException) {
      null
    } catch (e: SecurityException) {
      null
    } ?: throw NotFoundException("The file can no longer be read")
    val temp = File(workRoot, "${media.token}.part")
    try {
      input.use { source ->
        temp.outputStream().use { out ->
          val buffer = ByteArray(1 shl 16)
          var total = 0L
          while (true) {
            val read = source.read(buffer)
            if (read < 0) break
            total += read
            if (total > MAX_ARCHIVE_BYTES) throw ArchiveRefusedException(ArchiveRefusal.TOO_LARGE, "Archive too large")
            out.write(buffer, 0, read)
          }
        }
      }
    } catch (e: ArchiveRefusedException) {
      temp.delete()
      throw e
    } catch (e: IOException) {
      temp.delete()
      if (generateSequence<Throwable>(e) { it.cause }.any { it.message?.contains("ENOSPC") == true }) {
        throw NoSpaceException("Not enough storage left for this file")
      }
      throw StorageException("Could not copy the archive", e)
    }
    if (!temp.renameTo(target)) {
      temp.delete()
      throw StorageException("Could not keep the archive")
    }
    return target
  }

  private fun requireRoom(bytes: Long) {
    val free = runCatching { freeBytes() }.getOrDefault(Long.MAX_VALUE)
    if (free < bytes + IncomingImport.FREE_SPACE_MARGIN_BYTES) throw NoSpaceException("Not enough storage left for this file")
  }

  private fun clear() {
    workRoot.listFiles()?.forEach { it.deleteRecursively() }
  }

  companion object {
    /** The archive itself: its contents may add up to 4 GB, and a stored ZIP is a little larger than its contents. */
    const val MAX_ARCHIVE_BYTES = ZipArchive.MAX_TOTAL_BYTES + 64L * 1024 * 1024
    const val MAX_SUBTITLE_BYTES = 4L * 1024 * 1024
  }
}
