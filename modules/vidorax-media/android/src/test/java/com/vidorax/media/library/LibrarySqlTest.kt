package com.vidorax.media.library

import com.vidorax.media.model.AdjacentItems
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.LibrarySort
import com.vidorax.media.model.SiteId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibrarySqlTest {
  @Test
  fun unfilteredQueryHasNoWhereClause() {
    assertEquals(SqlFilter("", emptyList()), LibrarySql.filter(LibraryQuery()))
    assertEquals(SqlFilter("", emptyList()), LibrarySql.filter(LibraryQuery(search = "   ")))
  }

  @Test
  fun combinesSearchSiteAndFavorites() {
    val filter = LibrarySql.filter(LibraryQuery(search = " cat ", site = SiteId.TIKTOK, favoritesOnly = true))

    assertEquals("WHERE title LIKE ? ESCAPE '\\' AND site = ? AND favorite = 1", filter.clause)
    assertEquals(listOf("%cat%", "tiktok"), filter.args)
  }

  @Test
  fun searchMatchesWildcardsLiterally() {
    assertEquals("100\\% \\_off\\\\", LibrarySql.escapeLike("100% _off\\"))
    assertEquals(listOf("%50\\%%"), LibrarySql.filter(LibraryQuery(search = "50%")).args)
  }

  @Test
  fun sortsMapToColumns() {
    assertEquals("completed_at DESC, id DESC", LibrarySql.orderBy(LibrarySort.NEWEST))
    assertEquals("completed_at ASC, id ASC", LibrarySql.orderBy(LibrarySort.OLDEST))
    assertTrue(LibrarySql.orderBy(LibrarySort.TITLE).startsWith("title COLLATE LOCALIZED ASC, "))
    assertTrue(LibrarySql.orderBy(LibrarySort.LARGEST).startsWith("size_bytes DESC, "))
    assertTrue(LibrarySql.orderBy(LibrarySort.LONGEST).startsWith("duration_ms DESC, "))
  }

  @Test
  fun everySortEndsWithTheUniqueId() {
    for (sort in LibrarySort.values()) {
      assertTrue(sort.name, LibrarySql.orderBy(sort).matches(Regex(".*, id (ASC|DESC)")))
    }
  }

  @Test
  fun placeholdersMatchTheArgumentCount() {
    assertEquals("?", LibrarySql.placeholders(1))
    assertEquals("?, ?, ?", LibrarySql.placeholders(3))
  }

  @Test
  fun neighboursFollowTheOrder() {
    val ids = listOf("a", "b", "c")

    assertEquals(AdjacentItems(previous = null, next = "b"), LibrarySql.neighbours(ids.iterator(), "a"))
    assertEquals(AdjacentItems(previous = "a", next = "c"), LibrarySql.neighbours(ids.iterator(), "b"))
    assertEquals(AdjacentItems(previous = "b", next = null), LibrarySql.neighbours(ids.iterator(), "c"))
    assertEquals(AdjacentItems(previous = null, next = null), LibrarySql.neighbours(ids.iterator(), "gone"))
  }

  @Test
  fun neighboursStopReadingAfterTheNextId() {
    val read = mutableListOf<String>()
    val ids = sequenceOf("a", "b", "c", "d").onEach { read += it }.iterator()

    LibrarySql.neighbours(ids, "b")

    assertEquals(listOf("a", "b", "c"), read)
  }
}
