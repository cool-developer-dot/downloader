package com.vidorax.media.process

import android.media.MediaExtractor
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import java.io.File
import java.nio.ByteBuffer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The lossless processing path through Media3's real extractors and muxers (ffmpeg-made fixtures in
 * `src/test/resources/media/process`): merging separate video and audio, MPEG-TS and fragmented MP4 → MP4, timeline
 * alignment, and the refusals that keep two different videos from being merged.
 */
@RunWith(RobolectricTestRunner::class)
class RemuxerTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun fixture(name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream("/media/process/$name")) { "missing fixture $name" }.use { it.readBytes() }
    return File(tmp.root, name).apply { writeBytes(bytes) }
  }

  private fun progressiveFixture(name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream("/media/progressive/$name")) { "missing fixture $name" }.use { it.readBytes() }
    return File(tmp.root, name).apply { writeBytes(bytes) }
  }

  /** Every sample time per track kind of a finished file. */
  private fun sampleTimes(file: File, container: TrackContainer = TrackContainer.MP4): Map<TrackKind, List<Long>> {
    val extractor = MediaFiles.open(file, container)
    try {
      val kinds = (0 until extractor.trackCount).associateWith { MediaFiles.track(it, extractor.getTrackFormat(it))!!.kind }
      kinds.keys.forEach { extractor.selectTrack(it) }
      val times = HashMap<TrackKind, MutableList<Long>>()
      val buffer = ByteBuffer.allocateDirect(1 shl 20)
      while (extractor.sampleTrackIndex >= 0) {
        buffer.clear()
        extractor.readSampleData(buffer, 0)
        times.getOrPut(kinds.getValue(extractor.sampleTrackIndex)) { mutableListOf() }.add(extractor.sampleTime)
        extractor.advance()
      }
      return times
    } finally {
      extractor.release()
    }
  }

  @Test
  fun `merges a video-only and an audio-only fragmented file into one progressive MP4`() {
    val out = File(tmp.root, "out.mp4")
    val outcome = Remuxer().remux(
      listOf(
        RemuxSource(fixture("split-video.mp4"), TrackContainer.MP4, takeAudio = false),
        RemuxSource(fixture("split-audio.m4a"), TrackContainer.MP4, takeVideo = false),
      ),
      out,
      OutputContainer.MP4,
    )
    assertEquals("video/avc", outcome.videoFormat.sampleMimeType)
    assertEquals("audio/mp4a-latm", outcome.audioFormat?.sampleMimeType)
    val info = checkNotNull(MediaFiles.read(out, TrackContainer.MP4))
    assertNotNull(info.video)
    assertNotNull(info.audio)
    assertFalse("a merged file is a plain, seekable MP4", info.fragmented)
    val times = sampleTimes(out)
    assertEquals(50, times.getValue(TrackKind.VIDEO).size) // 2 s at 25 fps
    val duration = checkNotNull(info.durationUs)
    assertTrue("duration $duration", duration in 1_900_000L..2_200_000L)
    // Both tracks start at the beginning: the sound is not shifted against the picture.
    assertTrue(kotlin.math.abs(times.getValue(TrackKind.VIDEO).min() - times.getValue(TrackKind.AUDIO).min()) < 100_000)
  }

  @Test
  fun `keeps the offset between video and audio transport streams cut from one encode`() {
    // The fixtures' first PTS: video 11.400 s, audio 11.3768 s (ffprobe) — 23 ms apart.
    val out = File(tmp.root, "ts.mp4")
    Remuxer().remux(
      listOf(
        RemuxSource(fixture("video.ts"), TrackContainer.TS, takeAudio = false),
        RemuxSource(fixture("audio.ts"), TrackContainer.TS, takeVideo = false),
      ),
      out,
      OutputContainer.MP4,
    )
    val times = sampleTimes(out)
    val videoStart = times.getValue(TrackKind.VIDEO).min()
    val audioStart = times.getValue(TrackKind.AUDIO).min()
    assertTrue("audio starts first, at 0 (was $audioStart)", audioStart in 0..1_000)
    assertTrue("video keeps its 23 ms delay (was $videoStart)", videoStart in 20_000L..27_000L)
  }

  @Test
  fun `applies the start delays in fragmented MP4 edit lists that Media3 leaves out`() {
    // The same encode as HLS fMP4 renditions (ffmpeg): video `[80 ms empty][from 7200/90000]`, audio
    // `[56 ms empty][from 0]` — the picture starts 24 ms after the sound, as in the transport streams above.
    assertEquals(mapOf(TrackKind.AUDIO to 56_000L), FragmentEdits.correctionsUs(fixture("hls-fmp4-audio.mp4"), TrackContainer.MP4))
    assertEquals(emptyMap<TrackKind, Long>(), FragmentEdits.correctionsUs(fixture("hls-fmp4-video.mp4"), TrackContainer.MP4))
    val out = File(tmp.root, "fmp4-split.mp4")
    Remuxer().remux(
      listOf(
        RemuxSource(fixture("hls-fmp4-video.mp4"), TrackContainer.MP4, takeAudio = false),
        RemuxSource(fixture("hls-fmp4-audio.mp4"), TrackContainer.MP4, takeVideo = false),
      ),
      out,
      OutputContainer.MP4,
    )
    val split = sampleTimes(out)
    assertTrue("audio starts first (was ${split.getValue(TrackKind.AUDIO).min()})", split.getValue(TrackKind.AUDIO).min() in 0..1_000)
    assertTrue("video 24 ms later (was ${split.getValue(TrackKind.VIDEO).min()})", split.getValue(TrackKind.VIDEO).min() in 20_000L..28_000L)

    // Both tracks in one fragmented file: each track gets its own correction.
    val muxed = File(tmp.root, "fmp4-av.mp4")
    Remuxer().remux(listOf(RemuxSource(fixture("hls-fmp4-av.mp4"), TrackContainer.MP4)), muxed, OutputContainer.MP4)
    val times = sampleTimes(muxed)
    assertTrue(times.getValue(TrackKind.AUDIO).min() in 0..1_000)
    assertTrue("video 24 ms later (was ${times.getValue(TrackKind.VIDEO).min()})", times.getValue(TrackKind.VIDEO).min() in 20_000L..28_000L)
  }

  @Test
  fun `leaves edit lists Media3 applies itself and progressive files alone`() {
    // A single edit over the whole track (an ffmpeg DASH init segment: `[0 → from 1024]`) is applied by the extractor,
    // a progressive MP4's by Mp4Extractor; no edit list, no correction.
    assertEquals(emptyMap<TrackKind, Long>(), FragmentEdits.correctionsUs(fixture("dash-init-video.mp4"), TrackContainer.MP4))
    assertEquals(emptyMap<TrackKind, Long>(), FragmentEdits.correctionsUs(fixture("av-frag.mp4"), TrackContainer.MP4))
    assertEquals(emptyMap<TrackKind, Long>(), FragmentEdits.correctionsUs(fixture("long-video.mp4"), TrackContainer.MP4))
    assertEquals(emptyMap<TrackKind, Long>(), FragmentEdits.correctionsUs(fixture("av.ts"), TrackContainer.TS))
  }

  @Test
  fun `turns a muxed MPEG-TS into an MP4 that starts at zero`() {
    val out = File(tmp.root, "av.mp4")
    val outcome = Remuxer().remux(listOf(RemuxSource(fixture("av.ts"), TrackContainer.TS)), out, OutputContainer.MP4)
    assertNotNull(outcome.audioFormat)
    val info = checkNotNull(MediaFiles.read(out, TrackContainer.MP4))
    assertNotNull(info.video)
    assertNotNull(info.audio)
    val times = sampleTimes(out)
    assertTrue(minOf(times.getValue(TrackKind.VIDEO).min(), times.getValue(TrackKind.AUDIO).min()) in 0..1_000)
    assertEquals(50, times.getValue(TrackKind.VIDEO).size)
  }

  @Test
  fun `turns a standalone fragmented MP4 into a progressive one`() {
    val source = fixture("av-frag.mp4")
    assertTrue(MediaFiles.isFragmented(source))
    val out = File(tmp.root, "frag.mp4")
    Remuxer().remux(listOf(RemuxSource(source, TrackContainer.MP4)), out, OutputContainer.MP4)
    assertFalse(MediaFiles.isFragmented(out))
    val info = checkNotNull(MediaFiles.read(out, TrackContainer.MP4))
    assertNotNull(info.video)
    assertNotNull(info.audio)
  }

  @Test
  fun `refuses to merge when the audio file has no sound`() {
    try {
      Remuxer().remux(
        listOf(
          RemuxSource(fixture("split-video.mp4"), TrackContainer.MP4, takeAudio = false),
          RemuxSource(fixture("split-video-6s.mp4"), TrackContainer.MP4, takeVideo = false),
        ),
        File(tmp.root, "x.mp4"),
        OutputContainer.MP4,
      )
      fail("expected AUDIO_TRACK_MISSING")
    } catch (e: ProcessingException) {
      assertEquals(DownloadErrorCode.AUDIO_TRACK_MISSING, e.code)
    }
    assertFalse(File(tmp.root, "x.mp4").exists())
  }

  @Test
  fun `refuses when the video file has no picture`() {
    try {
      Remuxer().remux(
        listOf(
          RemuxSource(fixture("split-audio.m4a"), TrackContainer.MP4, takeAudio = false),
          RemuxSource(fixture("split-audio.m4a"), TrackContainer.MP4, takeVideo = false),
        ),
        File(tmp.root, "y.mp4"),
        OutputContainer.MP4,
      )
      fail("expected VIDEO_TRACK_MISSING")
    } catch (e: ProcessingException) {
      assertEquals(DownloadErrorCode.VIDEO_TRACK_MISSING, e.code)
    }
  }

  @Test
  fun `a cancelled remux leaves no partial file`() {
    val out = File(tmp.root, "cancel.mp4")
    try {
      Remuxer().remux(
        listOf(RemuxSource(fixture("av.ts"), TrackContainer.TS)),
        out,
        OutputContainer.MP4,
        ensureActive = { throw kotlinx.coroutines.CancellationException("paused") },
      )
      fail("expected cancellation")
    } catch (e: kotlinx.coroutines.CancellationException) {
      // expected
    }
    assertFalse(out.exists())
  }

  // --- MediaProcessor decisions ---

  @Test
  fun `processor keeps a progressive MP4 byte for byte`() = runBlocking {
    val source = progressiveFixture("av.mp4")
    val before = source.readBytes()
    val result = MediaProcessor().process(ProcessingInput.Single(TrackFile(source, TrackContainer.MP4)), tmp.root)
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.KEEP, result.operation)
    assertEquals(source, result.file)
    assertTrue(before.contentEquals(source.readBytes()))
  }

  @Test
  fun `processor remuxes an HLS transport stream into MP4`() = runBlocking {
    val stages = mutableListOf<com.vidorax.media.model.ProcessingStage>()
    val result = MediaProcessor().process(ProcessingInput.Single(TrackFile(fixture("av.ts"), TrackContainer.TS)), tmp.root) { stage, _ ->
      if (stages.lastOrNull() != stage) stages += stage
    }
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.REMUX, result.operation)
    assertEquals(Container.MP4, result.container)
    assertEquals(listOf(com.vidorax.media.model.ProcessingStage.REMUXING, com.vidorax.media.model.ProcessingStage.VERIFYING), stages)
  }

  @Test
  fun `processor merges split tracks and reports the stage`() = runBlocking {
    val result = MediaProcessor().process(
      ProcessingInput.Split(TrackFile(fixture("split-video.mp4"), TrackContainer.MP4), TrackFile(fixture("split-audio.m4a"), TrackContainer.MP4)),
      tmp.root,
    )
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.MERGE, result.operation)
    assertEquals(File(tmp.root, MediaProcessor.PROCESSED_MP4), result.file)
  }

  @Test
  fun `processor never merges tracks of different lengths`() = runBlocking {
    // A 6 s video with a 2 s audio track are two different videos — nothing is written.
    val result = MediaProcessor().process(
      ProcessingInput.Split(TrackFile(fixture("split-video-6s.mp4"), TrackContainer.MP4), TrackFile(fixture("split-audio.m4a"), TrackContainer.MP4)),
      tmp.root,
    )
    result as ProcessingResult.Failed
    assertEquals(DownloadErrorCode.TRACK_MISMATCH, result.code)
    assertFalse(File(tmp.root, MediaProcessor.PROCESSED_MP4).exists())
    assertTrue(MediaProcessor.lengthsAgree(3_000_000, 2_000_000))
    assertFalse(MediaProcessor.lengthsAgree(60_000_000, 30_000_000))
  }

  @Test
  fun `processor keeps a WMV it cannot read`() = runBlocking {
    val wmv = fixture("video.wmv")
    val result = MediaProcessor().process(ProcessingInput.Single(TrackFile(wmv, TrackContainer.UNKNOWN)), tmp.root)
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.KEEP, result.operation)
    assertEquals(wmv, result.file)
  }

  @Test
  fun `processor keeps a 3GPP2 file and an F4V as downloaded`() = runBlocking {
    for ((name, container) in listOf("sample.3g2" to Container.THREE_G2, "sample.f4v" to Container.MP4)) {
      val file = fixture(name)
      val result = MediaProcessor().process(ProcessingInput.Single(TrackFile(file, MediaProcessor.trackContainer(container))), tmp.root)
      if (result is ProcessingResult.Failed) fail("$name: ${result.code}: ${result.message}")
      result as ProcessingResult.Done
      assertEquals(name, ProcessingOperation.KEEP, result.operation)
      assertEquals(name, file, result.file)
    }
  }

  @Test
  fun `a DivX file is read as AVI with its MPEG-4 video`() {
    val info = checkNotNull(MediaFiles.read(fixture("divx-mp3.divx"), TrackContainer.AVI))
    assertEquals("video/mp4v-es", info.video?.mimeType)
    assertEquals("audio/mpeg", info.audio?.mimeType)
  }

  @Test
  fun `processor keeps a DivX 3 AVI whose video Android cannot decode, for Open with`() = runBlocking {
    val file = fixture("div3-mp3.divx")
    val result = MediaProcessor().process(ProcessingInput.Single(TrackFile(file, TrackContainer.AVI)), tmp.root)
    if (result is ProcessingResult.Failed) fail("${result.code}: ${result.message}")
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.KEEP, result.operation)
    assertEquals(file, result.file)
  }

  @Test
  fun `an AVI with no video stream in its header is still refused`() = runBlocking {
    // The DivX 3 file's header with its video stream type renamed: Media3 sees only the MP3, and so does the header.
    val bytes = fixture("div3-mp3.divx").readBytes()
    val strh = String(bytes, Charsets.ISO_8859_1).indexOf("strh")
    check(strh > 0 && String(bytes, strh + 8, 4, Charsets.ISO_8859_1) == "vids")
    "auds".toByteArray().copyInto(bytes, strh + 8)
    val audioOnly = File(tmp.root, "audio-only.avi").apply { writeBytes(bytes) }
    assertFalse(AviHeader.declaresVideoStream(audioOnly))
    assertTrue(AviHeader.declaresVideoStream(fixture("div3-mp3.divx")))
    val result = MediaProcessor().process(ProcessingInput.Single(TrackFile(audioOnly, TrackContainer.AVI)), tmp.root)
    result as ProcessingResult.Failed
    assertEquals(DownloadErrorCode.VIDEO_TRACK_MISSING, result.code)
  }

  @Test
  fun `processor converts only the MP3 audio an MP4 cannot hold and copies the video`() = runBlocking {
    val asked = mutableListOf<TranscodeRequest>()
    val processor = MediaProcessor(transcoder = Transcoder { request, output, _ ->
      asked += request
      // Stand-in for the device transcoder: the AAC audio track it would produce.
      fixture("split-audio.m4a").copyTo(output, overwrite = true)
      TranscodeOutcome(output, "audio/mp4a-latm")
    })
    val result = processor.process(ProcessingInput.Single(TrackFile(fixture("xvid-mp3.avi"), TrackContainer.AVI)), tmp.root)
    assertEquals("only the audio is re-encoded", listOf(TrackKind.AUDIO), asked.map { it.track })
    if (result is ProcessingResult.Failed) fail("${result.code}: ${result.message}")
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.TRANSCODE, result.operation)
    val info = checkNotNull(MediaFiles.read(result.file, TrackContainer.MP4))
    assertEquals("the MPEG-4 video is copied, not re-encoded", "video/mp4v-es", info.video?.mimeType)
    assertEquals("audio/mp4a-latm", info.audio?.mimeType)
  }

  @Test
  fun `processor reports a failed transcode with its code`() = runBlocking {
    val result = MediaProcessor().process(ProcessingInput.Single(TrackFile(fixture("xvid-mp3.avi"), TrackContainer.AVI)), tmp.root)
    result as ProcessingResult.Failed
    assertEquals(DownloadErrorCode.TRANSCODE_FAILED, result.code)
  }

  @Test
  fun `sync flags survive the remux`() {
    val out = File(tmp.root, "sync.mp4")
    Remuxer().remux(listOf(RemuxSource(fixture("av.ts"), TrackContainer.TS)), out, OutputContainer.MP4)
    val extractor = MediaFiles.open(out, TrackContainer.MP4)
    try {
      val video = (0 until extractor.trackCount).first { MediaFiles.track(it, extractor.getTrackFormat(it))!!.kind == TrackKind.VIDEO }
      extractor.selectTrack(video)
      var keyFrames = 0
      while (extractor.sampleTrackIndex >= 0) {
        if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) keyFrames++
        extractor.advance()
      }
      assertEquals("GOP 25 over 50 frames", 2, keyFrames)
    } finally {
      extractor.release()
    }
  }
}
