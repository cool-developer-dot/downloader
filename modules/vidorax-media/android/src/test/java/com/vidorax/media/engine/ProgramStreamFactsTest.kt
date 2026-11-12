package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** F4: what Android's reader leaves out of a program stream's metadata comes from the stream; what it says wins. */
class ProgramStreamFactsTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun file(name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream("/media/process/$name")) { "missing $name" }.use { it.readBytes() }
    return File(tmp.root, name).apply { writeBytes(bytes) }
  }

  private val nothing = MediaMetadata(null, null, null, null, hasVideo = false, hasAudio = true, videoCodec = null, audioCodec = "audio/mpeg-L2", containerMimeType = "video/mpeg")

  @Test fun gapsAreFilledFromTheStream() {
    val filled = withProgramStreamFacts(file("ps-mpeg1.mpg"), nothing)
    assertTrue(filled.hasVideo)
    assertEquals(160, filled.width)
    assertEquals(120, filled.height)
    assertEquals("video/mpeg", filled.videoCodec)
    assertTrue("${filled.durationMs}", filled.durationMs!! in 1_700L..2_400L)
    assertEquals("audio/mpeg-L2", filled.audioCodec)
  }

  @Test fun whatAndroidSaysWinsAndOtherFilesAreUntouched() {
    val said = nothing.copy(durationMs = 9_999, width = 720, height = 576, hasVideo = true, videoCodec = "video/mpeg2")
    assertEquals(said, withProgramStreamFacts(file("ps-dvd.vob"), said))
    assertEquals(nothing, withProgramStreamFacts(file("split-video.mp4"), nothing))
  }
}
