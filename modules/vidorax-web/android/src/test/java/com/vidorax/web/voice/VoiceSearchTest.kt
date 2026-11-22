package com.vidorax.web.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceSearchTest {
  @Test
  fun `first non-blank transcript is trimmed`() {
    assertEquals("cat videos", VoiceSearch.firstTranscript(listOf("  cat videos  ", "cat video")))
    assertEquals("ted talks", VoiceSearch.firstTranscript(listOf("   ", null, "ted talks")))
  }

  @Test
  fun `nothing heard gives null`() {
    assertNull(VoiceSearch.firstTranscript(null))
    assertNull(VoiceSearch.firstTranscript(emptyList()))
    assertNull(VoiceSearch.firstTranscript(listOf(" ", "")))
  }

  @Test
  fun `a very long transcript is capped`() {
    assertEquals(2_000, VoiceSearch.firstTranscript(listOf("a".repeat(5_000)))!!.length)
  }
}
