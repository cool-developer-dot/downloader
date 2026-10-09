package com.vidorax.media.library

import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** SHA-256 in lowercase hex: of a finished file (duplicate detection) or of a short string (identity keys). */
internal object ContentHash {
  private const val BUFFER_BYTES = 1 shl 20

  fun sha256(file: File): String = file.inputStream().use(::sha256)

  fun sha256(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_BYTES)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      digest.update(buffer, 0, read)
    }
    return digest.digest().toHex()
  }

  fun sha256(text: String): String = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).toHex()

  private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
