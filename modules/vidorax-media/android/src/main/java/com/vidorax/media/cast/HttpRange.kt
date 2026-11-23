package com.vidorax.media.cast

/**
 * P13 #667: one `Range: bytes=…` request header against a file of [length] bytes (RFC 9110 §14). Pure, so it is unit
 * tested. Only single byte ranges are served; a TV's player never asks for more than one at a time.
 */
sealed class HttpRange {
  /** No (usable) Range header: the whole file, 200. */
  object Whole : HttpRange()

  /** Bytes [start]..[endInclusive], 206 with `Content-Range`. */
  data class Part(val start: Long, val endInclusive: Long) : HttpRange() {
    val length: Long get() = endInclusive - start + 1
  }

  /** A range that starts past the end (or of an empty file): 416 with `Content-Range: bytes *\/length`. */
  object Unsatisfiable : HttpRange()

  companion object {
    /**
     * - `bytes=a-b` → a..min(b, length-1); `bytes=a-` → a..end; `bytes=-n` → the last n bytes.
     * - A header that isn't a single, well-formed byte range is ignored (the whole file), as RFC 9110 allows.
     * - A start at or past the end, or a suffix of 0, is unsatisfiable.
     */
    fun parse(header: String?, length: Long): HttpRange {
      if (header == null) return Whole
      val value = header.trim()
      if (!value.startsWith("bytes=", ignoreCase = true)) return Whole
      val spec = value.substring("bytes=".length).trim()
      if (spec.isEmpty() || spec.contains(',')) return Whole
      val dash = spec.indexOf('-')
      if (dash < 0 || dash != spec.lastIndexOf('-')) return Whole
      val first = spec.substring(0, dash).trim()
      val last = spec.substring(dash + 1).trim()
      if (first.isEmpty()) {
        val suffix = last.toLongStrict() ?: return Whole
        if (suffix <= 0L || length <= 0L) return Unsatisfiable
        return Part(maxOf(0L, length - suffix), length - 1)
      }
      val start = first.toLongStrict() ?: return Whole
      val end = if (last.isEmpty()) null else (last.toLongStrict() ?: return Whole)
      if (end != null && end < start) return Whole
      if (start >= length) return Unsatisfiable
      return Part(start, minOf(end ?: (length - 1), length - 1))
    }

    private fun String.toLongStrict(): Long? =
      if (isNotEmpty() && length <= 18 && all { it in '0'..'9' }) toLong() else null
  }
}
