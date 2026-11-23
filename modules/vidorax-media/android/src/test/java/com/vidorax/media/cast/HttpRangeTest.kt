package com.vidorax.media.cast

import org.junit.Assert.assertEquals
import org.junit.Test

class HttpRangeTest {
  private val length = 1_000L

  @Test fun noHeaderIsTheWholeFile() {
    assertEquals(HttpRange.Whole, HttpRange.parse(null, length))
  }

  @Test fun aClosedRangeIsServedAsAsked() {
    assertEquals(HttpRange.Part(0, 99), HttpRange.parse("bytes=0-99", length))
    assertEquals(HttpRange.Part(500, 500), HttpRange.parse("bytes=500-500", length))
  }

  @Test fun anOpenRangeRunsToTheEnd() {
    assertEquals(HttpRange.Part(200, 999), HttpRange.parse("bytes=200-", length))
  }

  @Test fun anEndPastTheFileIsCutToTheLastByte() {
    assertEquals(HttpRange.Part(900, 999), HttpRange.parse("bytes=900-5000", length))
  }

  @Test fun aSuffixRangeIsTheLastBytes() {
    assertEquals(HttpRange.Part(900, 999), HttpRange.parse("bytes=-100", length))
    assertEquals(HttpRange.Part(0, 999), HttpRange.parse("bytes=-5000", length))
  }

  @Test fun partLengthCountsBothEnds() {
    assertEquals(100L, HttpRange.Part(0, 99).length)
  }

  @Test fun aStartAtOrPastTheEndIsUnsatisfiable() {
    assertEquals(HttpRange.Unsatisfiable, HttpRange.parse("bytes=1000-", length))
    assertEquals(HttpRange.Unsatisfiable, HttpRange.parse("bytes=5000-6000", length))
    assertEquals(HttpRange.Unsatisfiable, HttpRange.parse("bytes=-0", length))
    assertEquals(HttpRange.Unsatisfiable, HttpRange.parse("bytes=0-", 0))
  }

  @Test fun headersThatAreNotOneByteRangeAreIgnored() {
    for (header in listOf("", "items=0-10", "bytes=", "bytes=0-10,20-30", "bytes=abc-", "bytes=10-5", "bytes=1-2-3", "bytes=--5")) {
      assertEquals(header, HttpRange.Whole, HttpRange.parse(header, length))
    }
  }

  @Test fun spacesAndCaseAreTolerated() {
    assertEquals(HttpRange.Part(10, 20), HttpRange.parse(" Bytes= 10 - 20 ", length))
  }
}
