package com.vidorax.media.library

/** Rules for the user-visible title of a library item. Lengths count code points, so emoji count once. */
internal object Titles {
  const val MAX_LENGTH = 200
  const val FALLBACK = "Video"

  /** A title typed by the user: cleaned, or null when empty or longer than [MAX_LENGTH]. */
  fun validate(raw: String): String? {
    val title = clean(raw)
    return title.takeIf { it.codePointCount(0, it.length) in 1..MAX_LENGTH }
  }

  /** A title from a page or a file name: cleaned and cut to [MAX_LENGTH], [FALLBACK] when nothing is left. */
  fun clamp(raw: String): String {
    val title = clean(raw)
    val length = title.codePointCount(0, title.length)
    val cut = if (length <= MAX_LENGTH) title else title.substring(0, title.offsetByCodePoints(0, MAX_LENGTH)).trim()
    return cut.ifEmpty { FALLBACK }
  }

  /** Control characters (line breaks, tabs) become spaces and runs of whitespace collapse to one space. */
  private fun clean(raw: String): String = raw.replace(CONTROL_OR_SPACE, " ").trim()

  private val CONTROL_OR_SPACE = Regex("[\\p{Cc}\\s]+")
}
