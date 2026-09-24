package com.vidorax.media.net

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The native mirror of the page detector's SSRF rule: public hosts in, the user's own network out. */
class UrlSafetyTest {
  private fun allowed(url: String) = UrlPolicy.PUBLIC_ONLY.allows(url.toHttpUrl())

  @Test fun publicHostsAndAddressesAreAllowed() {
    assertTrue(allowed("https://cdn.example.com/v.mp4?sig=abc"))
    assertTrue(allowed("http://video.cafe.be/v.m3u8"))
    assertTrue(allowed("https://8.8.8.8/v.mp4"))
    assertTrue(allowed("https://[2001:4860:4860::8888]/v.mp4"))
    assertTrue("a nip.io name is a host name, like the page guard treats it", allowed("http://fixture.127.0.0.1.nip.io/v.mp4"))
  }

  @Test fun loopbackPrivateLinkLocalAndCgnatAreRefused() {
    listOf(
      "http://127.0.0.1/", "http://127.5.4.3:8080/", "http://10.0.0.1/", "http://172.16.0.1/", "http://172.31.255.1/",
      "http://192.168.1.1/admin", "http://169.254.169.254/latest/meta-data", "http://100.64.0.1/", "http://0.0.0.0/",
      "http://[::1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:10.0.0.1]/",
    ).forEach { assertFalse(it, allowed(it)) }
  }

  @Test fun localNamesAndCloudMetadataAreRefused() {
    listOf(
      "http://localhost:8081/", "http://printer.local/", "http://app.localhost/", "http://metadata.google.internal/",
      "http://service.internal/", "http://metadata/",
    ).forEach { assertFalse(it, allowed(it)) }
  }

  @Test fun numericSpellingsOfAddressesAreRefused() {
    // A resolver turns each of these into 127.0.0.1 (or another literal address); they only exist to dodge a check.
    listOf("http://2130706433/", "http://0x7f000001/", "http://0x7f.1/", "http://017700000001/", "http://127.1/").forEach {
      assertFalse(it, allowed(it))
    }
  }

  @Test fun malformedHostsAreRefusedWithoutAnyLookup() {
    assertTrue(UrlSafety.isPrivateOrLocalHost(""))
    assertTrue(UrlSafety.isPrivateOrLocalHost("300.1.1.1"))
    assertTrue("octal-looking dotted quads are refused, not guessed", UrlSafety.isPrivateOrLocalHost("010.0.0.1"))
    assertTrue(UrlSafety.isPrivateOrLocalHost("zz:yy"))
    assertFalse(UrlSafety.isPrivateOrLocalHost("CDN.Example.COM."))
  }
}
