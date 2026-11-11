package com.vidorax.media.engine

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #315: segments done / total for a download's progress events, read from its checkpoints at a bounded pace. */
class SegmentCountsTest {
  private var clock = 1_000L
  private val completed = HashMap<String, Int?>()
  private var reads = 0

  private val counts = SegmentCounts(now = { clock }) { file ->
    reads += 1
    completed[file.name]
  }

  private val video = File("hls.checkpoint")
  private val audio = File("audio.checkpoint")

  @Test fun aDownloadWithoutSegmentTracksHasNoCounts() {
    assertNull(counts.of("dl"))
    counts.track("dl", emptyList())
    assertNull(counts.of("dl"))
    counts.track("dl", listOf(SegmentCounts.Track(video, 0)))
    assertNull("a plan without segments counts nothing", counts.of("dl"))
  }

  @Test fun videoAndAudioTracksAreCountedTogether() {
    completed["hls.checkpoint"] = 12
    completed["audio.checkpoint"] = 30
    counts.track("dl", listOf(SegmentCounts.Track(video, 100), SegmentCounts.Track(audio, 120)))
    assertEquals(42 to 220, counts.of("dl"))
  }

  @Test fun aMissingOrUnreadableCheckpointIsZeroAndDoneNeverExceedsTotal() {
    completed["hls.checkpoint"] = null
    counts.track("dl", listOf(SegmentCounts.Track(video, 10)))
    assertEquals(0 to 10, counts.of("dl"))

    completed["hls.checkpoint"] = 99
    clock += SegmentCounts.REFRESH_MS
    assertEquals(10 to 10, counts.of("dl"))

    completed["hls.checkpoint"] = -3
    clock += SegmentCounts.REFRESH_MS
    assertEquals(0 to 10, counts.of("dl"))
  }

  @Test fun checkpointsAreReadAtMostOncePerRefreshInterval() {
    completed["hls.checkpoint"] = 1
    counts.track("dl", listOf(SegmentCounts.Track(video, 10)))
    repeat(50) { counts.of("dl") } // many progress samples in the same instant
    assertEquals(1, reads)

    completed["hls.checkpoint"] = 2
    clock += SegmentCounts.REFRESH_MS - 1
    assertEquals("still the value read a moment ago", 1 to 10, counts.of("dl"))
    clock += 1
    assertEquals(2 to 10, counts.of("dl"))
    assertEquals(2, reads)
  }

  @Test fun reTrackingAfterARefreshReplacesTheTracksAndForgettingDropsThem() {
    completed["hls.checkpoint"] = 4
    counts.track("dl", listOf(SegmentCounts.Track(video, 10)))
    assertEquals(4 to 10, counts.of("dl"))

    // Re-read playlists can change the plan: the new totals apply at once.
    counts.track("dl", listOf(SegmentCounts.Track(video, 12)))
    assertEquals(4 to 12, counts.of("dl"))

    counts.forget("dl")
    assertNull(counts.of("dl"))
  }

  @Test fun entriesAreBounded() {
    repeat(SegmentCounts.MAX_ENTRIES + 5) { counts.track("dl-$it", listOf(SegmentCounts.Track(video, 3))) }
    val kept = (0 until SegmentCounts.MAX_ENTRIES + 5).count { counts.of("dl-$it") != null }
    assertEquals(SegmentCounts.MAX_ENTRIES, kept)
  }
}
