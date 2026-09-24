package com.vidorax.media.net

/**
 * A parsed `Content-Range: bytes <start>-<end>/<total>` response header. `total` is null when the server sends
 * `*` for an unknown instance length. Used to prove a 206 response actually continues from the offset we asked
 * for before any bytes are appended to a partial file.
 */
internal data class ContentRange(val start: Long, val end: Long, val total: Long?) {
  companion object {
    private val PATTERN = Regex("""bytes\s+(\d+)-(\d+)/(\d+|\*)""", RegexOption.IGNORE_CASE)

    fun parse(header: String?): ContentRange? {
      val match = PATTERN.matchEntire(header?.trim().orEmpty()) ?: return null
      val start = match.groupValues[1].toLongOrNull() ?: return null
      val end = match.groupValues[2].toLongOrNull() ?: return null
      if (end < start) return null
      val totalToken = match.groupValues[3]
      val total = if (totalToken == "*") null else totalToken.toLongOrNull()
      return ContentRange(start, end, total)
    }
  }
}
