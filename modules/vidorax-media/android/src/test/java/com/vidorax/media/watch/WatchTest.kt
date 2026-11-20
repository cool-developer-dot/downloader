package com.vidorax.media.watch

import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class WatchTest {
  private lateinit var server: MockWebServer
  private val checker = LinkChecker(HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL))
  private val queued = mutableListOf<EnqueueRequest>()
  private val notices = mutableListOf<String>()
  private var clock = 1_000_000L

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun runner(store: WatchStore, rules: BulkRules = BulkRules()) = WatchRunner(
    store = store,
    checker = checker,
    enqueue = { queued += it },
    rules = { rules },
    notify = { _, what -> notices += what },
    now = { clock },
  )

  private fun feed(vararg items: Pair<String, String>) = """
    <?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Clips</title>
    ${items.joinToString("") { (id, enclosure) -> "<item><title>Clip $id</title><guid>$id</guid>$enclosure</item>" }}
    </channel></rss>
  """.trimIndent()

  @Test fun rssMediaRssAndAtomVideoItemsAreReadAndAudioItemsSkipped() {
    val rss = feed(
      "a" to "<enclosure url=\"/v/a.mp4\" type=\"video/mp4\" length=\"10\"/>",
      "b" to "<enclosure url=\"https://cdn.test/b.mp3\" type=\"audio/mpeg\"/>",
      "c" to "<media:content url=\"https://cdn.test/c.m3u8?x=1&amp;y=2\" medium=\"video\"/>",
    )
    assertTrue(FeedParser.isFeed(rss))
    val items = FeedParser.parse(rss, "https://site.test/feed.xml")
    assertEquals(listOf("a", "c"), items.map { it.id })
    assertEquals("https://site.test/v/a.mp4", items[0].mediaUrl)
    assertEquals("https://cdn.test/c.m3u8?x=1&y=2", items[1].mediaUrl)
    assertEquals("Clip a", items[0].title)
    val doubleEncoded = FeedParser.parse(
      feed("d" to "<enclosure url=\"/d.mp4\" type=\"video/mp4\"/>").replace("<title>Clip d</title>", "<title>Apple&amp;#039;s &amp;amp; Co&#x2019;s</title>"),
      "https://site.test/feed.xml",
    )
    assertEquals("Apple's & Co\u2019s", doubleEncoded.single().title)

    val atom = """
      <feed xmlns='http://www.w3.org/2005/Atom'><title>T</title>
      <entry><id>tag:1</id><title><![CDATA[First & best]]></title><link rel="enclosure" type="video/webm" href="https://cdn.test/1.webm"/>
      <updated>2026-11-01T10:00:00Z</updated></entry>
      <entry><id>tag:2</id><title>Text only</title><link href="https://site.test/post/2"/></entry>
      </feed>
    """.trimIndent()
    assertTrue(FeedParser.isFeed(atom))
    val entries = FeedParser.parse(atom, "https://site.test/atom")
    assertEquals(1, entries.size)
    assertEquals("First & best", entries[0].title)
    assertTrue("the date is read", (entries[0].publishedAt ?: 0) > 0)
    assertFalse(FeedParser.isFeed("<html><body>not a feed</body></html>"))
  }

  @Test fun pageVideosIgnoreSignedQueriesAndResolveRelativeLinks() {
    val html = """<video src="/media/clip.mp4?token=123"></video><meta property="og:video" content="https://cdn.test/og.mp4">
      <a href="other.html">x</a><source data-src='https://cdn.test/s.webm?sig=9'>"""
    assertEquals(
      listOf("https://cdn.test/og.mp4", "https://cdn.test/s.webm", "https://site.test/media/clip.mp4"),
      PageVideos.find(html, "https://site.test/watch/1"),
    )
  }

  @Test fun theStoreKeepsOneEntryPerUrlAndRoundTripsJson() {
    val store = WatchStore(WatchStore.Storage.memory())
    val link = WatchRunner.newLink("https://site.test/a.mp4", WatchKind.FILE, "A", 6, true, clock)
    assertEquals(link, store.add(link))
    val again = WatchRunner.newLink("https://site.test/a.mp4", WatchKind.FILE, "A2", 1, false, clock)
    assertEquals("the same URL is not watched twice", link.id, store.add(again)?.id)
    assertEquals(1, store.list().size)
    assertEquals(24, store.update(link.id) { it.copy(intervalHours = 24) }?.intervalHours)
    assertEquals(24, store.find(link.id)?.intervalHours)
    assertTrue(store.remove(link.id))
    assertFalse(store.remove(link.id))
    assertTrue(store.list().isEmpty())
  }

  @Test fun aFileIsRedownloadedOnlyWhenItChanges() = runBlocking {
    val store = WatchStore(WatchStore.Storage.memory())
    val url = server.url("/clip.mp4").toString()
    val link = store.add(WatchRunner.newLink(url, WatchKind.FILE, "Clip", 1, true, clock))!!
    fun file(etag: String) = MockResponse().setResponseCode(206).setHeader("ETag", etag)
      .setHeader("Content-Range", "bytes 0-0/5000").setBody("x")

    server.enqueue(file("\"v1\""))
    val first = runner(store).checkNow(link.id)!!
    assertFalse("the first check only records", first.changed)
    assertEquals("bytes=0-0", server.takeRequest().getHeader("Range"))

    server.enqueue(file("\"v1\""))
    clock += 2 * WatchedLink.HOUR_MS
    assertFalse(runner(store).checkNow(link.id)!!.changed)

    server.enqueue(file("\"v2\""))
    clock += 2 * WatchedLink.HOUR_MS
    val changed = runner(store).checkNow(link.id)!!
    assertTrue(changed.changed)
    assertEquals(1, changed.queued)
    assertEquals(url, queued.single().url)
    assertEquals(listOf("downloading"), notices)
    assertEquals(clock, store.find(link.id)?.lastChangedAt)
  }

  @Test fun aFailedCheckIsNeverAChange() = runBlocking {
    val store = WatchStore(WatchStore.Storage.memory())
    val link = store.add(WatchRunner.newLink(server.url("/f.mp4").toString(), WatchKind.FILE, null, 1, true, clock)
      .let { it.copy(fingerprint = "\"v1\"|10") })!!
    server.enqueue(MockResponse().setResponseCode(503))
    val outcome = runner(store).checkNow(link.id)!!
    assertFalse(outcome.changed)
    assertEquals("error", store.find(link.id)?.lastStatus)
    assertEquals("the last good fingerprint is kept", "\"v1\"|10", store.find(link.id)?.fingerprint)
    assertTrue(queued.isEmpty())
    assertTrue(notices.isEmpty())
  }

  @Test fun aFeedQueuesOnlyItsNewVideosThatPassTheRules() = runBlocking {
    val store = WatchStore(WatchStore.Storage.memory())
    val url = server.url("/feed.xml").toString()
    val link = store.add(WatchRunner.newLink(url, WatchKind.FEED, null, 1, true, clock))!!
    val rss = "application/rss+xml"
    server.enqueue(MockResponse().setHeader("Content-Type", rss).setBody(feed("1" to "<enclosure url=\"/1.mp4\" type=\"video/mp4\"/>")))
    assertFalse(runner(store).checkNow(link.id)!!.changed)
    assertEquals("Clips", store.find(link.id)?.title)

    server.enqueue(
      MockResponse().setHeader("Content-Type", rss).setBody(
        feed(
          "3" to "<enclosure url=\"/3.webm\" type=\"video/webm\"/>",
          "2" to "<enclosure url=\"/2.mp4\" type=\"video/mp4\"/>",
          "1" to "<enclosure url=\"/1.mp4\" type=\"video/mp4\"/>",
        ),
      ),
    )
    clock += 2 * WatchedLink.HOUR_MS
    val outcome = runner(store, BulkRules(excludeExtensions = listOf("webm"))).checkNow(link.id)!!
    assertTrue(outcome.changed)
    assertEquals(listOf("3", "2"), outcome.newItems.map { it.id })
    assertEquals("the excluded .webm is not downloaded", listOf(server.url("/2.mp4").toString()), queued.map { it.url })
    assertEquals(listOf("items:2:1"), notices)
    assertEquals(3, store.find(link.id)?.items?.size)
  }

  @Test fun aPageChangeIsAnnouncedButNotDownloaded() = runBlocking {
    val store = WatchStore(WatchStore.Storage.memory())
    val link = store.add(WatchRunner.newLink(server.url("/watch").toString(), WatchKind.PAGE, null, 1, true, clock))!!
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<title>Show</title><video src=\"/a.mp4?t=1\">"))
    runner(store).checkNow(link.id)
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<title>Show</title><video src=\"/a.mp4?t=2\">"))
    assertFalse("a new signature on the same file is no change", runner(store).checkNow(link.id)!!.changed)
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<title>Show</title><video src=\"/b.mp4\">"))
    val changed = runner(store).checkNow(link.id)!!
    assertTrue(changed.changed)
    assertEquals(0, changed.queued)
    assertTrue(queued.isEmpty())
    assertEquals(listOf("changed"), notices)
  }

  @Test fun onlyDueLinksAreChecked() = runBlocking {
    val store = WatchStore(WatchStore.Storage.memory())
    store.add(WatchRunner.newLink(server.url("/a").toString(), WatchKind.FILE, null, 6, false, clock).copy(lastCheckedAt = clock))
    assertTrue(runner(store).runDue().isEmpty())
    assertEquals(0, server.requestCount)
    clock += 6 * WatchedLink.HOUR_MS + 1
    server.enqueue(MockResponse().setResponseCode(200).setBody("x"))
    assertEquals(1, runner(store).runDue().size)
  }

  @Test fun aNewLinkIsRecognisedAsAFeedAFileOrAPage() {
    server.enqueue(MockResponse().setHeader("Content-Type", "application/xml").setBody(feed("1" to "<enclosure url=\"/1.mp4\" type=\"video/mp4\"/>")))
    assertEquals(WatchKind.FEED, checker.check(server.url("/f").toString(), null).kind)
    server.enqueue(MockResponse().setHeader("Content-Type", "video/mp4").setHeader("ETag", "\"e\"").setBody("bytes"))
    val file = checker.check(server.url("/v").toString(), null)
    assertEquals(WatchKind.FILE, file.kind)
    assertNotEquals(null, file.fingerprint)
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<title>P</title>"))
    assertEquals(WatchKind.PAGE, checker.check(server.url("/p").toString(), null).kind)
    server.enqueue(MockResponse().setResponseCode(404))
    assertEquals("not_found", checker.check(server.url("/gone").toString(), null).status)
  }

  @Test fun bulkRulesMirrorTheAppsLinkRules() {
    val rules = BulkRules.fromJson(
      """{"includeExtensions":["MP4","mkv"],"excludeExtensions":[],"includeKeywords":[],"excludeKeywords":["trailer"],
        "includePattern":"","excludePattern":"\\bpreview\\b","minSizeMb":0,"maxSizeMb":0}""",
    )
    assertTrue(rules.allows("https://a.test/ep1.mp4"))
    assertFalse(rules.allows("https://a.test/ep1.webm"))
    assertFalse(rules.allows("https://a.test/Trailer-ep1.mp4"))
    assertFalse(rules.allows("https://a.test/x/preview/ep.mkv"))
    assertTrue("bad JSON lets everything through", BulkRules.fromJson("{oops").allows("https://a.test/x.webm"))
    assertNull(WatchKind.fromWire("other"))
  }
}
