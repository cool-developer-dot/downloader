package com.vidorax.media.net

import com.vidorax.media.model.AuthChallenge
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #299: what the probe reports from a 401's `WWW-Authenticate` header. */
class BasicChallengeTest {
  private val url = "https://nas.example.com/videos/clip.mp4".toHttpUrl()

  private fun parse(vararg headers: String) = BasicChallenge.parse(headers.toList(), url)

  @Test fun aBasicChallengeGivesItsOriginAndRealm() {
    assertEquals(AuthChallenge("https://nas.example.com:443", "Home NAS"), parse("Basic realm=\"Home NAS\""))
    assertEquals(AuthChallenge("https://nas.example.com:443", "Home NAS"), parse("basic realm=\"Home NAS\", charset=\"UTF-8\""))
    assertEquals(AuthChallenge("https://nas.example.com:443", "media"), parse("Basic realm=media"))
    assertEquals(AuthChallenge("https://nas.example.com:443", null), parse("Basic"))
  }

  @Test fun escapedQuotesAndHiddenCharactersInTheRealm() {
    assertEquals("say \"hi\"", parse("Basic realm=\"say \\\"hi\\\"\"")?.realm)
    assertEquals("ab", parse("Basic realm=\"a\u0007b\"")?.realm)
    assertEquals(128, parse("Basic realm=\"${"x".repeat(500)}\"")?.realm?.length)
  }

  @Test fun theBasicChallengeIsFoundAmongOthers() {
    assertEquals("b", parse("Digest realm=\"a\", nonce=\"n\", Basic realm=\"b\"")?.realm)
    assertEquals("b", parse("Bearer realm=\"a\"", "Basic realm=\"b\"")?.realm)
    // A later challenge's realm is never taken for Basic's.
    assertNull(parse("Basic charset=\"UTF-8\", Bearer realm=\"other\"")?.realm)
  }

  @Test fun otherSchemesAreNoChallenge() {
    assertNull(parse())
    assertNull(parse("Bearer realm=\"api\""))
    assertNull(parse("Digest realm=\"x\", nonce=\"y\""))
    assertNull(parse("Negotiate"))
    assertNull(parse("NotBasic realm=\"x\""))
  }

  @Test fun theOriginNamesThePortWhenItIsNotTheDefault() {
    assertEquals(
      "http://192.0.2.10:8080",
      BasicChallenge.parse(listOf("Basic realm=\"x\""), "http://192.0.2.10:8080/a".toHttpUrl())?.origin,
    )
  }
}
