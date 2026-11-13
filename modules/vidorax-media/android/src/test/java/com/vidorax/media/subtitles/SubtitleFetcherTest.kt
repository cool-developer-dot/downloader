package com.vidorax.media.subtitles

import com.vidorax.media.engine.DownloadRow
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
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

/**
 * H19 against a real HTTP server: manifests as sites serve them (HLS SUBTITLES renditions, DASH text adaptation sets),
 * the subtitle files written beside the video, and every failure a note — never an exception, never the video.
 */
@RunWith(RobolectricTestRunner::class)
class SubtitleFetcherTest {
  @get:Rule val tmp = TemporaryFolder()

  private val server = MockWebServer()
  private val routes = HashMap<String, MockResponse>()
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)
  private val fetcher = SubtitleFetcher(http)
  private val context = RequestContext(null, null, null, mapOf("X-Test" to "1"), useCookies = false)
  private lateinit var video: File

  @Before fun setUp() {
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse = routes[request.path] ?: MockResponse().setResponseCode(404)
    }
    server.start()
    val folder = tmp.newFolder("files", "library", "web")
    video = File(folder, "Clip_abcd1234.mp4").apply { writeBytes(ByteArray(10)) }
  }

  @After fun tearDown() { server.shutdown() }

  private fun url(path: String) = server.url(path).toString()

  private fun serve(path: String, body: String) {
    routes[path] = MockResponse().setBody(body)
  }

  private val master = """
    #EXTM3U
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",LANGUAGE="en",NAME="English",DEFAULT=YES,URI="audio/en.m3u8"
    #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="subs/en.m3u8"
    #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="ur",NAME="Urdu",URI="subs/ur.m3u8"
    #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English (forced)",FORCED=YES,URI="subs/en-forced.m3u8"
    #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs-hd",LANGUAGE="en",NAME="English",URI="subs-hd/en.m3u8"
    #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
    v/360.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud",SUBTITLES="subs-hd"
    v/720.m3u8
  """.trimIndent()

  private fun subtitlePlaylist(vararg segments: String) = buildString {
    append("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n")
    segments.forEach { append("#EXTINF:6.0,\n").append(it).append('\n') }
    append("#EXT-X-ENDLIST\n")
  }

  @Test fun hlsSubtitleRenditionsAreListedEachLanguageOnceWithoutUrls() = runBlocking {
    serve("/stream/master.m3u8", master)
    val tracks = fetcher.list(url("/stream/master.m3u8"), SourceKind.HLS, context)
    assertEquals(listOf("en" to "English", "ur" to "Urdu", "en" to "English (forced)"), tracks.map { it.language to it.name })
    val english = tracks.first()
    assertEquals(SubtitleFormat.WEBVTT, english.format)
    assertTrue(english.isDefault)
    assertTrue(tracks[2].isForced)
    assertNull(english.refused)
    assertTrue("the id carries no URL", english.id.startsWith("hls:subs:en:") && !english.id.contains("http"))
    assertEquals("JavaScript never sees a URL", null, english.toSubtitleJs()["url"])
    assertFalse(english.toSubtitleJs().containsKey("url"))
  }

  @Test fun aFileOrAMediaPlaylistHasNoSubtitles() = runBlocking {
    serve("/stream/v/360.m3u8", subtitlePlaylist("seg0.ts"))
    assertTrue(fetcher.list(url("/stream/v/360.m3u8"), SourceKind.HLS, context).isEmpty())
    assertTrue(fetcher.list(url("/clip.mp4"), SourceKind.PROGRESSIVE, context).isEmpty())
    assertTrue("unreachable: nothing, no exception", fetcher.list(url("/missing.m3u8"), SourceKind.HLS, context).isEmpty())
  }

  @Test fun youTubeIsRefusedByPolicyWithoutARequest() = runBlocking {
    val before = server.requestCount
    assertTrue(fetcher.list("https://www.youtube.com/watch/master.m3u8", SourceKind.HLS, context).isEmpty())
    assertTrue(fetcher.list("https://rr1.googlevideo.com/manifest.mpd", SourceKind.DASH, context).isEmpty())
    assertEquals(before, server.requestCount)
  }

  @Test fun segmentedHlsWebVttIsAssembledBesideTheVideo() = runBlocking {
    serve("/stream/master.m3u8", master)
    serve("/stream/subs/ur.m3u8", subtitlePlaylist("ur/0.vtt", "ur/1.vtt"))
    serve("/stream/subs/ur/0.vtt", "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:01.000 --> 00:00:02.000\nسلام\n")
    serve("/stream/subs/ur/1.vtt", "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:07.000 --> 00:00:08.000\nخدا حافظ\n")
    val urdu = fetcher.list(url("/stream/master.m3u8"), SourceKind.HLS, context).single { it.language == "ur" }

    val outcome = fetcher.fetch(url("/stream/master.m3u8"), SourceKind.HLS, context, listOf(urdu.id), video)

    assertEquals(0, outcome.failed)
    val file = outcome.written.single().file
    assertEquals("Clip_abcd1234.ur.vtt", file.name)
    assertEquals(video.parentFile, file.parentFile)
    assertEquals(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nسلام\n\n00:00:07.000 --> 00:00:08.000\nخدا حافظ\n",
      file.readText(),
    )
    assertEquals("the download's own headers go with every request", "1", server.takeRequest().getHeader("X-Test"))
  }

  @Test fun twoTracksInOneLanguageGetTwoFiles() = runBlocking {
    serve("/stream/master.m3u8", master)
    serve("/stream/subs/en.m3u8", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n")
    serve("/stream/subs/en-forced.m3u8", "WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nForced\n")
    val ids = fetcher.list(url("/stream/master.m3u8"), SourceKind.HLS, context).filter { it.language == "en" }.map { it.id }

    val outcome = fetcher.fetch(url("/stream/master.m3u8"), SourceKind.HLS, context, ids, video)

    assertEquals(listOf("Clip_abcd1234.en.vtt", "Clip_abcd1234.en.2.vtt"), outcome.written.map { it.file.name })
  }

  @Test fun aSubtitleThatCannotBeFetchedIsANoteNotAnError() = runBlocking {
    serve("/stream/master.m3u8", master)
    serve("/stream/subs/ur.m3u8", subtitlePlaylist("ur/0.vtt")) // the segment is a 404
    serve("/stream/subs/en.m3u8", "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n#EXTINF:6,\n0.vtt\n#EXT-X-ENDLIST\n")
    val tracks = fetcher.list(url("/stream/master.m3u8"), SourceKind.HLS, context)

    val outcome = fetcher.fetch(url("/stream/master.m3u8"), SourceKind.HLS, context, tracks.map { it.id }.take(2), video)
    assertTrue(outcome.written.isEmpty())
    assertEquals(2, outcome.failed)
    assertEquals(SubtitleFetcher.NOTE_FAILED, outcome.note)
    assertEquals("the video is untouched", 10L, video.length())

    routes.clear()
    val gone = fetcher.fetch(url("/stream/master.m3u8"), SourceKind.HLS, context, listOf(tracks.first().id), video)
    assertEquals(SubtitleFetcher.NOTE_UNREADABLE, gone.note)
  }

  private val mpd = """
    <?xml version="1.0" encoding="UTF-8"?>
    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT30S" minBufferTime="PT2S"
         profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
      <Period id="p0">
        <AdaptationSet id="1" contentType="video" mimeType="video/mp4">
          <Representation id="v1" bandwidth="800000" codecs="avc1.4d401e" width="640" height="360"><BaseURL>v.mp4</BaseURL></Representation>
        </AdaptationSet>
        <AdaptationSet id="3" contentType="text" mimeType="text/vtt" lang="en">
          <Role schemeIdUri="urn:mpeg:dash:role:2011" value="subtitle"/>
          <Representation id="sub-en" bandwidth="1000"><BaseURL>subs/en.vtt</BaseURL></Representation>
        </AdaptationSet>
        <AdaptationSet id="4" contentType="text" mimeType="application/ttml+xml" lang="fr">
          <Representation id="sub-fr" bandwidth="1000"><BaseURL>subs/fr.ttml</BaseURL></Representation>
        </AdaptationSet>
        <AdaptationSet id="5" contentType="text" mimeType="application/mp4" codecs="stpp" lang="de">
          <Representation id="sub-de" bandwidth="1000">
            <SegmentTemplate media="de/${'$'}Number${'$'}.m4s" initialization="de/init.mp4" duration="6" startNumber="1"/>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>
  """.trimIndent()

  @Test fun dashTextSetsAreListedAndEmbeddedOnesRefused() = runBlocking {
    serve("/dash/manifest.mpd", mpd)
    val tracks = fetcher.list(url("/dash/manifest.mpd"), SourceKind.DASH, context)
    assertEquals(listOf("en", "fr", "de"), tracks.map { it.language })
    assertEquals(listOf(SubtitleFormat.WEBVTT, SubtitleFormat.TTML), tracks.take(2).map { it.format })
    assertEquals(listOf(null, null, SubtitleRefusal.EMBEDDED), tracks.map { it.refused })
  }

  @Test fun dashWebVttAndTtmlFilesAreSavedAsWebVtt() = runBlocking {
    serve("/dash/manifest.mpd", mpd)
    serve("/dash/subs/en.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n")
    serve(
      "/dash/subs/fr.ttml",
      """<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:03.000" end="00:00:04.000">Bonjour</p></div></body></tt>""",
    )
    val tracks = fetcher.list(url("/dash/manifest.mpd"), SourceKind.DASH, context)

    val outcome = fetcher.fetch(url("/dash/manifest.mpd"), SourceKind.DASH, context, tracks.map { it.id }, video)

    assertEquals(listOf("Clip_abcd1234.en.vtt", "Clip_abcd1234.fr.vtt"), outcome.written.map { it.file.name })
    assertEquals("WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nBonjour\n", outcome.written[1].file.readText())
    assertEquals("the embedded stpp track is not fetched", 1, outcome.failed)
  }

  @Test fun subtitlesAreFetchedOnceTheVideoCompletedAndGoWithIt() = runBlocking {
    serve("/dash/manifest.mpd", mpd)
    serve("/dash/subs/en.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n")
    val paths = StoragePaths(File(tmp.root, "files"), tmp.newFolder("nobackup"))
    var state = DownloadState.DOWNLOADING
    val store = SubtitleStore.inMemory()
    val downloads = SubtitleDownloads(
      store = store,
      fetcher = fetcher,
      downloadRow = { row(it, state) },
      videoFile = { if (state == DownloadState.COMPLETED) video else null },
      paths = paths,
      scope = CoroutineScope(Dispatchers.Unconfined),
    )
    val english = fetcher.list(url("/dash/manifest.mpd"), SourceKind.DASH, context).first().id

    downloads.choose("dl-1", listOf(english))
    assertEquals("chosen while it downloads: waits", SubtitleRecord.State.PENDING, downloads.record("dl-1")!!.state)

    state = DownloadState.COMPLETED
    downloads.fetchPending("dl-1")
    val record = downloads.record("dl-1")!!
    assertEquals(SubtitleRecord.State.DONE, record.state)
    val file = downloads.file("dl-1", 0)!!
    assertTrue(file.isFile)
    assertFalse("never a URL in the record", record.toString().contains("http"))

    downloads.forget(listOf("dl-1"))
    assertFalse("deleted with its video", file.exists())
    assertNull(downloads.record("dl-1"))
  }

  @Test fun subtitlesOfAVideoDeletedWhileNothingListenedAreDeletedAtStart() = runBlocking {
    serve("/dash/manifest.mpd", mpd)
    serve("/dash/subs/en.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n")
    val paths = StoragePaths(File(tmp.root, "files"), tmp.newFolder("nobackup3"))
    var videoThere = true
    val downloads = SubtitleDownloads(
      store = SubtitleStore.inMemory(),
      fetcher = fetcher,
      downloadRow = { row(it, DownloadState.COMPLETED) },
      videoFile = { if (videoThere) video else null },
      paths = paths,
      scope = CoroutineScope(Dispatchers.Unconfined),
    )
    val english = fetcher.list(url("/dash/manifest.mpd"), SourceKind.DASH, context).first().id
    downloads.choose("dl-3", listOf(english))
    val file = downloads.file("dl-3", 0)!!
    videoThere = false
    downloads.pruneOrphans()
    assertFalse(file.exists())
    assertNull(downloads.record("dl-3"))
  }

  @Test fun aCancelledDownloadForgetsItsChoice() = runBlocking {
    val store = SubtitleStore.inMemory()
    val downloads = SubtitleDownloads(
      store = store,
      fetcher = fetcher,
      downloadRow = { row(it, DownloadState.CANCELLED) },
      videoFile = { null },
      paths = StoragePaths(File(tmp.root, "files"), tmp.newFolder("nobackup2")),
      scope = CoroutineScope(Dispatchers.Unconfined),
    )
    downloads.choose("dl-2", listOf("dash:3:sub-en:en"))
    downloads.fetchPending("dl-2")
    assertNull(downloads.record("dl-2"))
  }

  private fun row(id: String, state: DownloadState) = DownloadRow(
    id = id,
    state = state,
    kind = SourceKind.DASH,
    url = url("/dash/manifest.mpd"),
    request = context,
    title = "Clip",
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = 0,
    totalBytes = null,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    saveToGallery = false,
    createdAt = 0,
    updatedAt = 0,
  )
}
