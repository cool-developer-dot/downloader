package com.vidorax.media.library

import com.vidorax.media.model.Container

internal data class MediaType(val mimeType: String, val container: Container, val extension: String) {
  val isAudioOnly: Boolean get() = mimeType.startsWith("audio/")
}

/** Media file types, independent of the device's MimeTypeMap so results are identical everywhere. */
internal object MediaTypes {
  private val MP4 = MediaType("video/mp4", Container.MP4, "mp4")
  private val WEBM = MediaType("video/webm", Container.WEBM, "webm")
  private val MOV = MediaType("video/quicktime", Container.MOV, "mov")
  private val AVI = MediaType("video/x-msvideo", Container.AVI, "avi")
  private val WMV = MediaType("video/x-ms-wmv", Container.WMV, "wmv")
  private val MKV = MediaType("video/x-matroska", Container.MKV, "mkv")
  private val TS = MediaType("video/mp2t", Container.TS, "ts")
  private val FLV = MediaType("video/x-flv", Container.FLV, "flv")
  private val THREE_GP = MediaType("video/3gpp", Container.THREE_GP, "3gp")
  private val THREE_G2 = MediaType("video/3gpp2", Container.THREE_G2, "3g2")
  private val M4A = MediaType("audio/mp4", Container.MP4, "m4a")
  private val MP3 = MediaType("audio/mpeg", Container.UNKNOWN, "mp3")
  private val AAC = MediaType("audio/aac", Container.UNKNOWN, "aac")
  private val WAV = MediaType("audio/wav", Container.UNKNOWN, "wav")
  private val OGG = MediaType("audio/ogg", Container.UNKNOWN, "ogg")

  private val ALL = listOf(MP4, WEBM, MOV, AVI, WMV, MKV, TS, FLV, THREE_GP, THREE_G2, M4A, MP3, AAC, WAV, OGG)

  private val byExtension: Map<String, MediaType> =
    // F4V is ISO-BMFF (Flash's MP4 profile) and DivX/XviD files are AVI: both are named by the container they hold.
    ALL.associateBy { it.extension } + mapOf("m4v" to MP4, "f4v" to MP4, "divx" to AVI, "opus" to OGG)

  // First video type per container; the engine uses this to name and label a finished progressive file.
  private val byContainer: Map<Container, MediaType> =
    ALL.filterNot { it.isAudioOnly }.associateBy { it.container }

  // Aliases are the spellings MediaMetadataRetriever and servers report for the same containers.
  private val byMimeType: Map<String, MediaType> =
    ALL.associateBy { it.mimeType } +
      mapOf(
        "video/mp2ts" to TS,
        "video/x-m4v" to MP4,
        "video/x-f4v" to MP4,
        "video/divx" to AVI,
        "video/x-divx" to AVI,
        "video/matroska" to MKV,
        "audio/x-m4a" to M4A,
        "audio/x-wav" to WAV,
        "audio/webm" to WEBM,
      )

  /** Null when the file name has no known audio or video extension. */
  fun forFileName(name: String): MediaType? = byExtension[extensionOf(name)]

  /** The canonical video media type for a container, or null for UNKNOWN/audio-only containers. */
  fun forContainer(container: Container): MediaType? = byContainer[container]

  /** Null for unknown or non-media MIME types. Parameters such as `; codecs=...` are ignored. */
  fun forMimeType(mimeType: String): MediaType? =
    byMimeType[mimeType.substringBefore(';').trim().lowercase()]

  /**
   * The MIME type a library file is recorded with. The container proven from the file's own bytes decides: the
   * platform's [reported] type is only the fallback for a container VidoraX does not know, because
   * MediaMetadataRetriever calls every ISO-BMFF file `video/mp4` — a QuickTime MOV included — which would label it
   * MP4 in the library and publish its gallery copy with the wrong type. An audio type is kept as reported (a v1
   * audio import is not a video).
   */
  fun libraryMimeType(container: Container, reported: String?): String? {
    val clean = reported?.substringBefore(';')?.trim()?.lowercase()?.ifEmpty { null }
    if (clean != null && clean.startsWith("audio/")) return clean
    return forContainer(container)?.mimeType ?: clean
  }

  /** Every MIME type (and server/OS alias) that names a video container VidoraX can play. */
  val videoMimeTypes: Set<String> =
    byMimeType.filterValues { !it.isAudioOnly }.keys.toSet()

  /**
   * Whether a file already on the device is one VidoraX supports. The MIME type decides when the device
   * reports a real one; otherwise the file name does, because some files are stored as octet-stream.
   */
  fun isSupportedVideo(mimeType: String?, fileName: String?): Boolean {
    val byMime = mimeType?.takeIf { it.isNotBlank() }?.let { forMimeType(it) }
    if (byMime != null) return !byMime.isAudioOnly
    if (mimeType != null && mimeType.startsWith("audio/")) return false
    val byName = fileName?.takeIf { it.isNotBlank() }?.let { forFileName(it) }
    return byName != null && !byName.isAudioOnly
  }

  fun extensionOf(name: String): String = name.substringAfterLast('.', missingDelimiterValue = "").lowercase()
}
