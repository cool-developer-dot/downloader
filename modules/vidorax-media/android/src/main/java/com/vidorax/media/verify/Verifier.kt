package com.vidorax.media.verify

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.plan.MediaSniffer
import com.vidorax.media.plan.SniffResult
import java.io.File
import java.io.RandomAccessFile

/** What the caller expects the finished file to be; both fields are optional and only checked when present. */
internal data class VerifyExpectation(
  /** The container the probe classified, if any; a mismatch means the wrong bytes landed on disk. */
  val container: Container? = null,
  /** The reliable total length (from probe's Content-Range/Content-Length), if any; catches truncation. */
  val expectedBytes: Long? = null,
)

internal sealed interface VerifyResult {
  /** The file exists, matches the expected length (when known), and its header is a complete supported container. */
  data object Valid : VerifyResult

  /**
   * @param reason the classification when the file is refused for what it *is* rather than for being damaged —
   *   [ProbeFailure.DRM_PROTECTED] for encrypted media — so the download is reported as protected, not corrupt.
   */
  data class Invalid(val detail: String, val reason: ProbeFailure? = null) : VerifyResult
}

/**
 * The last gate before a download may become COMPLETED. It inspects the actual bytes on disk — never the
 * download's promises — for length and container sanity, and refuses anything truncated, oversized, encrypted,
 * fragment-only, or not a supported container. Structural classification is shared with the probe via
 * [MediaSniffer] so "what we accept to download" and "what we accept as finished" can never drift apart.
 *
 * MPEG-TS is accepted only when the caller expects it: that is the file an HLS download assembles from TS
 * segments. An ISO-BMFF file's `moov` is found wherever it sits and checked for encrypted tracks, because the
 * header read alone cannot see a `moov` stored after the media data.
 */
internal object Verifier {
  private const val HEADER_BYTES = 64 * 1024

  /** A moov is metadata; anything larger than this is not scanned further (the header check still applies). */
  private const val MAX_MOOV_SCAN = 8L * 1024 * 1024
  private const val MAX_TOP_LEVEL_BOXES = 4096
  private val ENCRYPTION_BOXES = listOf("encv", "enca", "sinf", "tenc", "pssh")

  fun verify(file: File, expectation: VerifyExpectation = VerifyExpectation()): VerifyResult {
    if (!file.exists()) return VerifyResult.Invalid("file does not exist")
    val length = file.length()
    if (length <= 0L) return VerifyResult.Invalid("file is empty")

    expectation.expectedBytes?.let { expected ->
      if (expected > 0L && length != expected) {
        val kind = if (length < expected) "truncated" else "oversized"
        return VerifyResult.Invalid("$kind file: $length bytes on disk, expected $expected")
      }
    }

    val header = readHeader(file)
    val verdict = MediaSniffer.sniff(
      header,
      contentType = null,
      url = file.name,
      totalSize = length,
      allowTransportStream = expectation.container == Container.TS,
    )
    return when (verdict) {
      is SniffResult.Supported -> {
        val expected = expectation.container
        when {
          expected != null && verdict.container != expected ->
            VerifyResult.Invalid("container mismatch: expected ${expected.wire}, file is ${verdict.container.wire}")
          isIsoBmff(verdict.container) && hasEncryptedTracks(file) ->
            VerifyResult.Invalid("encrypted (DRM) tracks in moov", ProbeFailure.DRM_PROTECTED)
          else -> VerifyResult.Valid
        }
      }
      is SniffResult.Unsupported -> VerifyResult.Invalid(
        "failed container validation: ${verdict.detail}",
        verdict.reason.takeIf { it == ProbeFailure.DRM_PROTECTED },
      )
    }
  }

  private fun isIsoBmff(container: Container): Boolean =
    container == Container.MP4 || container == Container.MOV || container == Container.THREE_G2

  /** Walks the top-level boxes of the finished file (seeks only) and scans the `moov` for encryption boxes. */
  private fun hasEncryptedTracks(file: File): Boolean = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      val length = raf.length()
      val header = ByteArray(16)
      var offset = 0L
      var boxes = 0
      while (offset + 8 <= length && boxes < MAX_TOP_LEVEL_BOXES) {
        raf.seek(offset)
        raf.readFully(header, 0, 8)
        var size = beU32(header, 0)
        var headerSize = 8
        when (size) {
          0L -> size = length - offset
          1L -> {
            if (offset + 16 > length) return@use false
            raf.readFully(header, 8, 8)
            size = beU64(header, 8)
            headerSize = 16
          }
        }
        if (size < headerSize) return@use false
        if (String(header, 4, 4, Charsets.ISO_8859_1) == "moov") {
          val toRead = minOf(size - headerSize, MAX_MOOV_SCAN, length - offset - headerSize).toInt()
          val moov = ByteArray(maxOf(toRead, 0))
          raf.readFully(moov)
          return@use ENCRYPTION_BOXES.any { containsAscii(moov, it) }
        }
        offset += size
        boxes += 1
      }
      false
    }
  }.getOrDefault(false)

  private fun readHeader(file: File): ByteArray {
    val toRead = minOf(HEADER_BYTES.toLong(), file.length()).toInt()
    val buffer = ByteArray(toRead)
    RandomAccessFile(file, "r").use { raf ->
      raf.seek(0)
      raf.readFully(buffer)
    }
    return buffer
  }

  private fun containsAscii(data: ByteArray, needle: String): Boolean {
    val target = needle.toByteArray(Charsets.ISO_8859_1)
    outer@ for (i in 0..data.size - target.size) {
      for (j in target.indices) if (data[i + j] != target[j]) continue@outer
      return true
    }
    return false
  }

  private fun beU32(data: ByteArray, offset: Int): Long =
    ((data[offset].toLong() and 0xFF) shl 24) or ((data[offset + 1].toLong() and 0xFF) shl 16) or
      ((data[offset + 2].toLong() and 0xFF) shl 8) or (data[offset + 3].toLong() and 0xFF)

  private fun beU64(data: ByteArray, offset: Int): Long {
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (data[offset + i].toLong() and 0xFF)
    return v
  }
}
