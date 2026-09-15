package com.vidorax.media.library

import com.vidorax.media.model.Container
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaTypesTest {
  @Test
  fun byFileName() {
    assertEquals("video/mp4", MediaTypes.forFileName("A.MP4")?.mimeType)
    assertEquals(Container.MP4, MediaTypes.forFileName("a.m4v")?.container)
    assertEquals(Container.TS, MediaTypes.forFileName("stream.ts")?.container)
    assertNull(MediaTypes.forFileName("download.bin"))
    assertNull(MediaTypes.forFileName("no-extension"))
  }

  @Test
  fun byMimeTypeIgnoresParametersAndCase() {
    assertEquals("webm", MediaTypes.forMimeType("Video/WebM; codecs=\"vp9, opus\"")?.extension)
    assertEquals("ts", MediaTypes.forMimeType("video/mp2ts")?.extension)
    assertTrue(MediaTypes.forMimeType("audio/mp4")!!.isAudioOnly)
    assertNull(MediaTypes.forMimeType("text/html"))
  }
}
