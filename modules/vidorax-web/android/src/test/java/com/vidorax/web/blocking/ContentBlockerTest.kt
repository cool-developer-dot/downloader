package com.vidorax.web.blocking

import com.vidorax.web.blocking.ContentBlocker.Rules
import com.vidorax.web.blocking.ContentBlocker.Verdict
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentBlockerTest {
  private val ads = BlockList.parse(
    sequenceOf(
      "# test list",
      "adserver.example",
      "ads.cdn-host.example",
      "googlesyndication.com/pagead/",
      "videoads.example",
      "",
    ),
  )
  private val trackers = BlockList.parse(sequenceOf("tracker.example", "stats.shop.example"))
  private val both = Rules(ads = true, trackers = true, allowedSites = emptySet())

  private fun decide(
    url: String,
    page: String? = "news.example.org",
    rules: Rules = both,
    mainFrame: Boolean = false,
    accept: String? = "*/*",
    range: Boolean = false,
    method: String = "GET",
  ) = ContentBlocker.decide(url, method, mainFrame, accept, range, page, rules, ads, trackers)

  @Test
  fun anAdHostIsBlocked() {
    assertEquals(Verdict.AD, decide("https://adserver.example/banner.js"))
    assertEquals("subdomains too", Verdict.AD, decide("https://eu.adserver.example/x?y=1"))
    assertEquals(Verdict.AD, decide("https://ads.cdn-host.example/a.gif"))
    assertEquals("other subdomains of that CDN load", Verdict.ALLOW, decide("https://img.cdn-host.example/a.gif"))
    assertEquals("a path rule", Verdict.AD, decide("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"))
    assertEquals("same host, other path", Verdict.ALLOW, decide("https://pagead2.googlesyndication.com/other.js"))
    assertEquals(Verdict.TRACKER, decide("https://tracker.example/collect?v=1"))
  }

  @Test
  fun theMainFrameIsNeverBlocked() {
    assertEquals(Verdict.ALLOW, decide("https://adserver.example/", mainFrame = true))
    assertEquals(Verdict.ALLOW, decide("https://tracker.example/landing", page = null, mainFrame = true))
  }

  @Test
  fun videoAndManifestRequestsAreNeverBlocked() {
    // Even on a listed host: anything video detection or downloads use loads.
    assertEquals(Verdict.ALLOW, decide("https://videoads.example/clip.mp4"))
    assertEquals(Verdict.ALLOW, decide("https://videoads.example/live/index.m3u8"))
    assertEquals(Verdict.ALLOW, decide("https://videoads.example/dash/manifest.mpd"))
    assertEquals(Verdict.ALLOW, decide("https://videoads.example/seg/chunk-12.ts"))
    assertEquals(Verdict.ALLOW, decide("https://videoads.example/stream", range = true))
    assertEquals(Verdict.ALLOW, decide("https://videoads.example/play?id=4", accept = "video/webm,video/*;q=0.9"))
    assertEquals(Verdict.ALLOW, decide("https://adserver.example/v.mp4?bytestart=0&byteend=100"))
    // An ordinary request to the same host is still blocked.
    assertEquals(Verdict.AD, decide("https://videoads.example/vast.xml"))
  }

  @Test
  fun anExceptionSiteIsAllowed() {
    val allowNews = both.copy(allowedSites = setOf("example.org"))
    assertEquals(Verdict.ALLOW, decide("https://adserver.example/banner.js", page = "news.example.org", rules = allowNews))
    assertEquals(Verdict.ALLOW, decide("https://tracker.example/c", page = "www.example.org", rules = allowNews))
    assertEquals("other sites still blocked", Verdict.AD, decide("https://adserver.example/b.js", page = "other.example.com", rules = allowNews))
    assertEquals("not a suffix trick", Verdict.AD, decide("https://adserver.example/b.js", page = "notexample.org", rules = allowNews))
  }

  @Test
  fun eachSwitchWorksAlone() {
    val adsOnly = Rules(ads = true, trackers = false, allowedSites = emptySet())
    val trackersOnly = Rules(ads = false, trackers = true, allowedSites = emptySet())
    assertEquals(Verdict.AD, decide("https://adserver.example/a.js", rules = adsOnly))
    assertEquals(Verdict.ALLOW, decide("https://tracker.example/c", rules = adsOnly))
    assertEquals(Verdict.TRACKER, decide("https://tracker.example/c", rules = trackersOnly))
    assertEquals(Verdict.ALLOW, decide("https://adserver.example/a.js", rules = trackersOnly))
    assertEquals(Verdict.ALLOW, decide("https://adserver.example/a.js", rules = Rules.OFF))
  }

  @Test
  fun aSiteIsNeverCutOffFromItsOwnServers() {
    assertEquals(Verdict.ALLOW, decide("https://stats.shop.example/app.js", page = "www.shop.example"))
    assertEquals(Verdict.TRACKER, decide("https://stats.shop.example/app.js", page = "news.example.org"))
    assertTrue(ContentBlocker.sameSite("static.bbc.co.uk", "www.bbc.co.uk"))
    assertFalse(ContentBlocker.sameSite("bbc.co.uk", "itv.co.uk"))
    assertTrue(ContentBlocker.sameSite("a.dawn.com.pk", "dawn.com.pk"))
    assertFalse(ContentBlocker.sameSite("dawn.com.pk", "geo.com.pk"))
  }

  @Test
  fun nonWebAddressesAndBadInputLoad() {
    assertEquals(Verdict.ALLOW, decide("data:text/html,hi"))
    assertEquals(Verdict.ALLOW, decide("blob:https://adserver.example/1"))
    assertEquals(Verdict.ALLOW, decide("https:///nohost"))
    assertEquals(Verdict.ALLOW, decide(""))
  }

  @Test
  fun hostsAreMatchedByLabelNotBySubstring() {
    assertEquals(Verdict.ALLOW, decide("https://notadserver.example/a.js"))
    assertEquals(Verdict.ALLOW, decide("https://adserver.example.evil.test/a.js"))
    assertEquals(Verdict.AD, decide("https://ADSERVER.example:8443/a.js"))
  }

  @Test
  fun theBundledListsParseAndHoldTheUsualHosts() {
    // Gradle runs unit tests in the module directory; these are the files ContentBlocking opens.
    val adFile = File("src/main/assets/${ContentBlocking.ADS_ASSET}")
    val trackerFile = File("src/main/assets/${ContentBlocking.TRACKERS_ASSET}")
    val adList = adFile.bufferedReader().useLines { BlockList.parse(it) }
    val trackerList = trackerFile.bufferedReader().useLines { BlockList.parse(it) }
    assertTrue("ad list size ${adList.size}", adList.size > 20_000)
    assertTrue("tracker list size ${trackerList.size}", trackerList.size > 20_000)
    assertTrue(adList.matches("pagead2.googlesyndication.com", "/pagead/js/adsbygoogle.js"))
    assertTrue(adList.matches("ib.adnxs.com", "/ut/v3"))
    assertTrue(trackerList.matches("www.google-analytics.com", "/g/collect"))
    assertTrue(trackerList.matches("sb.scorecardresearch.com", "/b"))
    // Never the hosts that serve ordinary pages, scripts and video.
    for (host in listOf("www.google.com", "fonts.gstatic.com", "ajax.googleapis.com", "cdn.jsdelivr.net", "upload.wikimedia.org", "www.bbc.co.uk")) {
      assertFalse(host, adList.matches(host, "/") || trackerList.matches(host, "/"))
    }
    // Code video players load and wait for (the generator's PLAYER_CODE_HOSTS) is never on a list.
    assertFalse(adList.matches("imasdk.googleapis.com", "/js/sdkloader/ima3.js"))
    assertFalse(adList.matches("ssl.p.jwpcdn.com", "/player/plugins/vast/v/8/jwpsrv.js"))
    assertTrue(File("src/main/assets/vidorax-blocklists/LICENSE-blocklists.txt").isFile)
  }
}
