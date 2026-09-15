package com.vidorax.media.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FileNamesTest {
  @Test
  fun keepsLettersOfEveryScript() {
    assertEquals("میری ویڈیو", FileNames.safeTitle("میری ویڈیو"))
    assertEquals("Café 東京 (live)", FileNames.safeTitle("Café 東京 (live)"))
  }

  @Test
  fun replacesPathAndReservedCharacters() {
    assertEquals("a b c d e", FileNames.safeTitle("a/b\\c:d*e"))
    assertEquals("What", FileNames.safeTitle("What?#%"))
    assertEquals("one two", FileNames.safeTitle("one\n\ttwo"))
  }

  @Test
  fun neverHiddenOrEmpty() {
    assertEquals("config", FileNames.safeTitle("..config"))
    assertEquals("Video", FileNames.safeTitle("../"))
    assertEquals("Video", FileNames.safeTitle("   "))
  }

  @Test
  fun cutsWholeCodePointsWithinTheByteLimit() {
    assertEquals("東".repeat(50), FileNames.safeTitle("東".repeat(60)))

    // U+20000 is a letter encoded as a surrogate pair and four UTF-8 bytes.
    val safe = FileNames.safeTitle("𠀀".repeat(40))
    assertEquals("𠀀".repeat(37), safe)
    assertTrue(safe.toByteArray().size <= 150)
  }

  @Test
  fun libraryFileNameEndsWithShortIdAndCopy() {
    assertEquals("My clip_e5f6a7b8.mp4", FileNames.libraryFileName("My clip", "a1b2c3d4-e5f6-a7b8", "MP4"))
    assertEquals("My clip_e5f6a7b8-2.mp4", FileNames.libraryFileName("My clip", "a1b2c3d4-e5f6-a7b8", ".mp4", 2))
  }

  @Test
  fun idsBecomeSinglePathSegments() {
    assertEquals("___etc_passwd", FileNames.safeId("../etc/passwd"))
    assertEquals("item", FileNames.safeId(""))
    assertEquals("item", FileNames.shortId("---"))
  }

  @Test
  fun extensionsAreShortLowercaseAlphanumerics() {
    assertEquals("mp4", FileNames.safeExtension(" .MP4 "))
    assertEquals("bin", FileNames.safeExtension("../"))
    assertEquals("abcde", FileNames.safeExtension("abcdefgh"))
  }
}
