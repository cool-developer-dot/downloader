package com.vidorax.media.files

import org.junit.Assert.assertEquals
import org.junit.Test

class FileActionsTest {
  @Test
  fun shareTypeIsAsSpecificAsTheFilesAllow() {
    assertEquals("video/mp4", shareMimeType(listOf("video/mp4", "video/mp4")))
    assertEquals("video/*", shareMimeType(listOf("video/mp4", "video/webm")))
    assertEquals("*/*", shareMimeType(listOf("video/mp4", "audio/mp4")))
  }
}
