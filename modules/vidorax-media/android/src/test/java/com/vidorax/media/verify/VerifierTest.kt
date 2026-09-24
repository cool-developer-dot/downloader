package com.vidorax.media.verify

import com.vidorax.media.model.Container
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class VerifierTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun fixtureFile(path: String, name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream(path)) { "missing fixture $path" }.use { it.readBytes() }
    return tmp.newFile(name).apply { writeBytes(bytes) }
  }

  @Test fun acceptsCompleteMp4WithMatchingLength() {
    val file = fixtureFile("/media/progressive/av.mp4", "ok.mp4")
    val result = Verifier.verify(file, VerifyExpectation(container = Container.MP4, expectedBytes = file.length()))
    assertValid(result)
  }

  @Test fun acceptsMp4WithNoExpectations() {
    assertValid(Verifier.verify(fixtureFile("/media/progressive/video-only.mp4", "v.mp4")))
  }

  @Test fun acceptsWebm() {
    val bytes = byteArrayOf(0x1A, 0x45, 0xDF.toByte(), 0xA3.toByte()) + "  webm  ".toByteArray() + ByteArray(64)
    val file = tmp.newFile("v.webm").apply { writeBytes(bytes) }
    assertValid(Verifier.verify(file, VerifyExpectation(container = Container.WEBM)))
  }

  @Test fun rejectsTruncatedAgainstExpectedLength() {
    val full = checkNotNull(javaClass.getResourceAsStream("/media/progressive/av.mp4")).use { it.readBytes() }
    val file = tmp.newFile("short.mp4").apply { writeBytes(full.copyOfRange(0, 1000)) }
    assertInvalid(Verifier.verify(file, VerifyExpectation(expectedBytes = full.size.toLong())))
  }

  @Test fun rejectsOversizedAgainstExpectedLength() {
    val full = checkNotNull(javaClass.getResourceAsStream("/media/progressive/av.mp4")).use { it.readBytes() }
    val file = tmp.newFile("long.mp4").apply { writeBytes(full + ByteArray(500)) }
    assertInvalid(Verifier.verify(file, VerifyExpectation(expectedBytes = full.size.toLong())))
  }

  @Test fun rejectsCorruptBytes() {
    val file = tmp.newFile("junk.bin").apply { writeBytes(ByteArray(4096) { (it * 31).toByte() }) }
    assertInvalid(Verifier.verify(file))
  }

  @Test fun rejectsEmptyFile() {
    assertInvalid(Verifier.verify(tmp.newFile("empty.mp4")))
  }

  @Test fun rejectsContainerMismatch() {
    val file = fixtureFile("/media/progressive/av.mp4", "mismatch.mp4")
    assertInvalid(Verifier.verify(file, VerifyExpectation(container = Container.WEBM)))
  }

  @Test fun rejectsIsolatedFragmentFile() {
    val file = fixtureFile("/media/hls-fmp4/video0.m4s", "frag.m4s")
    assertInvalid(Verifier.verify(file))
  }

  @Test fun rejectsMissingFile() {
    assertInvalid(Verifier.verify(File(tmp.root, "does-not-exist.mp4")))
  }

  @Test fun anAssembledTransportStreamIsValidOnlyWhenOneIsExpected() {
    val bytes = listOf("/media/hls-ts/seg0.ts", "/media/hls-ts/seg1.ts").flatMap {
      checkNotNull(javaClass.getResourceAsStream(it)).use { s -> s.readBytes() }.toList()
    }.toByteArray()
    val file = tmp.newFile("stream.ts").apply { writeBytes(bytes) }
    assertValid(Verifier.verify(file, VerifyExpectation(container = Container.TS, expectedBytes = bytes.size.toLong())))
    assertInvalid(Verifier.verify(file))
    assertInvalid(Verifier.verify(file, VerifyExpectation(container = Container.MP4)))
  }

  @Test fun anAssembledFmp4IsAValidMp4() {
    val init = checkNotNull(javaClass.getResourceAsStream("/media/hls-fmp4/video-init.mp4")).use { it.readBytes() }
    val fragment = checkNotNull(javaClass.getResourceAsStream("/media/hls-fmp4/video0.m4s")).use { it.readBytes() }
    val file = tmp.newFile("stream.mp4").apply { writeBytes(init + fragment + fragment) }
    assertValid(Verifier.verify(file, VerifyExpectation(container = Container.MP4, expectedBytes = file.length())))
  }

  @Test fun encryptedTracksInAMoovStoredAfterTheMediaAreProtectedNotCorrupt() {
    // ftyp, a large mdat (so the moov is far beyond the 64 KiB header read), then a moov declaring an encv track.
    val ftyp = box("ftyp", "isom".toByteArray() + ByteArray(4) + "isom".toByteArray())
    val mdat = box("mdat", ByteArray(200_000))
    val moov = box("moov", box("trak", box("encv", ByteArray(32)) + box("sinf", ByteArray(16))))
    val file = tmp.newFile("late-moov.mp4").apply { writeBytes(ftyp + mdat + moov) }

    val result = Verifier.verify(file, VerifyExpectation(container = Container.MP4))
    assertInvalid(result)
    org.junit.Assert.assertEquals(com.vidorax.media.model.ProbeFailure.DRM_PROTECTED, (result as VerifyResult.Invalid).reason)

    val clear = tmp.newFile("clear-late-moov.mp4").apply { writeBytes(ftyp + mdat + box("moov", box("trak", box("avc1", ByteArray(32))))) }
    assertValid(Verifier.verify(clear, VerifyExpectation(container = Container.MP4)))
  }

  private fun box(type: String, payload: ByteArray): ByteArray {
    val size = 8 + payload.size
    return byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()) +
      type.toByteArray(Charsets.US_ASCII) + payload
  }

  private fun assertValid(result: VerifyResult) =
    assertTrue("expected Valid, got $result", result is VerifyResult.Valid)

  private fun assertInvalid(result: VerifyResult) =
    assertTrue("expected Invalid, got $result", result is VerifyResult.Invalid)
}
