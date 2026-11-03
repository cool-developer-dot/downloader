package com.vidorax.web.privacy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SiteDataRulesTest {
  @Test
  fun onlyWebOriginsAreCleared() {
    assertTrue(SiteDataRules.isWebOrigin("https://example.com"))
    assertTrue(SiteDataRules.isWebOrigin("http://sub.example.com:8080"))
    // WebStorage reports origins as URLs with a final slash.
    assertTrue(SiteDataRules.isWebOrigin("https://squoosh.app/"))
    assertEquals("https://squoosh.app", SiteDataRules.normalizeOrigin("https://squoosh.app/"))
    assertEquals("http://a.example.com:8080", SiteDataRules.normalizeOrigin("http://a.example.com:8080"))
    listOf("file:///sdcard", "https://example.com/path", "javascript:alert(1)", "https://", "content://x").forEach {
      assertFalse(it, SiteDataRules.isWebOrigin(it))
    }
    assertEquals("sub.example.com", SiteDataRules.hostOf("https://Sub.Example.com:443"))
  }

  @Test
  fun readsCookieNames() {
    assertEquals(listOf("a", "b_2", "__Host-x"), SiteDataRules.cookieNames("a=1; b_2=two; __Host-x=y; a=again"))
    assertEquals(emptyList<String>(), SiteDataRules.cookieNames(null))
    assertEquals(listOf("ok"), SiteDataRules.cookieNames("bad name=1; ok=2; =3"))
  }

  @Test
  fun domainsGoUpToTwoLabels() {
    assertEquals(listOf("a.b.example.com", "b.example.com", "example.com"), SiteDataRules.domainsFor("a.b.example.com"))
    assertEquals(listOf("example.com"), SiteDataRules.domainsFor("example.com"))
    assertEquals(listOf("localhost"), SiteDataRules.domainsFor("localhost"))
  }

  @Test
  fun expiryHeadersCoverHostAndDomains() {
    val headers = SiteDataRules.expiryHeaders("sid", "www.example.com")
    assertEquals(3, headers.size)
    assertTrue(headers.all { it.startsWith("sid=; ") && it.contains("Max-Age=0") && it.contains("Path=/") })
    assertTrue(headers.any { it.endsWith("Domain=example.com") })
    assertFalse(headers[0].contains("Domain="))
  }
}
