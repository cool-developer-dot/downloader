package com.vidorax.media.archive

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** P8 #407: listing and extracting a ZIP without trusting it. */
class ZipArchiveTest {
  private fun zip(entries: List<Pair<String, ByteArray>>, stored: Boolean = false): ByteArray =
    ByteArrayOutputStream().also { out ->
      ZipOutputStream(out).use { zip ->
        for ((name, data) in entries) {
          val entry = ZipEntry(name)
          if (stored) {
            entry.method = ZipEntry.STORED
            entry.size = data.size.toLong()
            entry.compressedSize = data.size.toLong()
            entry.crc = CRC32().also { it.update(data) }.value
          }
          zip.putNextEntry(entry)
          zip.write(data)
          zip.closeEntry()
        }
      }
    }.toByteArray()

  private fun list(bytes: ByteArray) = ZipArchive.list(BytesArchiveSource(bytes))

  private fun refusal(bytes: ByteArray) = (list(bytes) as? ZipListing.Refused)?.refusal

  private val video = ByteArray(5000) { (it * 31).toByte() }

  /** Offset of the central directory record of entry [index] (0-based). */
  private fun centralAt(bytes: ByteArray, index: Int): Int {
    var found = -1
    for (i in 0 until bytes.size - 4) {
      if (bytes[i] == 0x50.toByte() && bytes[i + 1] == 0x4B.toByte() && bytes[i + 2] == 1.toByte() && bytes[i + 3] == 2.toByte()) {
        found += 1
        if (found == index) return i
      }
    }
    error("no central record $index")
  }

  private fun putU32(bytes: ByteArray, at: Int, value: Long) {
    ByteBuffer.wrap(bytes, at, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(value.toInt())
  }

  private fun putU16(bytes: ByteArray, at: Int, value: Int) {
    ByteBuffer.wrap(bytes, at, 2).order(ByteOrder.LITTLE_ENDIAN).putShort(value.toShort())
  }

  @Test fun `lists videos and subtitles and classifies the rest`() {
    val listing = list(
      zip(
        listOf(
          "Season 1/Ep 1.mp4" to video,
          "Season 1/Ep 1.en.srt" to "1\n00:00:01,000 --> 00:00:02,000\nHi\n".toByteArray(),
          "setup.exe" to ByteArray(10),
          "clip.mp4.exe" to ByteArray(10),
          "readme.txt" to ByteArray(10),
          "__MACOSX/._Ep 1.mp4" to ByteArray(10),
          "Season 1/" to ByteArray(0),
        ),
      ),
    ) as ZipListing.Ok
    val kinds = listing.entries.associate { it.name to it.kind }
    assertEquals(ArchiveEntryKind.VIDEO, kinds["Season 1/Ep 1.mp4"])
    assertEquals(ArchiveEntryKind.SUBTITLE, kinds["Season 1/Ep 1.en.srt"])
    assertEquals(ArchiveEntryKind.PROGRAM, kinds["setup.exe"])
    assertEquals(ArchiveEntryKind.PROGRAM, kinds["clip.mp4.exe"])
    assertEquals(ArchiveEntryKind.OTHER, kinds["readme.txt"])
    assertEquals(ArchiveEntryKind.OTHER, kinds["__MACOSX/._Ep 1.mp4"])
    assertTrue("folders are not entries", "Season 1/" !in kinds)
  }

  @Test fun `extracts deflated and stored entries exactly`() {
    for (stored in listOf(false, true)) {
      val bytes = zip(listOf("a.mp4" to video), stored)
      val source = BytesArchiveSource(bytes)
      val entry = (ZipArchive.list(source) as ZipListing.Ok).entries.single()
      val out = ByteArrayOutputStream()
      assertEquals(video.size.toLong(), ZipArchive.extract(source, entry, out))
      assertArrayEquals(video, out.toByteArray())
      assertArrayEquals(video.copyOf(100), ZipArchive.prefix(source, entry, 100))
    }
  }

  @Test fun `zip slip paths refuse the whole archive`() {
    for (name in listOf("../evil.mp4", "a/../../evil.mp4", "/sdcard/evil.mp4", "C:/evil.mp4", "..\\evil.mp4")) {
      assertEquals(name, ArchiveRefusal.PATH_ESCAPE, refusal(zip(listOf("ok.mp4" to video, name to video))))
    }
    assertTrue(!ZipArchive.escapes("dir/..name.mp4"))
  }

  @Test fun `more than 1000 entries are refused`() {
    val many = (0..ZipArchive.MAX_ENTRIES).map { "f$it.txt" to ByteArray(1) }
    assertEquals(ArchiveRefusal.TOO_MANY_ENTRIES, refusal(zip(many)))
    assertTrue(list(zip(many.drop(1))) is ZipListing.Ok)
  }

  @Test fun `a zip bomb by compression ratio is refused`() {
    val zeros = ByteArray(5 * 1024 * 1024)
    assertEquals(ArchiveRefusal.COMPRESSION_RATIO, refusal(zip(listOf("zeros.mp4" to zeros))))
    // Small, highly compressible files (subtitles) are fine.
    assertTrue(list(zip(listOf("a.srt" to ByteArray(200_000)))) is ZipListing.Ok)
  }

  @Test fun `contents over 4 GB are refused from the directory alone`() {
    val bytes = zip(listOf("a.mp4" to video, "b.mp4" to video))
    for (index in 0..1) {
      val at = centralAt(bytes, index)
      putU32(bytes, at + 20, 40L * 1024 * 1024) // compressed size (keeps the ratio under 100)
      putU32(bytes, at + 24, 0xF0000000L) // uncompressed ~3.75 GB each
    }
    assertEquals(ArchiveRefusal.TOO_LARGE, refusal(bytes))
  }

  @Test fun `an entry that inflates past its stated size is stopped while extracting`() {
    val data = ByteArray(300_000) { (it % 7).toByte() }
    val bytes = zip(listOf("a.mp4" to data))
    putU32(bytes, centralAt(bytes, 0) + 24, 1000) // the directory lies: 1000 bytes
    val source = BytesArchiveSource(bytes)
    val entry = (ZipArchive.list(source) as ZipListing.Ok).entries.single()
    try {
      ZipArchive.extract(source, entry, ByteArrayOutputStream())
      fail("extracted past the stated size")
    } catch (e: ArchiveRefusedException) {
      assertEquals(ArchiveRefusal.COMPRESSION_RATIO, e.refusal)
    }
  }

  @Test fun `encrypted entries refuse the archive`() {
    val bytes = zip(listOf("a.mp4" to video))
    putU16(bytes, centralAt(bytes, 0) + 8, 0x0001)
    assertEquals(ArchiveRefusal.ENCRYPTED, refusal(bytes))
    val aes = zip(listOf("a.mp4" to video))
    putU16(aes, centralAt(aes, 0) + 10, 99)
    assertEquals(ArchiveRefusal.ENCRYPTED, refusal(aes))
  }

  @Test fun `a checksum that does not match is damaged`() {
    val bytes = zip(listOf("a.mp4" to video))
    putU32(bytes, centralAt(bytes, 0) + 16, 0x12345678)
    val source = BytesArchiveSource(bytes)
    val entry = (ZipArchive.list(source) as ZipListing.Ok).entries.single()
    try {
      ZipArchive.extract(source, entry, ByteArrayOutputStream())
      fail("bad CRC accepted")
    } catch (e: ArchiveRefusedException) {
      assertEquals(ArchiveRefusal.DAMAGED, e.refusal)
    }
  }

  @Test fun `RAR, 7z, other files and APKs are named, not opened`() {
    assertEquals(ArchiveRefusal.RAR, refusal(byteArrayOf(0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00) + ByteArray(64)))
    assertEquals(ArchiveRefusal.SEVEN_Z, refusal(byteArrayOf(0x37, 0x7A, 0xBC.toByte(), 0xAF.toByte(), 0x27, 0x1C, 0, 4) + ByteArray(64)))
    assertEquals(ArchiveRefusal.NOT_ZIP, refusal("just text".toByteArray()))
    assertEquals(ArchiveRefusal.DAMAGED, refusal(zip(listOf("a.mp4" to video)).copyOf(200)))
    assertEquals(
      ArchiveRefusal.ANDROID_APP,
      refusal(zip(listOf("AndroidManifest.xml" to ByteArray(8), "classes.dex" to ByteArray(8), "res/a.png" to ByteArray(4)))),
    )
  }
}
