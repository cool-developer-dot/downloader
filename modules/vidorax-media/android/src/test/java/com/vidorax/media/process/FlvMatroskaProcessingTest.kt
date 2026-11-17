package com.vidorax.media.process

import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * What a downloaded FLV or MKV file becomes (ffmpeg fixtures in `src/test/resources/media/formats`): an H.264/AAC FLV
 * is remuxed into an MP4, an FLV whose picture Media3 cannot read (Sorenson Spark) is kept as downloaded for "Open
 * with", an MKV is kept byte for byte, and an FLV with sound only is not a video.
 */
@RunWith(RobolectricTestRunner::class)
class FlvMatroskaProcessingTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun fixture(name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream("/media/formats/$name")) { "missing fixture $name" }.use { it.readBytes() }
    return File(tmp.newFolder(), name).apply { writeBytes(bytes) }
  }

  private fun process(file: File, container: Container) = runBlocking {
    MediaProcessor().process(ProcessingInput.Single(TrackFile(file, MediaProcessor.trackContainer(container))), tmp.newFolder())
  }

  @Test fun anH264AacFlvBecomesAnMp4WithBothTracks() {
    val result = process(fixture("av.flv"), Container.FLV)
    assertTrue("got $result", result is ProcessingResult.Done)
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.REMUX, result.operation)
    assertEquals(Container.MP4, result.container)
    val info = checkNotNull(MediaFiles.read(result.file, TrackContainer.MP4)) { "the MP4 is readable" }
    assertNotNull("video track", info.video)
    assertNotNull("audio track", info.audio)
  }

  @Test fun anFlvWhosePictureMedia3CannotReadIsKeptAsDownloaded() {
    val source = fixture("sorenson.flv")
    val before = source.readBytes()
    val result = process(source, Container.FLV)
    assertTrue("got $result", result is ProcessingResult.Done)
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.KEEP, result.operation)
    assertEquals(source, result.file)
    assertTrue(before.contentEquals(source.readBytes()))
  }

  @Test fun anMkvIsKeptByteForByte() {
    val source = fixture("av.mkv")
    val before = source.readBytes()
    val result = process(source, Container.MKV)
    assertTrue("got $result", result is ProcessingResult.Done)
    result as ProcessingResult.Done
    assertEquals(ProcessingOperation.KEEP, result.operation)
    // Kept because it already plays, not because it could not be read.
    assertEquals(null, result.note)
    assertEquals(source, result.file)
    assertTrue(before.contentEquals(source.readBytes()))
    assertEquals(Container.MKV, MediaProcessor.keptContainer(MediaProcessor.trackContainer(Container.MKV)))
  }

  @Test fun anFlvWithSoundOnlyIsNotAVideo() {
    val result = process(fixture("audio-only.flv"), Container.FLV)
    assertTrue("got $result", result is ProcessingResult.Failed)
    assertEquals(DownloadErrorCode.VIDEO_TRACK_MISSING, (result as ProcessingResult.Failed).code)
  }
}
