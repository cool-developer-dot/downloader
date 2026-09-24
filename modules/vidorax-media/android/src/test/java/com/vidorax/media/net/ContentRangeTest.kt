package com.vidorax.media.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ContentRangeTest {
  @Test
  fun parsesStartEndTotal() {
    val range = ContentRange.parse("bytes 100-199/1000")
    assertEquals(ContentRange(100, 199, 1000), range)
  }

  @Test
  fun parsesUnknownTotal() {
    val range = ContentRange.parse("bytes 0-499/*")
    assertEquals(ContentRange(0, 499, null), range)
  }

  @Test
  fun toleratesCaseAndSpacing() {
    assertEquals(ContentRange(0, 9, 10), ContentRange.parse("BYTES   0-9/10"))
  }

  @Test
  fun rejectsGarbageAndNull() {
    assertNull(ContentRange.parse(null))
    assertNull(ContentRange.parse("bytes */1000"))
    assertNull(ContentRange.parse("items 0-1/2"))
    assertNull(ContentRange.parse("bytes 200-100/1000")) // end before start
  }
}
