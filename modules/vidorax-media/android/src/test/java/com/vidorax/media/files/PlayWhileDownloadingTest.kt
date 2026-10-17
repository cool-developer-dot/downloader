package com.vidorax.media.files

import com.vidorax.media.files.Mp4Layout.Verdict
import com.vidorax.media.files.PlayWhileDownloading.Facts
import com.vidorax.media.files.PlayWhileDownloading.Refusal
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.SourceKind
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * H20 Play While Downloading (#411): which `.part` files can be played, how much of them, and how the reader behind
 * the player waits for the download at the end of what is there.
 */
class PlayWhileDownloadingTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun box(type: String, payload: ByteArray = ByteArray(0)): ByteArray {
    val out = ByteArrayOutputStream()
    val size = 8 + payload.size
    out.write(byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()))
    out.write(type.toByteArray(Charsets.ISO_8859_1))
    out.write(payload)
    return out.toByteArray()
  }

  private fun fullBox(type: String, vararg children: ByteArray) = box(type, ByteArray(8) + children.fold(ByteArray(0)) { a, b -> a + b })

  private fun container(type: String, vararg children: ByteArray) = box(type, children.fold(ByteArray(0)) { a, b -> a + b })

  private val ftyp = box("ftyp", "isom\u0000\u0000\u0002\u0000isomiso2avc1mp41".toByteArray(Charsets.ISO_8859_1))

  private fun moov(sampleEntry: String = "avc1", extra: ByteArray = ByteArray(0)) = container(
    "moov",
    box("mvhd", ByteArray(100)),
    container("trak", container("mdia", container("minf", container("stbl", fullBox("stsd", box(sampleEntry, ByteArray(78))))))),
    extra,
  )

  private fun layout(bytes: ByteArray, available: Long = bytes.size.toLong()) =
    Mp4Layout.inspect(available) { offset, length ->
      if (offset + length > bytes.size) null else bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
    }

  // --- the MP4 layout ---

  @Test fun aFastStartFileHasItsIndexFirst() {
    val index = moov()
    val bytes = ftyp + index + box("mdat", ByteArray(1_000))
    assertEquals(Verdict.FastStart((ftyp.size + index.size).toLong()), layout(bytes))
    assertEquals("free space before the index is fine", Verdict.FastStart((ftyp.size + 16 + index.size).toLong()), layout(ftyp + box("free", ByteArray(8)) + index + box("mdat")))
  }

  @Test fun anIndexAtTheEndOrNoIndexYetCannotBePlayed() {
    assertEquals(Verdict.IndexAtEnd, layout(ftyp + box("mdat", ByteArray(1_000)) + moov()))
    val bytes = ftyp + moov() + box("mdat")
    assertEquals("the index is not all on disk", Verdict.Incomplete, layout(bytes, available = (ftyp.size + 20).toLong()))
    assertEquals(Verdict.Incomplete, layout(ftyp, available = 4))
  }

  @Test fun fragmentedAndEncryptedFilesAreRefused() {
    assertEquals(Verdict.Fragmented, layout(ftyp + moov(extra = container("mvex", box("trex", ByteArray(24)))) + box("moof")))
    assertEquals(Verdict.Fragmented, layout(ftyp + box("moof", ByteArray(16)) + box("mdat")))
    assertEquals(Verdict.Encrypted, layout(ftyp + moov(sampleEntry = "encv") + box("mdat")))
    assertEquals(Verdict.Encrypted, layout(ftyp + moov(extra = box("pssh", ByteArray(32))) + box("mdat")))
  }

  @Test fun anythingThatIsNotAnMp4IsRefused() {
    assertEquals(Verdict.NotMp4, layout(box("mdat", ByteArray(100))))
    assertEquals(Verdict.NotMp4, layout("\u001aEß£ webm...".toByteArray(Charsets.ISO_8859_1) + ByteArray(32)))
    assertEquals(Verdict.NotMp4, layout(ByteArray(64) { 0x47 }))
  }

  @Test fun aLargeBoxSizeIsRead() {
    // A 64-bit `mdat` size before the index still means the index comes last.
    val large = byteArrayOf(0, 0, 0, 1) + "mdat".toByteArray() + byteArrayOf(0, 0, 0, 0, 0, 0, 0, 16)
    assertEquals(Verdict.IndexAtEnd, layout(ftyp + large + moov()))
  }

  // --- the rules ---

  private fun facts(
    state: DownloadState = DownloadState.DOWNLOADING,
    kind: SourceKind = SourceKind.PROGRESSIVE,
    segmentedOrSplit: Boolean = false,
    total: Long? = 50_000_000,
    prefix: Long? = 10_000_000,
    layout: Verdict = Verdict.FastStart(400_000),
    sdk: Int = 34,
  ) = Facts(state, kind, segmentedOrSplit, total, prefix, layout, sdk)

  @Test fun aProgressiveFastStartMp4WithEnoughBytesCanBePlayed() {
    for (state in listOf(DownloadState.DOWNLOADING, DownloadState.PAUSED, DownloadState.QUEUED, DownloadState.WAITING_NETWORK, DownloadState.WAITING_RETRY, DownloadState.PROBING)) {
      assertNull("$state", PlayWhileDownloading.refusal(facts(state = state)))
    }
    assertNull("the whole file is there", PlayWhileDownloading.refusal(facts(total = 1_000_000, prefix = 1_000_000)))
  }

  @Test fun streamsSplitTracksAndProcessingAreNeverOffered() {
    assertEquals(Refusal.STREAM, PlayWhileDownloading.refusal(facts(kind = SourceKind.HLS)))
    assertEquals(Refusal.STREAM, PlayWhileDownloading.refusal(facts(kind = SourceKind.DASH)))
    assertEquals(Refusal.STREAM, PlayWhileDownloading.refusal(facts(kind = SourceKind.SPLIT)))
    assertEquals("a file whose bytes turned out to be a playlist", Refusal.STREAM, PlayWhileDownloading.refusal(facts(segmentedOrSplit = true)))
    assertEquals(Refusal.PROCESSING, PlayWhileDownloading.refusal(facts(state = DownloadState.PROCESSING)))
    for (state in listOf(DownloadState.COMPLETED, DownloadState.FAILED, DownloadState.CANCELLED)) {
      assertEquals("$state", Refusal.NOT_DOWNLOADING, PlayWhileDownloading.refusal(facts(state = state)))
    }
  }

  @Test fun notEnoughBytesAnUnknownSizeOrAnOldAndroidWait() {
    assertEquals(Refusal.NOT_ENOUGH_BYTES, PlayWhileDownloading.refusal(facts(prefix = 400_000 + PlayWhileDownloading.MIN_MEDIA_BYTES - 1)))
    assertNull(PlayWhileDownloading.refusal(facts(prefix = 400_000 + PlayWhileDownloading.MIN_MEDIA_BYTES)))
    assertEquals(Refusal.NOT_ENOUGH_BYTES, PlayWhileDownloading.refusal(facts(layout = Verdict.Incomplete)))
    assertEquals(Refusal.NOT_ENOUGH_BYTES, PlayWhileDownloading.refusal(facts(prefix = null)))
    assertEquals(Refusal.UNKNOWN_SIZE, PlayWhileDownloading.refusal(facts(total = null)))
    assertEquals(Refusal.UNSUPPORTED_DEVICE, PlayWhileDownloading.refusal(facts(sdk = 25)))
    assertEquals(Refusal.INDEX_AT_END, PlayWhileDownloading.refusal(facts(layout = Verdict.IndexAtEnd)))
    assertEquals(Refusal.FRAGMENTED, PlayWhileDownloading.refusal(facts(layout = Verdict.Fragmented)))
    assertEquals(Refusal.ENCRYPTED, PlayWhileDownloading.refusal(facts(layout = Verdict.Encrypted)))
    assertEquals(Refusal.NOT_MP4, PlayWhileDownloading.refusal(facts(layout = Verdict.NotMp4)))
  }

  // --- the contiguous prefix (the one place F1 changes) ---

  @Test fun aSingleConnectionPartIsPlayableUpToItsLength() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(1_234)) }
    assertEquals(1_234L, PlayablePrefix.of(part))
    assertEquals(0L, PlayablePrefix.of(File(tmp.root, "missing.part")))
  }

  @Test fun aMultiConnectionPartIsNotOfferedUntilF1SaysWhatIsContiguous() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(10_000)) }
    File(part.path + ".parts").writeText("{\"v\":1}")
    assertNull(PlayablePrefix.of(part))
  }

  // --- the reader behind the player ---

  private class Clock {
    var now = 0L
  }

  private fun reader(part: File, total: Long, clock: Clock, onSleep: (Long) -> Unit = {}) = GrowingFileReader(
    RandomAccessFile(part, "r"),
    total,
    part,
    sleep = { ms ->
      clock.now += ms
      onSleep(ms)
    },
    clock = { clock.now },
    pollMs = 100,
    maxWaitMs = 1_000,
  )

  @Test fun bytesThatAreThereAreServedAtOnceAndTheEndOfTheFileIsEmpty() {
    val bytes = ByteArray(5_000) { it.toByte() }
    val part = tmp.newFile("download.part").apply { writeBytes(bytes) }
    val clock = Clock()
    val reader = reader(part, 10_000, clock)
    val out = ByteArray(4_096)
    assertEquals(4_096, reader.read(0, 4_096, out))
    assertArrayEquals(bytes.copyOfRange(0, 4_096), out)
    assertEquals("a short read up to what is there", 904, reader.read(4_096, 4_096, out))
    assertEquals(0, reader.read(10_000, 10, out))
    assertEquals(10_000L, reader.size())
    assertEquals("no waiting", 0L, clock.now)
  }

  @Test fun aReadPastTheDownloadWaitsForMoreBytes() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(1_000) { 1 }) }
    val clock = Clock()
    var sleeps = 0
    val reader = reader(part, 4_000, clock) {
      // The download writes more while the player waits.
      if (++sleeps == 3) part.appendBytes(ByteArray(1_000) { 2 })
    }
    val out = ByteArray(500)
    assertEquals(500, reader.read(1_000, 500, out))
    assertArrayEquals(ByteArray(500) { 2 }, out)
    assertEquals(300L, clock.now)
  }

  @Test fun nothingArrivingInTimeIsAnErrorThePlayerRetriesOrShows() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(1_000)) }
    val reader = reader(part, 4_000, Clock())
    assertThrows(IOException::class.java) { reader.read(1_000, 100, ByteArray(100)) }
  }

  @Test fun aDownloadThatStartedAgainFromZeroStopsPlayback() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(3_000)) }
    val reader = reader(part, 4_000, Clock())
    reader.read(0, 3_000, ByteArray(3_000))
    RandomAccessFile(part, "rw").use { it.setLength(100) }
    assertThrows(IOException::class.java) { reader.read(0, 10, ByteArray(10)) }
  }

  @Test fun aCompletedDownloadMovedIntoTheLibraryIsStillServedInFull() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(4_000) { 5 }) }
    val reader = reader(part, 4_000, Clock())
    val moved = File(tmp.root, "library.mp4")
    check(part.renameTo(moved))
    val out = ByteArray(1_000)
    assertEquals(1_000, reader.read(3_000, 1_000, out))
    assertArrayEquals(ByteArray(1_000) { 5 }, out)
  }

  @Test fun aCancelledDownloadIsNotServed() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(2_000)) }
    val reader = reader(part, 4_000, Clock())
    check(part.delete())
    assertThrows(IOException::class.java) { reader.read(0, 10, ByteArray(10)) }
  }

  @Test fun aPartThatTurnedMultiConnectionIsNotGuessedAt() {
    val part = tmp.newFile("download.part").apply { writeBytes(ByteArray(4_000)) }
    val reader = reader(part, 4_000, Clock())
    File(part.path + ".parts").writeText("{}")
    assertThrows(IOException::class.java) { reader.read(0, 10, ByteArray(10)) }
  }

  // --- sessions ---

  @Test fun sessionsHaveUnguessableTokensAndAreBounded() {
    PlaybackSessions.clearForTests()
    val part = File("download.part")
    val tokens = (1..6).map { PlaybackSessions.open(PlaybackSessions.Session("dl-$it", part, 10)) }
    tokens.forEach { assertEquals(32, it.length) }
    assertEquals(6, tokens.toSet().size)
    assertNull("the oldest went first", PlaybackSessions.get(tokens[0]))
    assertEquals("dl-6", PlaybackSessions.get(tokens[5])?.downloadId)
    PlaybackSessions.close(tokens[5])
    assertNull(PlaybackSessions.get(tokens[5]))
    PlaybackSessions.clearForTests()
  }
}
