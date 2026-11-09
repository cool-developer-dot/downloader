package com.vidorax.web.devtools

import android.webkit.CookieManager
import android.webkit.WebView
import com.vidorax.web.profiles.IncognitoProfiles
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class SiteCookiesTest {
  @After
  fun reset() {
    IncognitoProfiles.resetForTests()
  }

  @Test
  fun parsesTheCookieHeader() {
    assertEquals(
      listOf(SiteCookies.Cookie("a", "1"), SiteCookies.Cookie("session", "x=y"), SiteCookies.Cookie("", "flag")),
      SiteCookies.parse("a=1; session=x=y;  ; flag"),
    )
    assertEquals(emptyList<SiteCookies.Cookie>(), SiteCookies.parse(null))
  }

  @Test
  fun expiresOnTheHostEachParentDomainAndEachPathPrefix() {
    val headers = SiteCookies.expiryHeaders("sid", "https://m.news.example.com/a/b?x=1")
    assertTrue(headers.all { it.startsWith("sid=; Expires=Thu, 01 Jan 1970") && it.contains("Max-Age=0") })
    assertTrue(headers.contains("sid=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/"))
    assertTrue(headers.contains("sid=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/a/b; Domain=example.com"))
    assertTrue(headers.contains("sid=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/a; Domain=m.news.example.com"))
    // host-only + 3 domains (m.news.example.com, news.example.com, example.com; never the bare TLD) × 3 paths.
    assertEquals(4 * 3, headers.size)
    assertTrue(headers.none { it.endsWith("Domain=com") })
  }

  @Test
  fun eachTabReadsItsOwnProfilesJar() {
    val app = RuntimeEnvironment.getApplication()
    val incognitoJar = CookieManager.getInstance()
    IncognitoProfiles.start("vidorax-incoga1", acceptCookies = true, supported = { true }, jarOf = { incognitoJar })
    val incognito = WebView(app)
    IncognitoProfiles.apply(incognito, "vidorax-incoga1") { _, _ -> }
    val normal = WebView(app)
    assertEquals(SiteCookies.Source.INCOGNITO, SiteCookies.sourceFor(incognito, profilesSupported = true))
    assertSame(incognitoJar, SiteCookies.jarFor(incognito))
    assertEquals(SiteCookies.Source.PROFILE, SiteCookies.sourceFor(normal, profilesSupported = true))
    assertEquals(SiteCookies.Source.DEFAULT, SiteCookies.sourceFor(normal, profilesSupported = false))
    // The session ends: that tab reads no jar at all (never the default one).
    IncognitoProfiles.end("vidorax-incoga1")
    assertEquals(SiteCookies.Source.NONE, SiteCookies.sourceFor(incognito, profilesSupported = true))
    assertNull(SiteCookies.jarFor(incognito))
  }
}
