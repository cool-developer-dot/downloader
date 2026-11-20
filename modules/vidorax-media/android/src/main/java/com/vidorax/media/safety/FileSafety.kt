package com.vidorax.media.safety

import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.InputStream

/** `importIncomingMedia`: the file's bytes are a program or an archive, not a video (P8 #461). */
class UnsafeFileException(val kind: ContentKind) :
  CodedException("ERR_UNSAFE_FILE", "This file is not a video: it is ${kind.wire}", null)

/** P8 #461: [ContentSniff] applied to files on the device (a library file, an incoming file). */
object FileSafety {
  fun prefixOf(file: File): ByteArray? = runCatching { file.inputStream().use { prefixOf(it) } }.getOrNull()

  fun prefixOf(input: InputStream): ByteArray {
    val buffer = ByteArray(ContentSniff.PREFIX_BYTES)
    var total = 0
    while (total < buffer.size) {
      val read = input.read(buffer, total, buffer.size - total)
      if (read <= 0) break
      total += read
    }
    return buffer.copyOf(total)
  }

  fun check(file: File, name: String?): FileSafetyVerdict = ContentSniff.assess(name ?: file.name, prefixOf(file))

  fun FileSafetyVerdict.toJs(): Map<String, Any?> = mapOf(
    "risky" to risky,
    "reason" to reason?.wire,
    "detected" to detected?.wire,
  )
}
