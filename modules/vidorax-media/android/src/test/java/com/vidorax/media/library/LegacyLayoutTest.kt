package com.vidorax.media.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyLayoutTest {
  private fun entry(name: String, size: Long = 100) = LegacyLayout.Entry(name, size)

  @Test
  fun picksTheFinishedMediaFile() {
    assertEquals(entry("clip.mp4"), LegacyLayout.mediaCandidate(listOf(entry("clip.mp4"), entry("cover.jpg", 500))))
  }

  @Test
  fun ignoresUnfinishedTransfers() {
    assertNull(LegacyLayout.mediaCandidate(listOf(entry("clip.mp4.part"))))
    assertNull(LegacyLayout.mediaCandidate(listOf(entry("clip.mp4"), entry("clip.mp4.part"))))
    assertNull(LegacyLayout.mediaCandidate(listOf(entry("clip.mp4"), entry("clip.mp4.rangepart"))))
    assertNull(LegacyLayout.mediaCandidate(listOf(entry("clip.mp4", size = 0))))
    assertNull(LegacyLayout.mediaCandidate(listOf(entry(".hidden.mp4"))))
  }

  @Test
  fun prefersKnownMediaAndOtherwiseOffersUnknownExtensions() {
    assertEquals(
      entry("clip.webm", 10),
      LegacyLayout.mediaCandidate(listOf(entry("download.bin", 900), entry("clip.webm", 10))),
    )
    assertEquals(
      entry("download.bin"),
      LegacyLayout.mediaCandidate(listOf(entry("download.bin"), entry("page.pdf", 900))),
    )
  }

  @Test
  fun recognisesTransferLeftovers() {
    assertTrue(LegacyLayout.isTransferLeftover(".hls", isDirectory = true))
    assertTrue(LegacyLayout.isTransferLeftover(".mranges", isDirectory = true))
    assertTrue(LegacyLayout.isTransferLeftover("clip.mp4.part", isDirectory = false))
    assertTrue(LegacyLayout.isTransferLeftover("segment-000001.tmp", isDirectory = false))
    assertFalse(LegacyLayout.isTransferLeftover("clip.mp4", isDirectory = false))
    assertFalse(LegacyLayout.isTransferLeftover("photos", isDirectory = true))
  }

  @Test
  fun titleComesFromTheFileName() {
    assertEquals("My funny cat", LegacyLayout.titleFromFileName("My_funny__cat.mp4"))
    assertEquals(Titles.FALLBACK, LegacyLayout.titleFromFileName(".mp4"))
  }
}
