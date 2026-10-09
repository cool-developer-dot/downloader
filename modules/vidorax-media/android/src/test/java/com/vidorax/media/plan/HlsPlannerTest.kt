package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The HLS planner through real Media3 parsing and real HTTP (MockWebServer): what gets downloaded, and what is
 * refused, for every playlist shape the product distinguishes.
 */
@RunWith(RobolectricTestRunner::class)
class HlsPlannerTest {
  private lateinit var server: MockWebServer
  private val routes = ConcurrentHashMap<String, () -> MockResponse>()
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val http = HttpClient.create(cookies = { url -> if (url.contains("/private/")) "sid=user" else null }, urlPolicy = UrlPolicy.ALLOW_ALL)
  private val planner = HlsPlanner(http)

  private val context = RequestContext(
    userAgent = "VidoraX-Test-UA",
    referer = "https://page.example/watch/1",
    origin = null,
    headers = emptyMap(),
    useCookies = false,
  )

  @Before fun setUp() {
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        val path = request.requestUrl!!.encodedPath
        val query = request.requestUrl!!.encodedQuery
        return routes["$path?$query"]?.invoke() ?: routes[path]?.invoke() ?: MockResponse().setResponseCode(404)
      }
    }
    server.start()
  }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun playlist(path: String, body: String) {
    routes[path] = { MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(body.trimIndent()) }
  }

  private fun url(path: String) = server.url(path).toString()

  private fun plan(path: String, choice: VariantChoice? = null, ctx: RequestContext = context, p: HlsPlanner = planner) =
    runBlocking { p.plan(url(path), ctx, choice) }

  private fun ready(result: HlsPlanResult): HlsPlan {
    if (result is HlsPlanResult.Refused) fail("expected a plan, got ${result.failure}")
    return (result as HlsPlanResult.Ready).plan
  }

  private fun refused(result: HlsPlanResult, reason: ProbeFailure): String? {
    if (result !is HlsPlanResult.Refused) fail("expected $reason, got a plan")
    result as HlsPlanResult.Refused
    assertEquals(reason, result.failure.reason)
    return result.failure.message
  }

  private val vod = """
    #EXTM3U
    #EXT-X-VERSION:3
    #EXT-X-TARGETDURATION:4
    #EXT-X-MEDIA-SEQUENCE:0
    #EXTINF:4.0,
    seg0.ts?token=abc
    #EXTINF:4.0,
    /abs/seg1.ts
    #EXTINF:2.5,
    https://cdn2.example.net/seg2.ts?sig=xyz&exp=99
    #EXT-X-ENDLIST
  """

  // ---------- media playlists ----------

  @Test fun aMediaPlaylistResolvesEverySegmentInOrderWithItsTokens() {
    playlist("/v/index.m3u8", vod)
    val plan = ready(plan("/v/index.m3u8"))

    assertEquals(
      listOf(url("/v/seg0.ts?token=abc"), url("/abs/seg1.ts"), "https://cdn2.example.net/seg2.ts?sig=xyz&exp=99"),
      plan.segments.map { it.media.url },
    )
    assertEquals(Container.TS, plan.containerHint)
    assertEquals(10_500_000L, plan.durationUs)
    assertNull("a media playlist enqueued directly has no variant to choose", plan.selected)
    assertTrue(plan.inits.isEmpty())
    assertEquals(url("/v/index.m3u8"), plan.mediaPlaylistUrl)
  }

  @Test fun aRedirectedPlaylistResolvesAgainstWhereItActuallyLives() {
    routes["/short"] = { MockResponse().setResponseCode(302).setHeader("Location", "/real/path/index.m3u8?t=1") }
    playlist("/real/path/index.m3u8", vod)
    val plan = ready(plan("/short"))
    assertEquals(url("/real/path/seg0.ts?token=abc"), plan.segments[0].media.url)
    assertEquals(url("/real/path/index.m3u8?t=1"), plan.sourceUrl)
  }

  @Test fun byteRangesAreExactIncludingImplicitOffsets() {
    playlist(
      "/br/index.m3u8",
      """
      #EXTM3U
      #EXT-X-VERSION:4
      #EXT-X-TARGETDURATION:4
      #EXTINF:4.0,
      #EXT-X-BYTERANGE:1000@0
      all.ts
      #EXTINF:4.0,
      #EXT-X-BYTERANGE:1500
      all.ts
      #EXTINF:4.0,
      #EXT-X-BYTERANGE:500@9000
      all.ts
      #EXT-X-ENDLIST
      """,
    )
    val segments = ready(plan("/br/index.m3u8")).segments.map { it.media.byteRangeOffset to it.media.byteRangeLength }
    assertEquals(listOf(0L to 1000L, 1000L to 1500L, 9000L to 500L), segments)
  }

  @Test fun anInitSectionIsSharedByTheSegmentsThatMapIt() {
    playlist(
      "/f/index.m3u8",
      """
      #EXTM3U
      #EXT-X-VERSION:7
      #EXT-X-TARGETDURATION:4
      #EXT-X-MAP:URI="init.mp4"
      #EXTINF:4.0,
      s0.m4s
      #EXTINF:4.0,
      s1.m4s
      #EXT-X-ENDLIST
      """,
    )
    val plan = ready(plan("/f/index.m3u8"))
    assertEquals(Container.MP4, plan.containerHint)
    assertEquals(listOf(url("/f/init.mp4")), plan.inits.map { it.url })
    assertEquals(listOf(0, 0), plan.segments.map { it.initIndex })
  }

  @Test fun anFmp4StreamThatSwitchesInitSectionsIsRefused() {
    playlist(
      "/f2/index.m3u8",
      """
      #EXTM3U
      #EXT-X-VERSION:7
      #EXT-X-TARGETDURATION:4
      #EXT-X-MAP:URI="a.mp4"
      #EXTINF:4.0,
      s0.m4s
      #EXT-X-DISCONTINUITY
      #EXT-X-MAP:URI="b.mp4"
      #EXTINF:4.0,
      s1.m4s
      #EXT-X-ENDLIST
      """,
    )
    refused(plan("/f2/index.m3u8"), ProbeFailure.UNSUPPORTED_FORMAT)
  }

  @Test fun aTransportStreamWithADiscontinuityIsStillDownloadable() {
    playlist(
      "/d/index.m3u8",
      """
      #EXTM3U
      #EXT-X-TARGETDURATION:4
      #EXTINF:4.0,
      a.ts
      #EXT-X-DISCONTINUITY
      #EXTINF:4.0,
      b.ts
      #EXT-X-ENDLIST
      """,
    )
    val plan = ready(plan("/d/index.m3u8"))
    assertTrue(plan.hasDiscontinuities)
    assertEquals(Container.TS, plan.containerHint)
  }

  // ---------- refusals ----------

  @Test fun aLivePlaylistIsUnsupportedNotAFailure() {
    playlist("/live.m3u8", vod.replace("#EXT-X-ENDLIST", ""))
    refused(plan("/live.m3u8"), ProbeFailure.LIVE_UNSUPPORTED)

    playlist("/event.m3u8", vod.replace("#EXT-X-ENDLIST", "").replace("#EXT-X-VERSION:3", "#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:EVENT"))
    refused(plan("/event.m3u8"), ProbeFailure.LIVE_UNSUPPORTED)
  }

  @Test fun aes128IsProtectedAndNothingButThePlaylistIsFetched() {
    playlist("/aes.m3u8", vod.replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://keys.example/k\""))
    refused(plan("/aes.m3u8"), ProbeFailure.DRM_PROTECTED)
    assertEquals("no key, no segment is ever requested", listOf("/aes.m3u8"), requests.map { it.requestUrl!!.encodedPath })
  }

  @Test fun sampleAesAndDrmKeyFormatsAreProtected() {
    playlist(
      "/sa.m3u8",
      vod.replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://key\",KEYFORMAT=\"com.apple.streamingkeydelivery\",KEYFORMATVERSIONS=\"1\""),
    )
    refused(plan("/sa.m3u8"), ProbeFailure.DRM_PROTECTED)

    playlist(
      "/wv.m3u8",
      vod.replace(
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI=\"data:text/plain;base64,AAAAW3Bzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAADsIARIQ62dqu8s0Xpa7z2FmMPGj2hoNd2lkZXZpbmVfdGVzdCIQZmtqM2xqYVNkZmFsa3IzaioCSEQyAA==\",KEYFORMAT=\"urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed\",KEYFORMATVERSIONS=\"1\"",
      ),
    )
    refused(plan("/wv.m3u8"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun sampleAesWithAnIdentityKeyIsProtectedAlthoughMedia3RecordsNothing() {
    playlist("/sai.m3u8", vod.replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"k\",IV=0x1"))
    refused(plan("/sai.m3u8"), ProbeFailure.DRM_PROTECTED)
    playlist("/unknown.m3u8", vod.replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:URI=\"k\""))
    refused(plan("/unknown.m3u8"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun aPublicPlaylistCannotPointSegmentsIntoThePrivateNetwork() {
    val guarded = HlsPlanner(HttpClient.create(urlPolicy = UrlPolicy { it.port == server.port || UrlPolicy.PUBLIC_ONLY.allows(it) }))
    playlist("/ssrf.m3u8", vod.replace("/abs/seg1.ts", "http://192.168.1.1/router.ts"))
    refused(plan("/ssrf.m3u8", p = guarded), ProbeFailure.POLICY_BLOCKED)
    assertEquals(listOf("/ssrf.m3u8"), requests.map { it.requestUrl!!.encodedPath })
  }

  @Test fun aKeyThatStartsHalfwayThroughStillMakesTheStreamProtected() {
    playlist(
      "/late.m3u8",
      """
      #EXTM3U
      #EXT-X-TARGETDURATION:4
      #EXTINF:4.0,
      a.ts
      #EXT-X-KEY:METHOD=AES-128,URI="k"
      #EXTINF:4.0,
      b.ts
      #EXT-X-ENDLIST
      """,
    )
    refused(plan("/late.m3u8"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun methodNoneIsNotEncryption() {
    playlist("/none.m3u8", vod.replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=NONE"))
    assertEquals(3, ready(plan("/none.m3u8")).segments.size)
  }

  @Test fun gapsAreRefused() {
    playlist("/gap.m3u8", vod.replace("/abs/seg1.ts", "#EXT-X-GAP\n/abs/seg1.ts"))
    refused(plan("/gap.m3u8"), ProbeFailure.UNSUPPORTED_FORMAT)
  }

  @Test fun anHtmlPageIsNotMediaAndGarbageIsUnsupported() {
    routes["/login"] = { MockResponse().setHeader("Content-Type", "text/html").setBody("<!DOCTYPE html><html>Sign in</html>") }
    refused(plan("/login"), ProbeFailure.NOT_MEDIA)

    routes["/bad.m3u8"] = { MockResponse().setBody("#EXTM3U\n#EXT-X-TARGETDURATION:abc\n#EXTINF:x,\n") }
    refused(plan("/bad.m3u8"), ProbeFailure.UNSUPPORTED_FORMAT)
  }

  @Test fun httpAndTransportFailuresKeepTheirTransientMeaning() {
    routes["/403"] = { MockResponse().setResponseCode(403) }
    routes["/503"] = { MockResponse().setResponseCode(503) }
    assertEquals(403, (plan("/403") as HlsPlanResult.Refused).failure.httpStatus)
    refused(plan("/403"), ProbeFailure.HTTP_403)
    refused(plan("/missing.m3u8"), ProbeFailure.HTTP_404)
    val serverError = plan("/503") as HlsPlanResult.Refused
    assertEquals(ProbeFailure.HTTP_ERROR, serverError.failure.reason)
    assertEquals(503, serverError.failure.httpStatus)

    val gone = url("/x.m3u8")
    server.shutdown()
    val offline = runBlocking { planner.plan(gone, context, null) }
    refused(offline, ProbeFailure.NETWORK)
  }

  @Test fun youtubeIsRefusedByPolicyWithoutARequest() {
    refused(runBlocking { planner.plan("https://manifest.googlevideo.com/api/hls/x.m3u8", context, null) }, ProbeFailure.POLICY_BLOCKED)
    assertTrue(requests.isEmpty())
  }

  // ---------- multivariant ----------

  private val master = """
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=800000,AVERAGE-BANDWIDTH=700000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
    low/index.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=30
    hi/index.m3u8?t=hi
    #EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
    https://cdn.example.org/mid/index.m3u8
  """

  private fun serveVariants() {
    playlist("/m/master.m3u8", master)
    playlist("/m/low/index.m3u8", vod)
    playlist("/m/hi/index.m3u8", vod)
  }

  @Test fun theBestDecodableVariantIsChosenAndEveryVariantIsDescribed() {
    serveVariants()
    val plan = ready(plan("/m/master.m3u8"))

    assertEquals(url("/m/hi/index.m3u8?t=hi"), plan.selected!!.id)
    assertEquals(1080, plan.selected!!.height)
    assertEquals(listOf(1080, 720, 360), plan.variants.map { it.height })
    assertEquals(listOf(5_000_000L, 2_500_000L, 800_000L), plan.variants.map { it.bitrate })
    assertEquals(30.0, plan.variants[0].frameRate!!, 0.01)
    assertEquals("avc1.640028", plan.variants[0].videoCodec)
    assertTrue(plan.variants.none { it.needsAudioMux })
    assertEquals(url("/m/hi/seg0.ts?token=abc"), plan.segments[0].media.url)
    // 4 Mbit/s average over 10.5 s.
    assertEquals(5_250_000L, plan.estimatedBytes)
  }

  @Test fun maxHeightPicksTheBestVariantThatFits() {
    serveVariants()
    val plan = ready(plan("/m/master.m3u8", VariantChoice(videoId = null, audioId = null, maxHeight = 480)))
    assertEquals(360, plan.selected!!.height)
    assertEquals(url("/m/low/seg0.ts?token=abc"), plan.segments[0].media.url)
  }

  @Test fun theExactVariantAskedForIsTheOneDownloadedEvenAfterItsTokenRotated() {
    serveVariants()
    val choice = VariantChoice(videoId = url("/m/low/index.m3u8?t=OLD"), audioId = null, maxHeight = null)
    assertEquals(360, ready(plan("/m/master.m3u8", choice)).selected!!.height)
  }

  @Test fun aVariantWithSeparateAudioIsPlannedWithItsAudioRendition() {
    playlist(
      "/a/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES,URI="audio/index.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud"
      hi/index.m3u8
      #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
      low/index.m3u8
      """,
    )
    playlist("/a/low/index.m3u8", vod)
    playlist("/a/hi/index.m3u8", vod)
    playlist("/a/audio/index.m3u8", vod)
    val auto = ready(plan("/a/master.m3u8"))
    assertEquals("the best quality, its sound merged from the rendition", 1080, auto.selected!!.height)
    val audio = checkNotNull(auto.audio)
    assertEquals(url("/a/audio/index.m3u8"), audio.mediaPlaylistUrl)
    assertEquals(url("/a/audio/seg0.ts?token=abc"), audio.segments.first().media.url)
    assertEquals("en", auto.audioInfo?.label)
    assertTrue(HlsPlanner.toProbeResult(auto).mergesAudio)

    val muxed = ready(plan("/a/master.m3u8", VariantChoice(videoId = url("/a/low/index.m3u8"), audioId = null, maxHeight = null)))
    assertNull("a variant with its own sound needs no rendition", muxed.audio)
  }

  @Test fun onlySeparateAudioVariantsDownloadTheDefaultRendition() {
    playlist(
      "/sep/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="fr",URI="fr.m3u8"
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES,URI="en.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028",AUDIO="aud"
      v.m3u8
      """,
    )
    playlist("/sep/v.m3u8", vod)
    playlist("/sep/en.m3u8", vod)
    playlist("/sep/fr.m3u8", vod)
    assertEquals(url("/sep/en.m3u8"), ready(plan("/sep/master.m3u8")).audio?.mediaPlaylistUrl)
    val french = VariantChoice(videoId = null, audioId = url("/sep/fr.m3u8"), maxHeight = null)
    assertEquals("the rendition asked for", url("/sep/fr.m3u8"), ready(plan("/sep/master.m3u8", french)).audio?.mediaPlaylistUrl)
  }

  @Test fun ofEqualQualitiesTheVariantWhoseSoundAnMp4CarriesWins() {
    // A stream offering each quality with AAC and with AC-3 sound (the AC-3 one at a higher bandwidth).
    playlist(
      "/ac3/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=YES,URI="aac.m3u8"
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ac3",NAME="English",DEFAULT=YES,URI="ac3.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.64002a,ac-3",AUDIO="ac3"
      v1080-ac3.m3u8
      #EXT-X-STREAM-INF:BANDWIDTH=7600000,RESOLUTION=1920x1080,CODECS="avc1.64002a,mp4a.40.2",AUDIO="aac"
      v1080-aac.m3u8
      """,
    )
    playlist("/ac3/v1080-ac3.m3u8", vod)
    playlist("/ac3/v1080-aac.m3u8", vod)
    playlist("/ac3/aac.m3u8", vod)
    playlist("/ac3/ac3.m3u8", vod)
    assertEquals(url("/ac3/aac.m3u8"), ready(plan("/ac3/master.m3u8")).audio?.mediaPlaylistUrl)
  }

  @Test fun aLiveOrEncryptedAudioRenditionRefusesTheStream() {
    playlist(
      "/lv/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES,URI="a.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028",AUDIO="aud"
      v.m3u8
      """,
    )
    playlist("/lv/v.m3u8", vod)
    playlist("/lv/a.m3u8", vod.replace("#EXT-X-ENDLIST", ""))
    refused(plan("/lv/master.m3u8"), ProbeFailure.LIVE_UNSUPPORTED)
    playlist("/lv/a.m3u8", vod.replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\""))
    refused(plan("/lv/master.m3u8"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun anAudioGroupWithoutItsOwnPlaylistIsMuxedAudio() {
    playlist(
      "/mux/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES
      #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud"
      v.m3u8
      """,
    )
    playlist("/mux/v.m3u8", vod)
    assertEquals(1080, ready(plan("/mux/master.m3u8")).selected!!.height)
  }

  @Test fun audioOnlyStreamsAreUnsupported() {
    playlist(
      "/ao/master.m3u8",
      """
      #EXTM3U
      #EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.5"
      a.m3u8
      """,
    )
    refused(plan("/ao/master.m3u8"), ProbeFailure.UNSUPPORTED_FORMAT)
  }

  @Test fun aVariantThisDeviceCannotDecodeIsSkipped() {
    playlist(
      "/codec/master.m3u8",
      """
      #EXTM3U
      #EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=3840x2160,CODECS="hvc1.2.4.L153.B0,mp4a.40.2"
      uhd.m3u8
      #EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
      hd.m3u8
      """,
    )
    playlist("/codec/hd.m3u8", vod)
    val noHevc = HlsPlanner(http, DecoderSupport { codecs, _, _ -> codecs?.contains("hvc1") != true })
    val plan = ready(plan("/codec/master.m3u8", p = noHevc))
    assertEquals(720, plan.selected!!.height)
    assertFalse(plan.variants.first { it.height == 2160 }.decodable)
  }

  @Test fun aSessionKeyInTheMultivariantPlaylistIsProtected() {
    playlist(
      "/sk/master.m3u8",
      """
      #EXTM3U
      #EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery",KEYFORMATVERSIONS="1"
      #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
      v.m3u8
      """,
    )
    refused(plan("/sk/master.m3u8"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun anEncryptedVariantPlaylistIsProtectedEvenWhenTheMasterLooksClean() {
    playlist("/ev/master.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nv.m3u8")
    playlist("/ev/v.m3u8", vod.replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\""))
    refused(plan("/ev/master.m3u8"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun aVariantThatIsItselfAMultivariantPlaylistIsRefused() {
    playlist("/nest/master.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nagain.m3u8")
    playlist("/nest/again.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nx.m3u8")
    refused(plan("/nest/master.m3u8"), ProbeFailure.UNSUPPORTED_FORMAT)
  }

  // ---------- session context, tokens ----------

  @Test fun theDownloadsRequestContextReachesEveryPlaylistRequest() {
    playlist("/private/master.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nv.m3u8")
    playlist("/private/v.m3u8", vod)
    ready(plan("/private/master.m3u8", ctx = context.copy(useCookies = true)))

    assertEquals(2, requests.size)
    for (request in requests) {
      assertEquals("VidoraX-Test-UA", request.getHeader("User-Agent"))
      assertEquals("https://page.example/watch/1", request.getHeader("Referer"))
      assertEquals("sid=user", request.getHeader("Cookie"))
    }
  }

  @Test fun aChildPlaylistThatNeedsTheParentsTokenGetsIt() {
    playlist("/tok/master.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nv.m3u8")
    routes["/tok/v.m3u8"] = { MockResponse().setResponseCode(403) }
    routes["/tok/v.m3u8?auth=T0K"] = { MockResponse().setBody(vod.trimIndent()) }

    val plan = ready(plan("/tok/master.m3u8?auth=T0K"))
    assertEquals(url("/tok/v.m3u8?auth=T0K"), plan.mediaPlaylistUrl)
    assertEquals(listOf("/tok/master.m3u8", "/tok/v.m3u8", "/tok/v.m3u8"), requests.map { it.requestUrl!!.encodedPath })
  }

  @Test fun theFingerprintFollowsTheStreamNotItsTokens() {
    playlist("/fp/a.m3u8", vod)
    playlist("/fp/b.m3u8", vod.replace("token=abc", "token=ROTATED").replace("sig=xyz", "sig=NEW"))
    playlist("/fp/c.m3u8", vod.replace("#EXTINF:2.5,", "#EXTINF:3.5,"))
    val a = ready(plan("/fp/a.m3u8")).fingerprint
    assertEquals(a, ready(plan("/fp/b.m3u8")).fingerprint)
    assertNotEquals(a, ready(plan("/fp/c.m3u8")).fingerprint)
  }

  @Test fun differentVariantsOfOneStreamHaveDifferentFingerprints() {
    serveVariants()
    val best = ready(plan("/m/master.m3u8")).fingerprint
    val low = ready(plan("/m/master.m3u8", VariantChoice(null, null, 360))).fingerprint
    assertNotEquals(best, low)
  }

  // ---------- the bytes must agree: a video, not subtitles or audio ----------

  private fun confirm(path: String): ProbeFailure? = runBlocking { planner.confirmMedia(ready(plan(path)), context)?.reason }

  private fun serveBytes(path: String, bytes: ByteArray) {
    routes[path] = { MockResponse().setBody(okio.Buffer().write(bytes)) }
  }

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing fixture $path" }.use { it.readBytes() }

  private fun vodPlaylist(vararg segments: String, map: String? = null) = buildString {
    append("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n")
    if (map != null) append("#EXT-X-MAP:URI=\"$map\"\n")
    for (segment in segments) append("#EXTINF:6.0,\n$segment\n")
    append("#EXT-X-ENDLIST\n")
  }

  private fun lastRange(path: String) = requests.last { it.requestUrl!!.encodedPath == path }.getHeader("Range")

  @Test fun aSubtitlePlaylistIsNotAVideo() {
    playlist("/sub/prog_index.m3u8", vodPlaylist("fileSequence0.webvtt", "fileSequence1.webvtt"))
    serveBytes("/sub/fileSequence0.webvtt", "\uFEFFWEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n".toByteArray())

    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, confirm("/sub/prog_index.m3u8"))
    assertEquals("only the head of the first segment is read", "bytes=0-4095", lastRange("/sub/fileSequence0.webvtt"))
    assertEquals(0, requests.count { it.requestUrl!!.encodedPath == "/sub/fileSequence1.webvtt" })
  }

  @Test fun theAudioRenditionOfASplitStreamIsNotAVideo() {
    // One file per rendition, the init section a byte range at its start (the layout Apple's examples use).
    val init = fixture("/media/hls-fmp4/audio-init.mp4")
    val fragment = fixture("/media/hls-fmp4/audio0.m4s")
    playlist(
      "/a1/prog_index.m3u8",
      "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
        "#EXT-X-MAP:URI=\"main.mp4\",BYTERANGE=\"${init.size}@0\"\n" +
        "#EXTINF:6.0,\n#EXT-X-BYTERANGE:${fragment.size}@${init.size}\nmain.mp4\n#EXT-X-ENDLIST\n",
    )
    serveBytes("/a1/main.mp4", init + fragment)

    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, confirm("/a1/prog_index.m3u8"))
    assertEquals("exactly the init section", "bytes=0-${init.size - 1}", lastRange("/a1/main.mp4"))
  }

  @Test fun aVideoRenditionIsConfirmedFromItsInitSectionAlone() {
    playlist("/v/index.m3u8", vodPlaylist("seg0.m4s", "seg1.m4s", map = "init.mp4"))
    serveBytes("/v/init.mp4", fixture("/media/hls-fmp4/video-init.mp4"))

    assertNull(confirm("/v/index.m3u8"))
    assertEquals(listOf("/v/index.m3u8", "/v/init.mp4"), requests.map { it.requestUrl!!.encodedPath })
  }

  @Test fun anMpegTsVideoIsConfirmedFromItsFirstBytes() {
    playlist("/ts/index.m3u8", vodPlaylist("seg0.ts", "seg1.ts"))
    serveBytes("/ts/seg0.ts", fixture("/media/hls-ts/seg0.ts"))

    assertNull(confirm("/ts/index.m3u8"))
  }

  @Test fun packedAudioIsNotAVideo() {
    playlist("/aac/index.m3u8", vodPlaylist("seg0.aac"))
    val adts = byteArrayOf(0xFF.toByte(), 0xF1.toByte(), 0x50, 0x80.toByte(), 0x02, 0x1F, 0xFC.toByte())
    serveBytes("/aac/seg0.aac", adts + ByteArray(64))

    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, confirm("/aac/index.m3u8"))
  }

  @Test fun commonEncryptionInTheInitSectionIsProtected() {
    playlist("/cenc/index.m3u8", vodPlaylist("seg0.m4s", map = "init.mp4"))
    val pssh = byteArrayOf(0, 0, 0, 32) + "pssh".toByteArray() + ByteArray(24)
    serveBytes("/cenc/init.mp4", fixture("/media/hls-fmp4/video-init.mp4") + pssh)

    assertEquals(ProbeFailure.DRM_PROTECTED, confirm("/cenc/index.m3u8"))
  }

  @Test fun aFirstSegmentThatCannotBeReadIsNoVerdict() {
    playlist("/gone/index.m3u8", vodPlaylist("seg0.ts")) // the segment answers 404

    assertNull("the transfer checks the bytes again; classification does not guess", confirm("/gone/index.m3u8"))
  }

  @Test fun aSegmentThatNeedsThePlaylistsTokenIsReadWithIt() {
    playlist("/tk/index.m3u8", vodPlaylist("seg0.webvtt"))
    routes["/tk/seg0.webvtt"] = { MockResponse().setResponseCode(403) }
    routes["/tk/seg0.webvtt?auth=T0K"] = { MockResponse().setBody("WEBVTT\n\n") }

    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, confirm("/tk/index.m3u8?auth=T0K"))
  }

  @Test fun withParentQueryOnlyAddsATokenToAChildThatHasNone() {
    assertEquals("https://c.example/v.m3u8?auth=1", HlsPlanner.withParentQuery("https://c.example/v.m3u8", "https://c.example/m.m3u8?auth=1"))
    assertNull(HlsPlanner.withParentQuery("https://c.example/v.m3u8?own=1", "https://c.example/m.m3u8?auth=1"))
    assertNull(HlsPlanner.withParentQuery("https://c.example/v.m3u8", "https://c.example/m.m3u8"))
  }
}
