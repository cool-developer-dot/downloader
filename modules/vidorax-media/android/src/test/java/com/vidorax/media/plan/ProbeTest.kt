package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Robolectric: an HLS classification reaches Media3's parser, which needs a real android.net.Uri.
@RunWith(RobolectricTestRunner::class)
class ProbeTest {
  private lateinit var server: MockWebServer
  private val probe = Probe(HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL))

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private val context = RequestContext(null, null, null, emptyMap(), useCookies = false)

  private fun request(url: String, manifestText: String? = null) =
    ProbeRequest(url = url, kind = null, manifestText = manifestText, request = context)

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing fixture $path" }.use { it.readBytes() }

  @Test fun probesProgressiveMp4Successfully() = runBlocking {
    val bytes = fixture("/media/progressive/av.mp4")
    server.enqueue(
      MockResponse()
        .setResponseCode(206)
        .setHeader("Content-Type", "video/mp4")
        .setHeader("Content-Range", "bytes 0-${bytes.size - 1}/${bytes.size}")
        .setBody(Buffer().write(bytes)),
    )

    val result = probe.probe(request(server.url("/clip.mp4").toString()))

    assertTrue(result is ProbeResult.Success)
    result as ProbeResult.Success
    assertEquals(com.vidorax.media.model.SourceKind.PROGRESSIVE, result.kind)
    assertEquals(Container.MP4, result.container)
    assertEquals(bytes.size.toLong(), result.sizeBytes)
    assertTrue(result.resumable)
    assertTrue(result.variants.isEmpty())
  }

  @Test fun probesExtensionlessUrlFromBytes() = runBlocking {
    val bytes = fixture("/media/progressive/video-only.mp4")
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))

    val result = probe.probe(request(server.url("/stream/7f3a9b2c").toString()))

    assertTrue(result is ProbeResult.Success)
    assertEquals(Container.MP4, (result as ProbeResult.Success).container)
  }

  @Test fun rejectsInlineDashManifestWithoutNetwork() = runBlocking {
    val result = probe.probe(request("https://cdn.example/manifest.mpd", manifestText = "<MPD></MPD>"))
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
    assertEquals(0, server.requestCount)
  }

  // ---------- DASH: the manifest picks the representation, the representation's bytes decide ----------

  private fun muxedMpd(file: String = "av-360.mp4") = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!-- packaged for tests -->
    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S" minBufferTime="PT2S">
      <Period>
        <AdaptationSet mimeType="video/mp4" contentType="video">
          <Representation id="av-360" bandwidth="800000" width="640" height="360" codecs="avc1.42c01e,mp4a.40.2">
            <BaseURL>$file</BaseURL>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>
  """.trimIndent()

  private fun dashRequest(path: String) =
    ProbeRequest(url = server.url(path).toString(), kind = com.vidorax.media.model.SourceKind.DASH, manifestText = null, request = context)

  private fun mpdResponse(body: String) = MockResponse().setHeader("Content-Type", "application/dash+xml").setBody(body)

  private fun fileResponse(bytes: ByteArray, type: String = "video/mp4") =
    MockResponse().setResponseCode(200).setHeader("Content-Type", type).setBody(Buffer().write(bytes))

  @Test fun aDashManifestIsClassifiedByTheRepresentationItWouldDownload() = runBlocking {
    val file = fixture("/media/progressive/av.mp4")
    server.enqueue(mpdResponse(muxedMpd()))
    server.enqueue(fileResponse(file))

    val result = probe.probe(dashRequest("/d/muxed.mpd"))

    assertTrue("got $result", result is ProbeResult.Success)
    result as ProbeResult.Success
    assertEquals(com.vidorax.media.model.SourceKind.DASH, result.kind)
    assertEquals(server.url("/d/muxed.mpd").toString(), result.finalUrl)
    assertEquals(Container.MP4, result.container)
    assertEquals("the representation file's own size", file.size.toLong(), result.sizeBytes)
    assertEquals(listOf("av-360"), result.variants.map { it.id })
    assertEquals("mp4a.40.2", result.audioTracks.single().codec)
    assertEquals(10_000L, result.durationMs)
    assertEquals("/d/av-360.mp4", server.takeRequest().let { server.takeRequest() }.requestUrl!!.encodedPath)
  }

  @Test fun anMpdBehindAnExtensionlessUrlIsClassifiedAsTheDashStreamItIs() = runBlocking {
    server.enqueue(mpdResponse(muxedMpd()))
    server.enqueue(mpdResponse(muxedMpd()))
    server.enqueue(fileResponse(fixture("/media/progressive/av.mp4")))

    val result = probe.probe(request(server.url("/stream/manifest").toString()))

    assertTrue("got $result", result is ProbeResult.Success)
    assertEquals(com.vidorax.media.model.SourceKind.DASH, (result as ProbeResult.Success).kind)
  }

  @Test fun aRepresentationWhoseBytesAreAudioOnlyIsNotAVideo() = runBlocking {
    // The manifest says audio and video; the file says audio only — the bytes win.
    server.enqueue(mpdResponse(muxedMpd()))
    server.enqueue(fileResponse(fixture("/media/formats/audio.m4a")))
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, probe.probe(dashRequest("/d/muxed.mpd")))
  }

  @Test fun aRepresentationWithEncryptionBoxesIsProtected() = runBlocking {
    server.enqueue(mpdResponse(muxedMpd()))
    server.enqueue(fileResponse(fixture("/media/progressive/av.mp4") + mp4Box("pssh", ByteArray(24))))
    assertUnsupported(ProbeFailure.DRM_PROTECTED, probe.probe(dashRequest("/d/muxed.mpd")))
  }

  @Test fun aTemporaryFailureOnTheRepresentationStaysTransient() = runBlocking {
    server.enqueue(mpdResponse(muxedMpd()))
    server.enqueue(MockResponse().setResponseCode(503))
    val result = probe.probe(dashRequest("/d/muxed.mpd"))
    assertUnsupported(ProbeFailure.HTTP_ERROR, result)
    assertEquals(503, (result as ProbeResult.Failure).httpStatus)
  }

  @Test fun aManifestWithoutPeriodsIsUnsupported() = runBlocking {
    val empty = """<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"></MPD>"""
    server.enqueue(mpdResponse(empty))
    server.enqueue(mpdResponse(empty))
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, probe.probe(request(server.url("/m.mpd").toString())))
  }

  // ---------- the progressive format matrix, from real files ----------

  @Test fun aQuickTimeMovIsAProgressiveVideo() = runBlocking {
    server.enqueue(fileResponse(fixture("/media/formats/qt.mov"), "video/quicktime"))
    val result = probe.probe(request(server.url("/clip.mov").toString()))
    assertTrue("got $result", result is ProbeResult.Success)
    assertEquals(Container.MOV, (result as ProbeResult.Success).container)
  }

  @Test fun aWebmWithVideoIsAProgressiveVideo() = runBlocking {
    server.enqueue(fileResponse(fixture("/media/formats/video.webm"), "video/webm"))
    val result = probe.probe(request(server.url("/clip.webm").toString()))
    assertTrue("got $result", result is ProbeResult.Success)
    assertEquals(Container.WEBM, (result as ProbeResult.Success).container)
  }

  @Test fun anAudioOnlyWebmIsNotAVideo() = runBlocking {
    server.enqueue(fileResponse(fixture("/media/formats/audio-only.webm"), "video/webm"))
    val result = probe.probe(request(server.url("/voice.webm").toString()))
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
    assertEquals("Audio only: the file has no video track", (result as ProbeResult.Failure).message)
  }

  @Test fun mp3AacAndM4aFilesAreAudioNotVideo() = runBlocking {
    val cases = listOf(
      Triple("/media/formats/with-id3.mp3", "audio/mpeg", "MP3"),
      Triple("/media/formats/no-id3.mp3", "audio/mpeg", "MP3"),
      Triple("/media/formats/audio.aac", "audio/aac", "AAC"),
      Triple("/media/formats/audio.m4a", "audio/mp4", "M4A"),
      // Its track list is past the 64 KiB the probe reads: the brand alone must refuse it before any download.
      Triple("/media/formats/audio-moov-at-end.m4a", "audio/mp4", "M4A"),
    )
    for ((path, type, said) in cases) {
      server.enqueue(fileResponse(fixture(path), type))
      val result = probe.probe(request(server.url("/a/${path.substringAfterLast('/')}").toString()))
      assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
      assertTrue("$path: ${(result as ProbeResult.Failure).message}", result.message!!.contains(said))
    }
  }

  @Test fun rejectsIsolatedFragment() = runBlocking {
    val bytes = fixture("/media/hls-fmp4/video0.m4s")
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, probe.probe(request(server.url("/seg.m4s").toString())))
  }

  @Test fun mapsHttp403() = runBlocking {
    server.enqueue(MockResponse().setResponseCode(403))
    val result = probe.probe(request(server.url("/denied").toString()))
    assertTrue(result is ProbeResult.Failure)
    assertEquals(ProbeFailure.HTTP_403, (result as ProbeResult.Failure).reason)
    assertEquals(403, result.httpStatus)
  }

  @Test fun mapsHttp404() = runBlocking {
    server.enqueue(MockResponse().setResponseCode(404))
    assertEquals(
      ProbeFailure.HTTP_404,
      (probe.probe(request(server.url("/missing").toString())) as ProbeResult.Failure).reason,
    )
  }

  @Test fun networkFailureIsTransientNotUnsupported() = runBlocking {
    val url = server.url("/gone").toString()
    server.shutdown()
    assertUnsupported(ProbeFailure.NETWORK, probe.probe(request(url)))
  }

  @Test fun blocksYouTubeByPolicyWithoutNetwork() = runBlocking {
    val result = probe.probe(request("https://www.youtube.com/watch?v=abc"))
    assertUnsupported(ProbeFailure.POLICY_BLOCKED, result)
    assertEquals(0, server.requestCount)
  }

  @Test fun anExtensionlessPlaylistIsClassifiedAsTheHlsStreamItIs() = runBlocking {
    val body = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\ns0.ts\n#EXT-X-ENDLIST\n"
    server.enqueue(MockResponse().setResponseCode(200).setBody(body))
    server.enqueue(MockResponse().setResponseCode(200).setBody(body))
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(fixture("/media/hls-ts/seg0.ts"))))

    val result = probe.probe(request(server.url("/watch/abc").toString()))

    assertTrue("got $result", result is ProbeResult.Success)
    assertEquals(com.vidorax.media.model.SourceKind.HLS, (result as ProbeResult.Success).kind)
    assertEquals(4_000L, result.durationMs)
    assertEquals("the first segment's head confirms it is video", 3, server.requestCount)
  }

  @Test fun aSubtitlePlaylistIsRefusedBeforeAnythingIsEnqueued() = runBlocking {
    // Players load a stream's subtitle playlist next to its video; on its own it is not a video.
    val subtitles = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6.0,\nseq0.webvtt\n#EXT-X-ENDLIST\n"
    server.enqueue(MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(subtitles))
    server.enqueue(MockResponse().setBody("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n"))
    val url = server.url("/s1/en/prog_index.m3u8").toString()

    val result = probe.probe(ProbeRequest(url = url, kind = com.vidorax.media.model.SourceKind.HLS, manifestText = null, request = context))

    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
  }

  @Test fun aServerThatAnswersTheWrongRangeIsNotClassifiedFromMidFileBytes() = runBlocking {
    server.enqueue(
      MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 500-999/1000").setBody(Buffer().write(ByteArray(500))),
    )
    val result = probe.probe(request(server.url("/v.mp4").toString()))
    assertEquals(ProbeFailure.HTTP_ERROR, (result as ProbeResult.Failure).reason)
  }

  @Test fun aRedirectLoopIsNotMediaAndNotATransientFailure() = runBlocking {
    repeat(HttpClient.MAX_REDIRECTS + 2) { server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/again")) }
    assertUnsupported(ProbeFailure.NOT_MEDIA, probe.probe(request(server.url("/again").toString())))
  }

  @Test fun theAudioHalfOfASplitStreamIsNotAVideo() = runBlocking {
    // A page that streams separate audio and video files exposes the audio file (served as video/mp4) on its own.
    val audio = fixture("/media/hls-fmp4/audio-init.mp4") + fixture("/media/hls-fmp4/audio0.m4s")
    server.enqueue(MockResponse().setHeader("Content-Type", "video/mp4").setBody(Buffer().write(audio)))

    val result = probe.probe(request(server.url("/a1/main.mp4").toString()))

    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
    assertEquals(1, server.requestCount)
  }

  @Test fun anEncryptedAudioOnlyFileIsStillReportedAsProtected() = runBlocking {
    val encrypted = fixture("/media/hls-fmp4/audio-init.mp4") + mp4Box("pssh", ByteArray(24))
    server.enqueue(MockResponse().setHeader("Content-Type", "video/mp4").setBody(Buffer().write(encrypted)))

    assertUnsupported(ProbeFailure.DRM_PROTECTED, probe.probe(request(server.url("/a1/enc.mp4").toString())))
  }

  /** A range-honouring server: the probe's `bytes=0-` read, then one bounded read of the boxes after the media. */
  private fun enqueueRangedFile(bytes: ByteArray, tailFrom: Long?) {
    server.enqueue(
      MockResponse().setResponseCode(206).setHeader("Content-Type", "video/mp4")
        .setHeader("Content-Range", "bytes 0-${bytes.size - 1}/${bytes.size}").setBody(Buffer().write(bytes)),
    )
    if (tailFrom != null) {
      val tail = bytes.copyOfRange(tailFrom.toInt(), bytes.size)
      server.enqueue(
        MockResponse().setResponseCode(206).setHeader("Content-Type", "video/mp4")
          .setHeader("Content-Range", "bytes $tailFrom-${bytes.size - 1}/${bytes.size}").setBody(Buffer().write(tail)),
      )
    }
  }

  @Test fun anEncryptedFileWhoseTrackListFollowsTheMediaIsProtectedBeforeAnyDownload() = runBlocking {
    val bytes = fixture("/media/formats/cenc-moov-at-end.mp4")
    enqueueRangedFile(bytes, tailFrom = 121_997L)

    val result = probe.probe(request(server.url("/v/enc.mp4").toString()))

    assertUnsupported(ProbeFailure.DRM_PROTECTED, result)
    assertEquals(2, server.requestCount)
    server.takeRequest()
    assertEquals("only the track list is read", "bytes=121997-${bytes.size - 1}", server.takeRequest().getHeader("Range"))
  }

  @Test fun aClearFileWhoseTrackListFollowsTheMediaIsStillAVideo() = runBlocking {
    val bytes = fixture("/media/formats/video-moov-at-end.mp4")
    enqueueRangedFile(bytes, tailFrom = 121_997L)

    val result = probe.probe(request(server.url("/v/clear.mp4").toString()))

    assertTrue("got $result", result is ProbeResult.Success)
    assertEquals(Container.MP4, (result as ProbeResult.Success).container)
    assertEquals(bytes.size.toLong(), result.sizeBytes)
  }

  @Test fun aSoundOnlyFileWhoseTrackListFollowsTheMediaIsNotAVideo() = runBlocking {
    // The audio half of a split stream saved without "fast start", with a generic brand and served as video/mp4.
    val bytes = fixture("/media/formats/audio-moov-at-end.mp4")
    enqueueRangedFile(bytes, tailFrom = MediaSniffer.trailingBoxesOffset(bytes.copyOf(Probe.PROBE_BYTES)))

    val result = probe.probe(request(server.url("/a/track.mp4").toString()))

    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
    assertTrue((result as ProbeResult.Failure).message!!.contains("Audio only"))
  }

  @Test fun aTrackListReadThatIsNotHonouredProvesNothing() = runBlocking {
    val bytes = fixture("/media/formats/cenc-moov-at-end.mp4")
    enqueueRangedFile(bytes, tailFrom = null)
    // The server answers the bounded read with the whole file: those are not the bytes asked for.
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))

    val result = probe.probe(request(server.url("/v/enc2.mp4").toString()))

    assertTrue("no verdict from the wrong bytes; the Verifier still checks the file: $result", result is ProbeResult.Success)
  }

  private fun mp4Box(type: String, payload: ByteArray): ByteArray {
    val size = 8 + payload.size
    return byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()) +
      type.toByteArray(Charsets.US_ASCII) + payload
  }

  private fun assertUnsupported(reason: ProbeFailure, result: ProbeResult) {
    assertTrue("expected Failure, got $result", result is ProbeResult.Failure)
    assertEquals(reason, (result as ProbeResult.Failure).reason)
  }
}
