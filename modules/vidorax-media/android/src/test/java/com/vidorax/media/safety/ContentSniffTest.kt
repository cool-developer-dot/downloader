package com.vidorax.media.safety

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** P8 #461: what a file's first bytes say, and when its name hides that. */
class ContentSniffTest {
  private fun zipOf(vararg names: String): ByteArray = ByteArrayOutputStream().also { out ->
    ZipOutputStream(out).use { zip ->
      for (name in names) {
        zip.putNextEntry(ZipEntry(name))
        zip.write("x".toByteArray())
        zip.closeEntry()
      }
    }
  }.toByteArray()

  private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

  private fun pe(): ByteArray = ByteArray(256).also {
    it[0] = 'M'.code.toByte(); it[1] = 'Z'.code.toByte(); it[0x3C] = 0x80.toByte()
    it[0x80] = 'P'.code.toByte(); it[0x81] = 'E'.code.toByte()
  }

  @Test fun `magic bytes of programs and archives`() {
    assertEquals(ContentKind.APK, ContentSniff.kindOf(zipOf("AndroidManifest.xml", "classes.dex")))
    assertEquals(ContentKind.JAR, ContentSniff.kindOf(zipOf("META-INF/MANIFEST.MF", "a/B.class")))
    assertEquals(ContentKind.ZIP, ContentSniff.kindOf(zipOf("clip.mp4")))
    assertEquals(ContentKind.EXE, ContentSniff.kindOf(pe()))
    assertEquals(ContentKind.ELF, ContentSniff.kindOf(bytes(0x7F, 0x45, 0x4C, 0x46, 2, 1, 1)))
    assertEquals(ContentKind.DEX, ContentSniff.kindOf("dex\n035\u0000".toByteArray()))
    assertEquals(ContentKind.MSI, ContentSniff.kindOf(bytes(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)))
    assertEquals(ContentKind.MACHO, ContentSniff.kindOf(bytes(0xCF, 0xFA, 0xED, 0xFE, 7, 0, 0, 1)))
    assertEquals(ContentKind.SCRIPT, ContentSniff.kindOf("#!/system/bin/sh\nrm -rf".toByteArray()))
    assertEquals(ContentKind.RAR, ContentSniff.kindOf(bytes(0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00)))
    assertEquals(ContentKind.SEVEN_Z, ContentSniff.kindOf(bytes(0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C, 0, 4)))
  }

  @Test fun `media and text are not programs`() {
    val mp4 = bytes(0, 0, 0, 0x18) + "ftypisom".toByteArray() + ByteArray(16)
    assertNull(ContentSniff.kindOf(mp4))
    assertNull(ContentSniff.kindOf(bytes(0x1A, 0x45, 0xDF, 0xA3, 0x9F)))
    assertNull(ContentSniff.kindOf(bytes(0x47, 0x40, 0x00, 0x10)))
    assertNull(ContentSniff.kindOf("WEBVTT\n\n00:00.000 --> 00:01.000".toByteArray()))
    assertNull(ContentSniff.kindOf("# not a shebang".toByteArray()))
    assertNull(ContentSniff.kindOf(ByteArray(0)))
    // "MZ" whose header points at something other than a PE signature inside the prefix is not taken for a program.
    val notPe = pe().also { it[0x80] = 'X'.code.toByte() }
    assertNull(ContentSniff.kindOf(notPe))
  }

  @Test fun `an APK renamed mp4 is disguised`() {
    val verdict = ContentSniff.assess("holiday.mp4", zipOf("AndroidManifest.xml", "classes.dex"))
    assertEquals(FileSafetyReason.DISGUISED, verdict.reason)
    assertEquals(ContentKind.APK, verdict.detected)
    assertTrue(verdict.risky)
    assertEquals(FileSafetyReason.DISGUISED, ContentSniff.assess("movie.MKV", pe()).reason)
    assertEquals(FileSafetyReason.DISGUISED, ContentSniff.assess("song.mp3", zipOf("a.txt")).reason)
  }

  @Test fun `double extensions are caught by name alone`() {
    for (name in listOf("clip.mp4.exe", "Clip.MP4.apk", "photo.jpg.scr", "notes.pdf.lnk", "clip.mp4.exe.")) {
      assertEquals(name, FileSafetyReason.DOUBLE_EXTENSION, ContentSniff.assess(name, null).reason)
    }
    assertFalse(ContentSniff.assess("archive.tar.sh", null).reason == FileSafetyReason.DOUBLE_EXTENSION)
  }

  @Test fun `honest programs are programs, honest media is safe`() {
    assertEquals(FileSafetyReason.PROGRAM, ContentSniff.assess("setup.exe", pe()).reason)
    assertEquals(FileSafetyReason.PROGRAM, ContentSniff.assess("app.apk", null).reason)
    assertEquals(FileSafetyReason.PROGRAM, ContentSniff.assess("download", pe()).reason)
    assertEquals(FileSafetyVerdict.SAFE, ContentSniff.assess("clip.mp4", bytes(0, 0, 0, 0x18) + "ftypisom".toByteArray()))
    assertEquals(FileSafetyVerdict.SAFE, ContentSniff.assess("photos.zip", zipOf("a.jpg")))
    assertEquals(FileSafetyVerdict.SAFE, ContentSniff.assess(null, null))
  }

  @Test fun `extensions are read from the last parts only`() {
    assertEquals(listOf("clip", "mp4", "exe"), ContentSniff.extensionsOf("dir/My.Clip.MP4.exe"))
    assertEquals(emptyList<String>(), ContentSniff.extensionsOf(".bashrc"))
    assertEquals(emptyList<String>(), ContentSniff.extensionsOf("noext"))
    assertEquals(listOf("exe"), ContentSniff.extensionsOf("Version 1.0 final.exe"))
  }
}
