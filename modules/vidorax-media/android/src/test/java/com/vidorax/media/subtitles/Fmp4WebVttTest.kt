package com.vidorax.media.subtitles

import com.vidorax.media.subtitles.Fmp4Builder.Sample
import com.vidorax.media.subtitles.Fmp4Builder.cue
import com.vidorax.media.subtitles.Fmp4Builder.empty
import com.vidorax.media.subtitles.Fmp4Builder.fragment
import com.vidorax.media.subtitles.Fmp4Builder.init
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #370: WebVTT inside fMP4 (`wvtt`) read into cues, and joined into one `.vtt`. */
class Fmp4WebVttTest {
  private val track = Fmp4WebVtt.trackOf(init())!!

  @Test fun theInitSegmentNamesTheWebVttTrack() {
    assertEquals(Fmp4WebVtt.Track(trackId = 2, timescale = 1_000, defaultDuration = 0, defaultSize = 0), track)
    assertEquals(90_000L, Fmp4WebVtt.trackOf(init(trackId = 7, timescale = 90_000))!!.timescale)
    assertNull("a track that is not WebVTT", Fmp4WebVtt.trackOf(init(sampleEntry = "stpp")))
    assertNull("not an init segment", Fmp4WebVtt.trackOf(ByteArray(64)))
  }

  @Test fun samplesBecomeCuesOnTheTrackTimeline() {
    val segment = fragment(
      baseTime = 0,
      samples = listOf(
        Sample(2_000, cue("Hello", settings = "align:start line:90%")),
        Sample(1_000, empty()),
        Sample(2_000, cue("Two\nlines")),
      ),
    )
    val fragments = Fmp4WebVtt.fragments(segment, track)
    assertEquals(0L, fragments.startMs)
    assertEquals(
      listOf(
        WebVtt.Cue(0, 2_000, "align:start line:90%", listOf("Hello")),
        WebVtt.Cue(3_000, 5_000, "", listOf("Two", "lines")),
      ),
      fragments.cues,
    )
  }

  @Test fun theTimescaleAndTheFragmentStartAreHonoured() {
    val ninety = Fmp4WebVtt.trackOf(init(timescale = 90_000))!!
    val fragments = Fmp4WebVtt.fragments(fragment(baseTime = 900_000, samples = listOf(Sample(180_000, cue("Ten seconds in")))), ninety)
    assertEquals(10_000L, fragments.startMs)
    assertEquals(WebVtt.Cue(10_000, 12_000, "", listOf("Ten seconds in")), fragments.cues.single())
  }

  @Test fun twoCuesShownTogetherAreBothKept() {
    val both = Fmp4Builder.box("vttc", Fmp4Builder.box("payl", Fmp4Builder.text("Top"))) +
      Fmp4Builder.box("vttc", Fmp4Builder.box("payl", Fmp4Builder.text("Bottom")))
    val cues = Fmp4WebVtt.fragments(fragment(baseTime = 0, samples = listOf(Sample(1_000, both))), track).cues
    assertEquals(listOf(listOf("Top"), listOf("Bottom")), cues.map { it.text })
  }

  @Test fun aCueRepeatedAcrossSamplesAndSegmentsIsJoinedBack() {
    val first = Fmp4WebVtt.fragments(
      fragment(baseTime = 0, samples = listOf(Sample(1_000, cue("A")), Sample(1_000, cue("Long")))),
      track,
    )
    val second = Fmp4WebVtt.fragments(fragment(baseTime = 2_000, samples = listOf(Sample(3_000, cue("Long")))), track)
    assertEquals(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA\n\n00:00:01.000 --> 00:00:05.000\nLong\n",
      Fmp4WebVtt.assemble(first.cues + second.cues),
    )
  }

  @Test fun theOffsetMovesCuesOntoTheVideoTimelineAndNothingBeforeZeroIsKept() {
    val cues = listOf(
      WebVtt.Cue(9_000, 10_000, "", listOf("before")),
      WebVtt.Cue(9_500, 11_000, "", listOf("across")),
      WebVtt.Cue(12_000, 13_000, "", listOf("after")),
    )
    assertEquals(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nacross\n\n00:00:02.000 --> 00:00:03.000\nafter\n",
      Fmp4WebVtt.assemble(cues, offsetMs = 10_000),
    )
  }

  @Test fun anotherTracksFragmentIsIgnored() {
    val other = fragment(trackId = 1, baseTime = 0, samples = listOf(Sample(1_000, cue("Video track?"))))
    assertTrue(Fmp4WebVtt.fragments(other, track).cues.isEmpty())
  }

  @Test fun truncatedOrGarbageBytesNeverThrow() {
    val segment = fragment(baseTime = 0, samples = listOf(Sample(1_000, cue("Hello")), Sample(1_000, cue("World"))))
    for (cut in listOf(4, 20, segment.size / 2, segment.size - 3)) {
      Fmp4WebVtt.fragments(segment.copyOf(cut), track)
    }
    Fmp4WebVtt.fragments(ByteArray(300) { (it * 37).toByte() }, track)
    assertNull(Fmp4WebVtt.trackOf(init().copyOf(40)))
  }

  @Test fun anEmptyTrackIsAnEmptyFile() {
    val fragments = Fmp4WebVtt.fragments(fragment(baseTime = 0, samples = listOf(Sample(5_000, empty()))), track)
    assertEquals("WEBVTT\n", Fmp4WebVtt.assemble(fragments.cues))
  }
}
