package com.vidorax.media.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RedactTest {
  @Test
  fun dropsSignedQueryTokens() {
    val redacted = Redact.url("https://cdn.example.com/v/abc.mp4?Signature=SECRET&Expires=123&token=abc")
    assertEquals("https://cdn.example.com/v/abc.mp4", redacted)
    assertFalse(redacted.contains("SECRET"))
    assertFalse(redacted.contains("token"))
  }

  @Test
  fun dropsUserInfoAndFragment() {
    val redacted = Redact.url("https://user:pass@host.example/path/file#frag")
    assertEquals("https://host.example/path/file", redacted)
    assertFalse(redacted.contains("pass"))
  }

  @Test
  fun keepsNonDefaultPort() {
    assertEquals("http://host.example:8080/a", Redact.url("http://host.example:8080/a?x=1"))
  }

  @Test
  fun hidesUnparseableUrl() {
    assertEquals("<url>", Redact.url("not a url"))
  }
}
