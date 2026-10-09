package com.vidorax.media.transfer

import java.io.File
import java.io.IOException

/**
 * A write to the download's own file failed: a full volume (ENOSPC), storage that went away, a folder that can no
 * longer be written. Unlike a dropped connection this is nothing to wait out, so it is kept apart from
 * `MediaNetworkException`: the engine reports ENOSPC as "not enough storage" and anything else as a storage error,
 * and the bytes already in the `.part` stay for a retry once there is room again.
 */
internal class StorageWriteException(cause: IOException) : IOException(cause.message, cause)

/** Runs one disk operation on the download's files and reports its failure as [StorageWriteException]. */
internal inline fun <T> diskWrite(block: () -> T): T =
  try {
    block()
  } catch (e: StorageWriteException) {
    throw e
  } catch (e: IOException) {
    throw StorageWriteException(e)
  }

/**
 * The resume validator (a strong ETag, else Last-Modified) of the response a `.part` was started from, kept in a
 * file beside it. A resume — after a pause, a dropped connection or a process death — sends it as `If-Range`, so a
 * resource that changed on the server is downloaded again from byte 0 instead of being spliced onto old bytes.
 * Losing it is never unsafe: a resume without `If-Range` still requires a 206 that starts exactly at the partial's
 * length, and the finished file is verified.
 */
internal object ResumeValidator {
  fun fileFor(partFile: File): File = File(partFile.path + SUFFIX)

  fun read(partFile: File): String? =
    runCatching { fileFor(partFile).takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() } }.getOrNull()

  /** Records the validator of the response now filling the `.part` from byte 0; null forgets an older one. */
  fun write(partFile: File, validator: String?) {
    runCatching {
      val file = fileFor(partFile)
      if (validator.isNullOrBlank()) file.delete() else file.writeText(validator)
    }
  }

  private const val SUFFIX = ".validator"
}

/**
 * Marks a `.part` a whole-file transfer finished, with its length, so a later run (a crash while processing, a
 * retried merge) never fetches that track again: a resume of a complete file would only get a 416 and start over.
 * A marker that no longer matches the `.part`'s length is ignored.
 */
internal object TrackDone {
  private fun fileFor(partFile: File): File = File(partFile.path + ".done")

  fun mark(partFile: File) {
    runCatching { fileFor(partFile).writeText(partFile.length().toString()) }
  }

  /** The `.part`'s length when it was marked complete and has not changed since; else null. */
  fun length(partFile: File): Long? {
    if (!partFile.isFile) return null
    val marked = runCatching { fileFor(partFile).takeIf { it.isFile }?.readText()?.trim()?.toLong() }.getOrNull() ?: return null
    return marked.takeIf { it == partFile.length() && it > 0 }
  }
}
