package com.vidorax.media.subtitles

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** H19: one WebVTT file from HLS WebVTT segments. */
class WebVttTest {
  @Test fun timestampsBothWays() {
    assertEquals(62_345L, WebVtt.parseTime("01:02.345"))
    assertEquals(3_723_004L, WebVtt.parseTime("1:02:03.004"))
    assertNull(WebVtt.parseTime("01:02,345"))
    assertNull(WebVtt.parseTime("01:61.000"))
    assertEquals("01:02:03.004", WebVtt.formatTime(3_723_004))
    assertEquals("00:00:00.000", WebVtt.formatTime(-5))
  }

  @Test fun segmentsWithTheSameMapAreJoinedAsTheyAre() {
    val first = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:01.000 --> 00:00:02.000\nOne\n"
    val second = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:07.000 --> 00:00:08.000 line:90%\nTwo\nlines\n"
    assertEquals(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOne\n\n00:00:07.000 --> 00:00:08.000 line:90%\nTwo\nlines\n",
      WebVtt.assemble(listOf(first, second)),
    )
  }

  @Test fun aSegmentWithAnotherMapIsMovedByTheDifference() {
    val first = "WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:01.000 --> 00:00:02.000\nA\n"
    // 6 s later on the MPEG-TS clock, cue times restarting at 0 locally.
    val second = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:1440000,LOCAL:00:00:00.000\n\n00:00:00.500 --> 00:00:01.000\nB\n"
    val cues = WebVtt.cues(WebVtt.assemble(listOf(first, second))!!)
    assertEquals(listOf(1_000L, 6_500L), cues.map { it.startMs })
  }

  @Test fun aCueRepeatedAcrossASegmentBoundaryIsKeptOnce() {
    val cue = "00:00:05.000 --> 00:00:07.000\nAcross\n"
    val joined = WebVtt.assemble(listOf("WEBVTT\n\n$cue", "WEBVTT\n\n$cue\n00:00:08.000 --> 00:00:09.000\nNext\n"))!!
    assertEquals(2, WebVtt.cues(joined).size)
  }

  @Test fun bomCrlfNotesAndStylesAreHandled() {
    val text = "\uFEFFWEBVTT\r\n\r\nNOTE hi\r\n\r\nSTYLE\r\n::cue{}\r\n\r\nid-1\r\n00:01.000 --> 00:02.000\r\nHi\r\n"
    assertTrue(WebVtt.isWebVtt(text))
    assertEquals(listOf("Hi"), WebVtt.cues(text).single().text)
    assertNull("no WebVTT segment at all", WebVtt.assemble(listOf("<html>", "")))
    assertFalse(WebVtt.isWebVtt("1\n00:00:01,000 --> 00:00:02,000\nSRT"))
  }
}
