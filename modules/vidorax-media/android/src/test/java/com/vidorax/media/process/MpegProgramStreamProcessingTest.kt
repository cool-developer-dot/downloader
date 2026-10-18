package com.vidorax.media.process

import com.vidorax.media.model.Container
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * F4: MPEG program streams through Media3's real PS extractor (ffmpeg fixtures, 2 s, 160×120: `-f mpeg` with MPEG-1
 * video + MP2, `-f vob` with MPEG-2 video + MP2 and + AC-3). The device conversion itself (MPEG-2 decoder, H.264 and
 * AAC encoders) is `ProcessingE2EAndroidTest`.
 */
@RunWith(RobolectricTestRunner::class)
class MpegProgramStreamProcessingTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun fixture(name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream("/media/process/$name")) { "missing fixture $name" }.use { it.readBytes() }
    return File(tmp.root, name).apply { writeBytes(bytes) }
  }

  @Test fun `program streams are read with their MPEG video and MP2 or AC-3 sound`() {
    for ((name, audio) in listOf("ps-mpeg1.mpg" to "audio/mpeg-L2", "ps-dvd.vob" to "audio/mpeg-L2", "ps-ac3.vob" to "audio/ac3")) {
      val original = fixture(name)
      assertEquals(name, TrackContainer.MPEG_PS, TrackContainers.sniff(original))
      // Media3 reads MPEG-2 packaging only: an MPEG-1 system stream is read once re-packaged.
      val file = if (Mpeg1SystemStream.isMpeg1(original)) {
        assertNull("Media3 cannot read MPEG-1 packaging itself", MediaFiles.read(original, TrackContainer.MPEG_PS)?.video)
        File(tmp.root, "$name.ps2").also { Mpeg1SystemStream.rewrap(original, it) }
      } else {
        original
      }
      val info = checkNotNull(MediaFiles.read(file, TrackContainer.MPEG_PS)) { name }
      // Media3 names MPEG-1 and MPEG-2 video alike.
      assertEquals(name, "video/mpeg2", info.video?.mimeType)
      assertEquals(name, audio, info.audio?.mimeType)
      val duration = checkNotNull(info.durationUs) { "$name states no length" }
      // A program stream's length comes from its first and last clock references: up to a few frames over.
      assertTrue("$name lasts $duration µs", duration in 1_800_000L..2_500_000L)
    }
  }

  @Test fun `the processor converts both tracks of a program stream into one MP4`() = runBlocking {
    val asked = mutableListOf<TrackKind>()
    val processor = MediaProcessor(transcoder = Transcoder { request, output, _ ->
      asked += request.track
      // Stand-ins for the device transcoders: the H.264 and AAC tracks they would produce.
      val made = if (request.track == TrackKind.VIDEO) fixture("split-video.mp4") else fixture("split-audio.m4a")
      made.copyTo(output, overwrite = true)
      TranscodeOutcome(output, null)
    })
    for (name in listOf("ps-mpeg1.mpg", "ps-dvd.vob")) {
      asked.clear()
      val result = processor.process(ProcessingInput.Single(TrackFile(fixture(name), TrackContainer.MPEG_PS)), File(tmp.root, "work-$name").apply { mkdirs() })
      if (result is ProcessingResult.Failed) fail("$name: ${result.code}: ${result.message}")
      result as ProcessingResult.Done
      assertEquals(name, listOf(TrackKind.VIDEO, TrackKind.AUDIO), asked)
      assertEquals(name, ProcessingOperation.TRANSCODE, result.operation)
      assertEquals(name, Container.MP4, result.container)
      val info = checkNotNull(MediaFiles.read(result.file, TrackContainer.MP4))
      assertEquals("video/avc", info.video?.mimeType)
      assertEquals("audio/mp4a-latm", info.audio?.mimeType)
    }
  }

  @Test fun `a program stream whose sound this device cannot decode is kept as downloaded`() = runBlocking {
    // No AC-3 decoder (most phones without a Dolby licence): kept as .mpg for "Open with", like a WMV.
    val file = fixture("ps-ac3.vob")
    val processor = MediaProcessor(codecs = CodecSupport { it != "audio/ac3" })
    val result = processor.process(ProcessingInput.Single(TrackFile(file, TrackContainer.MPEG_PS)), tmp.root)
    if (result is ProcessingResult.Failed) fail("${result.code}: ${result.message}")
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.KEEP, result.operation)
    assertEquals(file, result.file)
    assertEquals(Container.MPEG_PS, MediaProcessor.keptContainer(TrackContainer.MPEG_PS))
    assertEquals(TrackContainer.MPEG_PS, MediaProcessor.trackContainer(Container.MPEG_PS))

    // An MPEG-1 system stream that cannot be converted: the original download is kept, not the re-packaged copy.
    val mpeg1 = fixture("ps-mpeg1.mpg")
    val work = File(tmp.root, "work-mpeg1").apply { mkdirs() }
    val kept = MediaProcessor(codecs = CodecSupport { it != "video/mpeg2" })
      .process(ProcessingInput.Single(TrackFile(mpeg1, TrackContainer.MPEG_PS)), work)
    if (kept is ProcessingResult.Failed) fail("${kept.code}: ${kept.message}")
    kept as ProcessingResult.Done
    assertEquals(ProcessingOperation.KEEP, kept.operation)
    assertEquals(mpeg1, kept.file)
    assertTrue("the re-packaged copy is gone", work.listFiles().isNullOrEmpty())
  }

  @Test fun `MP2 sound in a transport stream is converted and its H264 copied`() = runBlocking {
    val asked = mutableListOf<TrackKind>()
    val processor = MediaProcessor(transcoder = Transcoder { request, output, _ ->
      asked += request.track
      fixture("split-audio.m4a").copyTo(output, overwrite = true)
      TranscodeOutcome(output, null)
    })
    val result = processor.process(ProcessingInput.Single(TrackFile(fixture("h264-mp2.ts"), TrackContainer.TS)), tmp.root)
    if (result is ProcessingResult.Failed) fail("${result.code}: ${result.message}")
    result as ProcessingResult.Done
    assertEquals("only the MP2 is converted", listOf(TrackKind.AUDIO), asked)
    assertEquals(ProcessingOperation.TRANSCODE, result.operation)
    assertEquals("video/avc", checkNotNull(MediaFiles.read(result.file, TrackContainer.MP4)).video?.mimeType)
  }

  @Test fun `MP2 sound goes to VidoraX's own decoder, everything else to the platform`() = runBlocking {
    val routed = mutableListOf<String>()
    fun recording(label: String) = Transcoder { _, output, _ ->
      routed += label
      TranscodeOutcome(output, null)
    }
    val transcoder = RoutingTranscoder(platform = recording("platform"), mpegAudio = recording("mpeg-audio"))
    val out = File(tmp.root, "out.mp4")
    transcoder.transcode(TranscodeRequest(fixture("ps-dvd.vob"), TrackKind.AUDIO), out) {}
    transcoder.transcode(TranscodeRequest(fixture("ps-dvd.vob"), TrackKind.VIDEO), out) {}
    transcoder.transcode(TranscodeRequest(fixture("ps-ac3.vob"), TrackKind.AUDIO), out) {}
    transcoder.transcode(TranscodeRequest(fixture("xvid-mp3.avi"), TrackKind.AUDIO), out) {}
    assertEquals(listOf("mpeg-audio", "platform", "platform", "platform"), routed)
    assertTrue("MP2 is decodable: VidoraX decodes it", AndroidCodecSupport.canDecode(MpegAudioDecoder.MIME_TYPE))
  }
}
