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
  private val MKV = MediaType("video/x-matroska", Container.MKV, "mkv")
  private val TS = MediaType("video/mp2t", Container.TS, "ts")
  private val FLV = MediaType("video/x-flv", Container.FLV, "flv")
  private val THREE_GP = MediaType("video/3gpp", Container.THREE_GP, "3gp")
  private val M4A = MediaType("audio/mp4", Container.MP4, "m4a")
  private val MP3 = MediaType("audio/mpeg", Container.UNKNOWN, "mp3")
  private val AAC = MediaType("audio/aac", Container.UNKNOWN, "aac")
  private val WAV = MediaType("audio/wav", Container.UNKNOWN, "wav")
  private val OGG = MediaType("audio/ogg", Container.UNKNOWN, "ogg")

  private val ALL = listOf(MP4, WEBM, MOV, MKV, TS, FLV, THREE_GP, M4A, MP3, AAC, WAV, OGG)

  private val byExtension: Map<String, MediaType> =
    ALL.associateBy { it.extension } + mapOf("m4v" to MP4, "opus" to OGG)

  // Aliases are the spellings MediaMetadataRetriever and servers report for the same containers.
  private val byMimeType: Map<String, MediaType> =
    ALL.associateBy { it.mimeType } +
      mapOf(
        "video/mp2ts" to TS,
        "video/x-m4v" to MP4,
        "video/matroska" to MKV,
        "audio/x-m4a" to M4A,
        "audio/x-wav" to WAV,
        "audio/webm" to WEBM,
      )

  /** Null when the file name has no known audio or video extension. */
  fun forFileName(name: String): MediaType? = byExtension[extensionOf(name)]

  /** Null for unknown or non-media MIME types. Parameters such as `; codecs=...` are ignored. */
  fun forMimeType(mimeType: String): MediaType? =
    byMimeType[mimeType.substringBefore(';').trim().lowercase()]

  fun extensionOf(name: String): String = name.substringAfterLast('.', missingDelimiterValue = "").lowercase()
}
