package com.vidorax.media.plan

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
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The DASH planner through real Media3 parsing and real HTTP (MockWebServer): which manifests the engine can finish
 * without muxing, which representation it would download, and the truthful reason for everything else.
 */
@RunWith(RobolectricTestRunner::class)
class DashPlannerTest {
  private lateinit var server: MockWebServer
  private val routes = ConcurrentHashMap<String, () -> MockResponse>()
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)
  private val planner = DashPlanner(http)

  private val context = RequestContext("VidoraX-Test-UA", "https://page.example/watch/1", null, emptyMap(), useCookies = false)

  @Before fun setUp() {
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        return routes[request.requestUrl!!.encodedPath]?.invoke() ?: MockResponse().setResponseCode(404)
      }
    }
    server.start()
  }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun manifest(path: String, body: String) {
    // trim(), not trimIndent(): the XML declaration must be the first thing in the document.
    routes[path] = { MockResponse().setHeader("Content-Type", "application/dash+xml").setBody(body.trim()) }
  }

  private fun url(path: String) = server.url(path).toString()

  private fun plan(path: String, choice: VariantChoice? = null) = runBlocking { planner.plan(url(path), context, choice) }

  private fun ready(result: DashPlanResult): DashPlan {
    if (result is DashPlanResult.Refused) fail("expected a plan, got ${result.failure}")
    return (result as DashPlanResult.Ready).plan
  }

  private fun refused(result: DashPlanResult, reason: ProbeFailure): String? {
    if (result !is DashPlanResult.Refused) fail("expected $reason, got a plan")
    result as DashPlanResult.Refused
    assertEquals(reason, result.failure.reason)
    return result.failure.message
  }

  private fun mpd(period: String, attrs: String = """type="static" mediaPresentationDuration="PT10S"""") = """
    <?xml version="1.0" encoding="UTF-8"?>
    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" $attrs minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
      $period
    </MPD>
  """

  private fun rep(id: String, width: Int, height: Int, bandwidth: Int, codecs: String, file: String = "$id.mp4") = """
    <Representation id="$id" bandwidth="$bandwidth" width="$width" height="$height" codecs="$codecs">
      <BaseURL>$file</BaseURL>
      <SegmentBase indexRange="700-800"><Initialization range="0-699"/></SegmentBase>
    </Representation>
  """

  private val muxed360 = rep("av-360", 640, 360, 800_000, "avc1.42c01e,mp4a.40.2")
  private val muxed720 = rep("av-720", 1280, 720, 2_500_000, "avc1.64001f,mp4a.40.2")
  private val muxed1080 = rep("av-1080", 1920, 1080, 5_000_000, "avc1.640028,mp4a.40.2")
  private val audioSet = """
    <AdaptationSet mimeType="audio/mp4" contentType="audio" lang="en">
      <Representation id="a-128" bandwidth="128000" codecs="mp4a.40.2" audioSamplingRate="48000">
        <BaseURL>a-128.m4a</BaseURL>
        <SegmentBase indexRange="600-700"><Initialization range="0-599"/></SegmentBase>
      </Representation>
    </AdaptationSet>
  """

  private fun videoSet(vararg reps: String, attrs: String = """mimeType="video/mp4" contentType="video"""") =
    "<AdaptationSet $attrs>${reps.joinToString("")}</AdaptationSet>"

  // ---------- downloadable ----------

  @Test fun aMuxedSingleFileRepresentationIsDownloadable() {
    manifest("/dash/muxed.mpd", mpd("<Period>${videoSet(muxed360)}</Period>"))

    val plan = ready(plan("/dash/muxed.mpd"))

    assertEquals(url("/dash/av-360.mp4"), plan.mediaUrl)
    assertEquals(url("/dash/muxed.mpd"), plan.manifestUrl)
    assertEquals("av-360", plan.selected.id)
    assertEquals(360, plan.selected.height)
    assertEquals(false, plan.selected.needsAudioMux)
    assertEquals(10_000L, plan.durationMs)
    assertEquals("mp4a.40.2", plan.audio?.codec)
    assertEquals(listOf("av-360"), plan.variants.map { it.id })
    assertEquals("only the manifest was fetched: media bytes are the probe's business", 1, requests.size)
  }

  @Test fun multiQualityDashListsEveryDownloadableRepresentationBestFirstAndSelectsExactly() {
    manifest("/dash/multi.mpd", mpd("<Period>${videoSet(muxed360, muxed1080, muxed720)}</Period>"))

    val best = ready(plan("/dash/multi.mpd"))
    assertEquals(listOf("av-1080", "av-720", "av-360"), best.variants.map { it.id })
    assertEquals("av-1080", best.selected.id)
    assertEquals("bandwidth × duration", 5_000_000L / 8 * 10, best.selected.estimatedBytes)

    assertEquals("av-720", ready(plan("/dash/multi.mpd", VariantChoice(null, null, 720))).selected.id)
    assertEquals("av-360", ready(plan("/dash/multi.mpd", VariantChoice(null, null, 480))).selected.id)
    val picked = ready(plan("/dash/multi.mpd", VariantChoice("av-360", null, null)))
    assertEquals("av-360", picked.selected.id)
    assertEquals(url("/dash/av-360.mp4"), picked.mediaUrl)
    assertEquals("below every quality: the smallest", "av-360", ready(plan("/dash/multi.mpd", VariantChoice(null, null, 144))).selected.id)
  }

  @Test fun videoInAManifestWithoutAnyAudioIsDownloadableAsIs() {
    val silent = rep("v-720", 1280, 720, 2_000_000, "avc1.64001f")
    manifest("/dash/silent.mpd", mpd("<Period>${videoSet(silent)}</Period>"))

    val plan = ready(plan("/dash/silent.mpd"))

    assertEquals("v-720", plan.selected.id)
    assertNull("no audio is claimed", plan.audio)
  }

  @Test fun codecsAndBaseUrlsAreInheritedFromTheManifestTree() {
    val body = mpd(
      """
      <BaseURL>https://cdn.example.com/media/</BaseURL>
      <Period>
        <AdaptationSet mimeType="video/mp4" contentType="video" codecs="avc1.4d401f,mp4a.40.2">
          <Representation id="r1" bandwidth="1000000" width="854" height="480"><BaseURL>clip-480.mp4</BaseURL></Representation>
        </AdaptationSet>
      </Period>
      """,
    )
    manifest("/dash/inherit.mpd", body)

    val plan = ready(plan("/dash/inherit.mpd"))

    assertEquals("https://cdn.example.com/media/clip-480.mp4", plan.mediaUrl)
    assertNotNull("codecs on the AdaptationSet say the file is muxed", plan.audio)
  }

  @Test fun aMuxedRepresentationNextToASeparateAudioTrackIsStillDownloadableButVideoOnlyOnesAreNot() {
    val videoOnly = rep("v-1080", 1920, 1080, 6_000_000, "avc1.640028")
    manifest("/dash/mixed.mpd", mpd("<Period>${videoSet(muxed720, videoOnly)}$audioSet</Period>"))

    val plan = ready(plan("/dash/mixed.mpd"))
    assertEquals("the muxed file, never the silent higher quality", "av-720", plan.selected.id)
    assertEquals(listOf("av-720"), plan.variants.map { it.id })

    val message = refused(plan("/dash/mixed.mpd", VariantChoice("v-1080", null, null)), ProbeFailure.UNSUPPORTED_FORMAT)
    assertEquals("a chosen quality is refused, never swapped", DashPlanner.SEPARATE_AUDIO, message)
  }

  // ---------- unsupported ----------

  @Test fun separateVideoAndAudioFilesNeedMuxingAndAreUnsupported() {
    val v360 = rep("v-360", 640, 360, 700_000, "avc1.42c01e")
    val v720 = rep("v-720", 1280, 720, 2_000_000, "avc1.64001f")
    manifest("/dash/split.mpd", mpd("<Period>${videoSet(v360, v720)}$audioSet</Period>"))

    assertEquals(DashPlanner.SEPARATE_AUDIO, refused(plan("/dash/split.mpd"), ProbeFailure.UNSUPPORTED_FORMAT))
  }

  @Test fun segmentedSeparateAudioAndVideoIsUnsupported() {
    val body = mpd(
      """
      <Period>
        <AdaptationSet mimeType="video/mp4" contentType="video" segmentAlignment="true">
          <SegmentTemplate timescale="1000" duration="2000" initialization="${'$'}RepresentationID${'$'}/init.mp4" media="${'$'}RepresentationID${'$'}/${'$'}Number${'$'}.m4s" startNumber="1"/>
          <Representation id="v1" bandwidth="1500000" width="1280" height="720" codecs="avc1.64001f"/>
        </AdaptationSet>
        <AdaptationSet mimeType="audio/mp4" contentType="audio">
          <SegmentTemplate timescale="1000" duration="2000" initialization="${'$'}RepresentationID${'$'}/init.mp4" media="${'$'}RepresentationID${'$'}/${'$'}Number${'$'}.m4s" startNumber="1"/>
          <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2"/>
        </AdaptationSet>
      </Period>
      """,
    )
    manifest("/dash/segmented-split.mpd", body)

    assertEquals(DashPlanner.SEPARATE_AUDIO, refused(plan("/dash/segmented-split.mpd"), ProbeFailure.UNSUPPORTED_FORMAT))
  }

  @Test fun segmentedMuxedDashNeedsFragmentReassemblyAndIsUnsupported() {
    val body = mpd(
      """
      <Period>
        <AdaptationSet mimeType="video/mp4" contentType="video">
          <SegmentTemplate timescale="1000" duration="2000" initialization="init.mp4" media="seg-${'$'}Number${'$'}.m4s" startNumber="1"/>
          <Representation id="av" bandwidth="1500000" width="1280" height="720" codecs="avc1.64001f,mp4a.40.2"/>
        </AdaptationSet>
      </Period>
      """,
    )
    manifest("/dash/segmented.mpd", body)

    assertEquals(DashPlanner.SEGMENTED, refused(plan("/dash/segmented.mpd"), ProbeFailure.UNSUPPORTED_FORMAT))
  }

  @Test fun anAudioOnlyManifestIsNotAVideo() {
    manifest("/dash/audio.mpd", mpd("<Period>$audioSet</Period>"))
    assertEquals("audio-only DASH stream", refused(plan("/dash/audio.mpd"), ProbeFailure.UNSUPPORTED_FORMAT))
  }

  @Test fun severalPeriodsWouldNeedJoiningAndAreUnsupported() {
    manifest(
      "/dash/periods.mpd",
      mpd("""<Period id="ad" duration="PT5S">${videoSet(muxed360)}</Period><Period id="main" duration="PT5S">${videoSet(muxed720)}</Period>"""),
    )
    assertEquals(DashPlanner.MULTI_PERIOD, refused(plan("/dash/periods.mpd"), ProbeFailure.UNSUPPORTED_FORMAT))
  }

  @Test fun aLiveManifestIsLive() {
    manifest(
      "/dash/live.mpd",
      mpd(
        "<Period start=\"PT0S\">${videoSet(muxed360)}</Period>",
        attrs = """type="dynamic" availabilityStartTime="2026-01-01T00:00:00Z" minimumUpdatePeriod="PT2S"""",
      ),
    )
    refused(plan("/dash/live.mpd"), ProbeFailure.LIVE_UNSUPPORTED)
  }

  @Test fun aMalformedManifestIsUnsupportedNotTransient() {
    manifest("/dash/broken.mpd", """<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet""")
    refused(plan("/dash/broken.mpd"), ProbeFailure.UNSUPPORTED_FORMAT)
  }

  @Test fun anHtmlPageIsNotMedia() {
    routes["/dash/page.mpd"] = { MockResponse().setHeader("Content-Type", "text/html").setBody("<!doctype html><html><body>Sign in</body></html>") }
    refused(plan("/dash/page.mpd"), ProbeFailure.NOT_MEDIA)
  }

  // ---------- protected ----------

  @Test fun widevineContentProtectionIsProtected() {
    val body = mpd(
      """
      <Period>
        <AdaptationSet mimeType="video/mp4" contentType="video" xmlns:cenc="urn:mpeg:cenc:2013">
          <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="10000000-1000-1000-1000-100000000001"/>
          <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>AAAANHBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAABQIARIQEAAAABAAEAAQABAAAAAAAQ==</cenc:pssh></ContentProtection>
          ${muxed360}
        </AdaptationSet>
      </Period>
      """,
    )
    manifest("/dash/widevine.mpd", body)

    refused(plan("/dash/widevine.mpd"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun aBareCommonEncryptionMarkerIsProtectedEvenWithoutSchemeData() {
    // Media3 attaches no DRM data for this element on its own; the text still says the content is encrypted.
    val body = mpd(
      """
      <Period>
        <AdaptationSet mimeType="video/mp4" contentType="video">
          <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>
          ${muxed360}
        </AdaptationSet>
      </Period>
      """,
    )
    manifest("/dash/cenc.mpd", body)

    refused(plan("/dash/cenc.mpd"), ProbeFailure.DRM_PROTECTED)
  }

  @Test fun theProtectionTextScanIsNamespaceAware() {
    assertTrue(DashProtection.declares("""<dash:ContentProtection schemeIdUri="urn:uuid:x"/>"""))
    assertTrue(DashProtection.declares("""<ContentProtection schemeIdUri="urn:uuid:x">"""))
    assertEquals(false, DashProtection.declares("""<ContentComponent id="1"/><!-- no protection -->"""))
  }

  // ---------- transient / access ----------

  @Test fun aServerErrorIsTransientWithItsStatus() {
    routes["/dash/busy.mpd"] = { MockResponse().setResponseCode(503) }
    val result = plan("/dash/busy.mpd")
    refused(result, ProbeFailure.HTTP_ERROR)
    assertEquals(503, (result as DashPlanResult.Refused).failure.httpStatus)
  }

  @Test fun aDroppedConnectionIsTransient() {
    // DISCONNECT_AT_START is only honoured through Dispatcher.peek(); this one applies to a dispatched response.
    routes["/dash/drop.mpd"] = { MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST) }
    refused(plan("/dash/drop.mpd"), ProbeFailure.NETWORK)
  }

  @Test fun deniedAndMissingManifestsAreReportedAsSuch() {
    routes["/dash/denied.mpd"] = { MockResponse().setResponseCode(403) }
    routes["/dash/gone.mpd"] = { MockResponse().setResponseCode(410) }
    refused(plan("/dash/denied.mpd"), ProbeFailure.HTTP_403)
    refused(plan("/dash/gone.mpd"), ProbeFailure.HTTP_404)
  }

  @Test fun youTubeIsRefusedByPolicyWithoutARequest() {
    val result = runBlocking { planner.plan("https://www.youtube.com/api/manifest/dash/id/1", context, null) }
    refused(result, ProbeFailure.POLICY_BLOCKED)
    assertEquals(0, requests.size)
  }
}
