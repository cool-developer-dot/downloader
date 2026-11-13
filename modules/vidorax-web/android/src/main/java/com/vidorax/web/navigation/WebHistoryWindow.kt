package com.vidorax.web.navigation

/**
 * B6 #44: the part of a WebView's back/forward list sent to JS — at most [MAX_BACK] entries before the current one
 * (what Long-press Back lists) and [MAX_FORWARD] after it. Indices stay relative, so JS turns an entry into
 * `goBackOrForward(index - currentIndex)`. Pure (JVM-tested).
 */
internal object WebHistoryWindow {
  const val MAX_BACK = 40
  const val MAX_FORWARD = 9

  data class Entry(val url: String, val title: String)

  data class Window(val currentIndex: Int, val entries: List<Entry>)

  /** [size] entries, [current] the shown one (-1 when the list is empty); [entryAt] reads one. */
  fun of(size: Int, current: Int, entryAt: (Int) -> Entry): Window {
    if (size <= 0 || current !in 0 until size) return Window(-1, emptyList())
    val start = maxOf(0, current - MAX_BACK)
    val end = minOf(size - 1, current + MAX_FORWARD)
    return Window(current - start, (start..end).map(entryAt))
  }
}
