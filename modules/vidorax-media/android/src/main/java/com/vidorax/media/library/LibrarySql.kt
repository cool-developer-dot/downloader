package com.vidorax.media.library

import com.vidorax.media.model.AdjacentItems
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.LibrarySort

/** A `WHERE` clause (empty when unfiltered) with its positional arguments. */
internal data class SqlFilter(val clause: String, val args: List<String>)

/** SQL fragments for library queries, kept free of Android types so they are unit tested on the JVM. */
internal object LibrarySql {
  /** Stays under SQLITE_MAX_VARIABLE_NUMBER (999) of the SQLite shipped with API 24-29. */
  const val MAX_BOUND_ARGS = 500

  fun filter(query: LibraryQuery): SqlFilter {
    val conditions = mutableListOf<String>()
    val args = mutableListOf<String>()
    val search = query.search?.trim().orEmpty()
    if (search.isNotEmpty()) {
      conditions += "title LIKE ? ESCAPE '\\'"
      args += "%${escapeLike(search)}%"
    }
    query.site?.let {
      conditions += "site = ?"
      args += it.wire
    }
    if (query.favoritesOnly) {
      conditions += "favorite = 1"
    }
    val clause = if (conditions.isEmpty()) "" else conditions.joinToString(" AND ", prefix = "WHERE ")
    return SqlFilter(clause, args)
  }

  /** Makes `%`, `_` and the escape character itself match literally in a `LIKE ... ESCAPE '\'` pattern. */
  fun escapeLike(text: String): String = buildString(text.length) {
    for (char in text) {
      if (char == '\\' || char == '%' || char == '_') append('\\')
      append(char)
    }
  }

  /** Every order ends with a unique key so paging and next/previous are stable. */
  fun orderBy(sort: LibrarySort): String = when (sort) {
    LibrarySort.NEWEST -> "completed_at DESC, id DESC"
    LibrarySort.OLDEST -> "completed_at ASC, id ASC"
    // LOCALIZED is Android's ICU collator for the device locale: case- and accent-insensitive in every script.
    LibrarySort.TITLE -> "title COLLATE LOCALIZED ASC, completed_at DESC, id DESC"
    LibrarySort.LARGEST -> "size_bytes DESC, completed_at DESC, id DESC"
    // SQLite sorts NULL lowest, so items without a duration come last.
    LibrarySort.LONGEST -> "duration_ms DESC, completed_at DESC, id DESC"
  }

  /** `?, ?, ?` for an `IN (...)` list of [count] arguments. */
  fun placeholders(count: Int): String = List(count) { "?" }.joinToString(", ")

  /** The ids either side of [id] in [orderedIds], reading no further than the one after it. */
  fun neighbours(orderedIds: Iterator<String>, id: String): AdjacentItems {
    var previous: String? = null
    while (orderedIds.hasNext()) {
      val current = orderedIds.next()
      if (current == id) {
        return AdjacentItems(previous, if (orderedIds.hasNext()) orderedIds.next() else null)
      }
      previous = current
    }
    return AdjacentItems(previous = null, next = null)
  }
}
