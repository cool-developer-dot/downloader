package com.vidorax.media.process

import java.io.File
import java.io.RandomAccessFile

/**
 * The stream list of an AVI (DivX/XviD) file's own header. Media3 leaves out a stream whose codec it cannot name (DivX
 * 3 / `DIV3`, for example), so "Media3 read no video track" does not mean the file has none.
 */
internal object AviHeader {
  /** The header list is at the start; a stream header beyond this is not a normal AVI. */
  private const val HEADER_SCAN_BYTES = 64 * 1024

  /** Whether the AVI header declares a video stream (`strh` with type `vids`). False for anything unreadable. */
  fun declaresVideoStream(file: File): Boolean = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      val bytes = ByteArray(minOf(raf.length(), HEADER_SCAN_BYTES.toLong()).toInt())
      raf.readFully(bytes)
      if (bytes.size < 12 || ascii(bytes, 0) != "RIFF" || ascii(bytes, 8) != "AVI ") return false
      var i = 12
      while (i + 12 <= bytes.size) {
        // A stream header chunk: 'strh', 4-byte size, then the stream type.
        if (ascii(bytes, i) == "strh" && ascii(bytes, i + 8) == "vids") return true
        i++
      }
      false
    }
  }.getOrDefault(false)

  private fun ascii(bytes: ByteArray, offset: Int): String = String(bytes, offset, 4, Charsets.ISO_8859_1)
}
