package com.vidorax.media.library

import com.vidorax.media.model.Container
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

  /** What "On this device" may list: containers VidoraX can actually play, and nothing else. */
  @Test
  fun supportedDeviceVideos() {
    assertTrue(MediaTypes.isSupportedVideo("video/mp4", "clip.mp4"))
    assertTrue(MediaTypes.isSupportedVideo("video/x-matroska", "clip.mkv"))
    assertTrue(MediaTypes.isSupportedVideo("video/quicktime", "clip.mov"))
    assertTrue("a device that reports no type is decided by the file name", MediaTypes.isSupportedVideo(null, "clip.webm"))
    assertTrue(MediaTypes.isSupportedVideo("application/octet-stream", "clip.3gp"))

    assertFalse("music is not a video", MediaTypes.isSupportedVideo("audio/mpeg", "song.mp3"))
    assertFalse(MediaTypes.isSupportedVideo("video/x-ms-asf", "clip.asf"))
    assertFalse(MediaTypes.isSupportedVideo(null, "notes.txt"))
    assertFalse(MediaTypes.isSupportedVideo(null, null))
  }

  /** The library records the container the bytes proved, not the platform's generic ISO-BMFF answer. */
  @Test
  fun libraryMimeTypeFollowsTheProvenContainer() {
    assertEquals("a MOV the platform calls video/mp4 is a MOV", "video/quicktime", MediaTypes.libraryMimeType(Container.MOV, "video/mp4"))
    assertEquals("video/mp4", MediaTypes.libraryMimeType(Container.MP4, "video/mp4"))
    assertEquals("video/webm", MediaTypes.libraryMimeType(Container.WEBM, "video/webm"))
    assertEquals("video/mp2t", MediaTypes.libraryMimeType(Container.TS, "video/mp2ts"))
    assertEquals("video/x-msvideo", MediaTypes.libraryMimeType(Container.AVI, null))
    assertEquals("a v1 audio import stays audio", "audio/mp4", MediaTypes.libraryMimeType(Container.MP4, "audio/mp4"))
    assertEquals("an unknown container keeps what the platform said", "video/x-flv", MediaTypes.libraryMimeType(Container.UNKNOWN, "Video/X-FLV"))
    assertNull(MediaTypes.libraryMimeType(Container.UNKNOWN, null))
  }

  @Test
  fun videoMimeTypesCoverTheContainersTheEngineWrites() {
    assertTrue(MediaTypes.videoMimeTypes.contains("video/mp4"))
    assertTrue(MediaTypes.videoMimeTypes.contains("video/webm"))
    assertTrue(MediaTypes.videoMimeTypes.contains("video/x-matroska"))
    assertFalse("audio types never reach the device video query", MediaTypes.videoMimeTypes.contains("audio/mpeg"))
  }
}
