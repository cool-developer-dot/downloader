package com.vidorax.media.subtitles

import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.subtitles.Fmp4Builder.Sample
import com.vidorax.media.subtitles.Fmp4Builder.cue
import com.vidorax.media.subtitles.Fmp4Builder.fragment
import com.vidorax.media.subtitles.Fmp4Builder.init
import java.io.File
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** #370 against a real HTTP server: WebVTT inside fMP4 segments (DASH and HLS) saved as one `.vtt` after the video. */
@RunWith(RobolectricTestRunner::class)
class SubtitleFetcherFmp4Test {
  @get:Rule val tmp = TemporaryFolder()

  private val server = MockWebServer()
  private val routes = HashMap<String, MockResponse>()
  private val fetcher = SubtitleFetcher(HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL))
  private val context = RequestContext(null, null, null, emptyMap(), useCookies = false)
  private lateinit var video: File

  @Before fun setUp() {
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse = routes[request.path] ?: MockResponse().setResponseCode(404)
    }
    server.start()
    video = File(tmp.newFolder("files", "library", "web"), "Clip_abcd1234.mp4").apply { writeBytes(ByteArray(10)) }
  }

  @After fun tearDown() { server.shutdown() }

  private fun url(path: String) = server.url(path).toString()

  private fun serve(path: String, body: String) {
    routes[path] = MockResponse().setBody(body)
  }

  private fun serve(path: String, body: ByteArray) {
    routes[path] = MockResponse().setBody(Buffer().write(body))
  }

  private fun mpd(presentationTimeOffset: Long = 0) = """
    <?xml version="1.0" encoding="UTF-8"?>
    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S" minBufferTime="PT2S">
      <Period id="p0">
        <AdaptationSet id="1" contentType="video" mimeType="video/mp4">
          <Representation id="v1" bandwidth="800000" codecs="avc1.4d401e" width="640" height="360"><BaseURL>v.mp4</BaseURL></Representation>
        </AdaptationSet>
        <AdaptationSet id="4" contentType="text" mimeType="application/mp4" codecs="wvtt" lang="en">
          <Representation id="sub-en" bandwidth="1000">
            <SegmentTemplate timescale="1000" duration="2000" startNumber="1" presentationTimeOffset="$presentationTimeOffset"
                             initialization="subs/init.mp4" media="subs/${'$'}Number${'$'}.m4s"/>
          </Representation>
        </AdaptationSet>
        <AdaptationSet id="5" contentType="text" mimeType="application/mp4" codecs="stpp" lang="de">
          <Representation id="sub-de" bandwidth="1000">
            <SegmentTemplate timescale="1000" duration="2000" startNumber="1" initialization="de/init.mp4" media="de/${'$'}Number${'$'}.m4s"/>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>
  """.trimIndent()

  @Test fun aDashWvttTrackIsListedAsWebVttWhileStppStaysRefused() = runBlocking {
    serve("/dash/manifest.mpd", mpd())
    val tracks = fetcher.list(url("/dash/manifest.mpd"), SourceKind.DASH, context)
    assertEquals(listOf("en", "de"), tracks.map { it.language })
    assertEquals(SubtitleFormat.WEBVTT, tracks[0].format)
    assertNull(tracks[0].refused)
    assertEquals(SubtitleRefusal.EMBEDDED, tracks[1].refused)
  }

  @Test fun aDashWvttTrackIsSavedAsOneWebVttFile() = runBlocking {
    serve("/dash/manifest.mpd", mpd(presentationTimeOffset = 10_000))
    serve("/dash/subs/init.mp4", init())
    serve("/dash/subs/1.m4s", fragment(baseTime = 10_000, samples = listOf(Sample(1_000, cue("Hello")), Sample(1_000, cue("Long")))))
    serve("/dash/subs/2.m4s", fragment(baseTime = 12_000, samples = listOf(Sample(1_500, cue("Long")), Sample(500, Fmp4Builder.empty()))))
    val english = fetcher.list(url("/dash/manifest.mpd"), SourceKind.DASH, context).first().id

    val outcome = fetcher.fetch(url("/dash/manifest.mpd"), SourceKind.DASH, context, listOf(english), video)

    assertEquals(0, outcome.failed)
    assertEquals("Clip_abcd1234.en.vtt", outcome.written.single().file.name)
    assertEquals(
      "the presentation offset puts it on the video's timeline; the repeated cue is one",
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n\n00:00:01.000 --> 00:00:03.500\nLong\n",
      outcome.written.single().file.readText(),
    )
  }

  @Test fun aMissingSegmentFailsThatTrackOnlyAndWritesNothingHalf() = runBlocking {
    serve("/dash/manifest.mpd", mpd())
    serve("/dash/subs/init.mp4", init())
    serve("/dash/subs/1.m4s", fragment(baseTime = 0, samples = listOf(Sample(1_000, cue("Hello")))))
    val english = fetcher.list(url("/dash/manifest.mpd"), SourceKind.DASH, context).first().id

    val outcome = fetcher.fetch(url("/dash/manifest.mpd"), SourceKind.DASH, context, listOf(english), video)

    assertEquals(1, outcome.failed)
    assertEquals(SubtitleFetcher.NOTE_FAILED, outcome.note)
    assertEquals(listOf("Clip_abcd1234.mp4"), video.parentFile!!.list()!!.sorted())
  }

  @Test fun anHlsRenditionOfFmp4SegmentsIsSavedWithItsFirstSegmentAtZero() = runBlocking {
    serve(
      "/hls/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",DEFAULT=YES,URI="subs/en.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,wvtt",SUBTITLES="subs"
      v/360.m3u8
      """.trimIndent(),
    )
    serve(
      "/hls/subs/en.m3u8",
      """
      #EXTM3U
      #EXT-X-VERSION:7
      #EXT-X-TARGETDURATION:2
      #EXT-X-MAP:URI="init.mp4"
      #EXTINF:2.0,
      1.m4s
      #EXTINF:2.0,
      2.m4s
      #EXT-X-ENDLIST
      """.trimIndent(),
    )
    serve("/hls/subs/init.mp4", init(timescale = 90_000))
    serve("/hls/subs/1.m4s", fragment(baseTime = 900_000, samples = listOf(Sample(90_000, cue("First")))))
    serve("/hls/subs/2.m4s", fragment(baseTime = 1_080_000, samples = listOf(Sample(45_000, cue("Second")))))
    val english = fetcher.list(url("/hls/master.m3u8"), SourceKind.HLS, context).single()
    assertEquals(SubtitleFormat.WEBVTT, english.format)

    val outcome = fetcher.fetch(url("/hls/master.m3u8"), SourceKind.HLS, context, listOf(english.id), video)

    assertEquals(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFirst\n\n00:00:02.000 --> 00:00:02.500\nSecond\n",
      outcome.written.single().file.readText(),
    )
  }
}
