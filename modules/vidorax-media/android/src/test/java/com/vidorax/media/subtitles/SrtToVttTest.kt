package com.vidorax.media.subtitles

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SrtToVttTest {
  @Test fun `SubRip cues become WebVTT`() {
    val srt = "\uFEFF1\r\n00:00:01,500 --> 00:00:04,000\r\n<i>Hello</i>\r\nthere\r\n\r\n2\r\n00:01:02,05 --> 00:01:03,000\r\nBye\r\n"
    assertEquals(
      "WEBVTT\n\n00:00:01.500 --> 00:00:04.000\n<i>Hello</i>\nthere\n\n00:01:02.050 --> 00:01:03.000\nBye\n",
      SrtToVtt.convert(srt),
    )
  }

  @Test fun `nothing readable gives null`() {
    assertNull(SrtToVtt.convert("not subtitles at all"))
    assertNull(SrtToVtt.convert("1\n00:00:05,000 --> 00:00:01,000\nbackwards\n"))
  }
}
