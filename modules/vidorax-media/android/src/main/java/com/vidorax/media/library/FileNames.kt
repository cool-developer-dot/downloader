package com.vidorax.media.library

/** File and folder names derived from untrusted titles and ids. */
internal object FileNames {
  /** Leaves room for "_<shortId>-<n>.<ext>" within the 255-byte file name limit of ext4 and FAT. */
  private const val MAX_TITLE_BYTES = 150
  private const val FALLBACK_TITLE = "Video"
  private const val SHORT_ID_LENGTH = 8
  private const val MAX_ID_LENGTH = 120
  private const val KEPT_PUNCTUATION = "-_.,()[]'!&+"

  /** `<Safe Title>_<shortId>.<ext>`, or `<Safe Title>_<shortId>-<copy>.<ext>` when [copy] is above 1. */
  fun libraryFileName(title: String, id: String, extension: String, copy: Int = 1): String {
    val suffix = if (copy > 1) "-$copy" else ""
    return "${safeTitle(title)}_${shortId(id)}$suffix.${safeExtension(extension)}"
  }

  /**
   * Keeps letters and digits of every script (with their combining marks), spaces and a little punctuation;
   * everything else becomes a space. Never empty, never hidden, at most [MAX_TITLE_BYTES] UTF-8 bytes.
   */
  fun safeTitle(title: String): String {
    val replaced = StringBuilder(title.length)
    var index = 0
    while (index < title.length) {
      val codePoint = title.codePointAt(index)
      if (isKept(codePoint)) replaced.appendCodePoint(codePoint) else replaced.append(' ')
      index += Character.charCount(codePoint)
    }
    val collapsed = replaced.toString().replace(WHITESPACE, " ").trimSpacesAndDots()
    return truncateUtf8(collapsed, MAX_TITLE_BYTES).trimSpacesAndDots().ifEmpty { FALLBACK_TITLE }
  }

  /** The last ASCII letters and digits of an id: unique enough next to a title, stable for the same id. */
  fun shortId(id: String): String =
    id.filter { it.isAsciiLetterOrDigit() }.takeLast(SHORT_ID_LENGTH).ifEmpty { "item" }

  /** An id usable as a single path segment (thumbnail and work folder names). */
  fun safeId(id: String): String =
    id.map { if (it.isAsciiLetterOrDigit() || it == '-' || it == '_') it else '_' }
      .joinToString("")
      .take(MAX_ID_LENGTH)
      .ifEmpty { "item" }

  fun safeExtension(extension: String): String =
    extension.trim().trimStart('.').lowercase().filter { it.isAsciiLetterOrDigit() }.take(5).ifEmpty { "bin" }

  private fun isKept(codePoint: Int): Boolean =
    Character.isLetterOrDigit(codePoint) ||
      Character.getType(codePoint).toByte() in MARK_TYPES ||
      codePoint == ' '.code ||
      (codePoint < 128 && KEPT_PUNCTUATION.indexOf(codePoint.toChar()) >= 0)

  private fun truncateUtf8(text: String, maxBytes: Int): String {
    var bytes = 0
    var end = 0
    while (end < text.length) {
      val codePoint = text.codePointAt(end)
      bytes += utf8Length(codePoint)
      if (bytes > maxBytes) break
      end += Character.charCount(codePoint)
    }
    return text.substring(0, end)
  }

  private fun utf8Length(codePoint: Int): Int = when {
    codePoint < 0x80 -> 1
    codePoint < 0x800 -> 2
    codePoint < 0x10000 -> 3
    else -> 4
  }

  private fun Char.isAsciiLetterOrDigit(): Boolean = this in 'a'..'z' || this in 'A'..'Z' || this in '0'..'9'

  private fun String.trimSpacesAndDots(): String = trim { it == ' ' || it == '.' }

  private val WHITESPACE = Regex("\\s+")

  private val MARK_TYPES = setOf(
    Character.NON_SPACING_MARK,
    Character.COMBINING_SPACING_MARK,
    Character.ENCLOSING_MARK,
  )
}
