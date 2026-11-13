package com.vidorax.media.files

import com.vidorax.media.engine.DownloadEngine
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import java.io.ByteArrayOutputStream
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * H20 `checkPlayable` / `getPlayableSource`: the answer's shape (VidoraMedia.types.ts `PlayableCheck` /
 * `PlayableSource`), the session behind a URI, and its release.
 */
@RunWith(RobolectricTestRunner::class)
class PlayableSourcesContractTest {
  @get:Rule val tmp = TemporaryFolder()

  private val context = RuntimeEnvironment.getApplication()
  private lateinit var workDir: File

  @Before fun setUp() {
    PlaybackSessions.clearForTests()
    workDir = tmp.newFolder("work", "dl")
  }

  @After fun tearDown() = PlaybackSessions.clearForTests()

  private fun box(type: String, payload: ByteArray): ByteArray {
    val size = 8 + payload.size
    return byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()) +
      type.toByteArray(Charsets.ISO_8859_1) + payload
  }

  /** ftyp + a small moov + the start of mdat, with [mediaBytes] of media. */
  private fun fastStartPart(mediaBytes: Int): File {
    val out = ByteArrayOutputStream()
    out.write(box("ftyp", "isom0000isom".toByteArray()))
    out.write(box("moov", box("mvhd", ByteArray(100))))
    out.write(box("mdat", ByteArray(mediaBytes)))
    return File(workDir, DownloadEngine.PART_NAME).apply { writeBytes(out.toByteArray()) }
  }

  private fun record(state: DownloadState = DownloadState.DOWNLOADING, kind: SourceKind = SourceKind.PROGRESSIVE, total: Long? = 50_000_000) =
    DownloadRecord(
      id = "dl",
      state = state,
      title = "Clip",
      site = SiteId.WEB,
      kind = kind,
      pageUrl = null,
      thumbnailUrl = null,
      qualityLabel = null,
      bytesDone = 0,
      totalBytes = total,
      errorCode = null,
      errorMessage = null,
      attempts = 0,
      libraryItemId = null,
      createdAt = 0,
      updatedAt = 0,
    )

  @Test fun aPlayableDownloadIsCheckedWithoutOpeningAnything() {
    fastStartPart(PlayWhileDownloading.MIN_MEDIA_BYTES.toInt() + 10)
    val answer = PlayableSources.answer(context, record(), workDir, open = false, sdk = 34)
    assertEquals(true, answer["playable"])
    assertEquals(50_000_000.0, answer["totalBytes"])
    assertTrue((answer["playableBytes"] as Double) > PlayWhileDownloading.MIN_MEDIA_BYTES)
    assertEquals("video/mp4", answer["mimeType"])
    assertFalse("no URI without opening", answer.containsKey("uri"))
  }

  @Test fun openingGivesAProviderUriBackedByASessionUntilItIsReleased() {
    val part = fastStartPart(PlayWhileDownloading.MIN_MEDIA_BYTES.toInt() + 10)
    val answer = PlayableSources.answer(context, record(), workDir, open = true, sdk = 34)
    val uri = answer["uri"] as String
    assertTrue(uri, Regex("^content://${Regex.escape(context.packageName)}\\.vidorax\\.growing/v/[0-9a-f]{32}$").matches(uri))
    val token = uri.substringAfterLast('/')
    val session = PlaybackSessions.get(token)!!
    assertEquals("dl", session.downloadId)
    assertEquals(part, session.partFile)
    assertEquals(50_000_000L, session.totalBytes)

    PlayableSources.release(uri)
    assertNull(PlaybackSessions.get(token))
    PlayableSources.release("content://elsewhere/v/not-a-token") // ignored
  }

  @Test fun aRefusalSaysWhy() {
    fastStartPart(10)
    fun reason(answer: Map<String, Any?>) = answer.also { assertEquals(false, it["playable"]) }["reason"]

    assertEquals("not_enough_bytes", reason(PlayableSources.answer(context, record(), workDir, open = true, sdk = 34)))
    assertEquals("not_found", reason(PlayableSources.answer(context, null, workDir, open = true, sdk = 34)))
    assertEquals("stream", reason(PlayableSources.answer(context, record(kind = SourceKind.HLS), workDir, open = true, sdk = 34)))
    assertEquals("processing", reason(PlayableSources.answer(context, record(state = DownloadState.PROCESSING), workDir, open = true, sdk = 34)))
    assertEquals("unknown_size", reason(PlayableSources.answer(context, record(total = null), workDir, open = true, sdk = 34)))
    assertEquals("unsupported_device", reason(PlayableSources.answer(context, record(), workDir, open = true, sdk = 24)))
    assertTrue("no session was opened for a refusal", PlaybackSessions.get("x") == null)
  }

  @Test fun aSplitDownloadIsNeverPlayedFromItsVideoTrack() {
    fastStartPart(PlayWhileDownloading.MIN_MEDIA_BYTES.toInt() + 10)
    File(workDir, DownloadEngine.AUDIO_PART_NAME).writeBytes(ByteArray(10))
    assertEquals("stream", PlayableSources.answer(context, record(), workDir, open = true, sdk = 34)["reason"])
  }
}
