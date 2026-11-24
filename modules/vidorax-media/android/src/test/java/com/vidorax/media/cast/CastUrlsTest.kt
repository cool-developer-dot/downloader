package com.vidorax.media.cast

import java.security.SecureRandom
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CastUrlsTest {
  @Test fun aTokenHas128RandomBitsAsLowercaseHex() {
    val token = CastUrls.newToken()
    assertTrue(CastUrls.TOKEN_BYTES * 8 >= 128)
    assertEquals(32, token.length)
    assertTrue(token.all { it in '0'..'9' || it in 'a'..'f' })
    assertTrue(CastUrls.isToken(token))
  }

  @Test fun everyTokenIsNew() {
    val tokens = (1..500).map { CastUrls.newToken() }.toSet()
    assertEquals(500, tokens.size)
  }

  @Test fun theRandomSourceDecidesTheToken() {
    val fixed = object : SecureRandom() {
      override fun nextBytes(bytes: ByteArray) {
        for (i in bytes.indices) bytes[i] = (i * 17).toByte()
      }
    }
    assertEquals("00112233445566778899aabbccddeeff", CastUrls.newToken(fixed))
  }

  @Test fun onlyFullLowercaseHexTokensAreTokens() {
    assertFalse(CastUrls.isToken(""))
    assertFalse(CastUrls.isToken("abc"))
    assertFalse(CastUrls.isToken("00112233445566778899AABBCCDDEEFF"))
    assertFalse(CastUrls.isToken("00112233445566778899aabbccddeef"))
    assertFalse(CastUrls.isToken("00112233445566778899aabbccddeefg"))
    assertFalse(CastUrls.isToken("../12233445566778899aabbccddeeff"))
  }

  @Test fun pathsAndUrls() {
    val token = "00112233445566778899aabbccddeeff"
    assertEquals("/$token", CastUrls.videoPath(token))
    assertEquals("/$token.vtt", CastUrls.subtitlePath(token))
    assertEquals("http://192.168.1.20:41234/$token", CastUrls.url("192.168.1.20", 41234, CastUrls.videoPath(token)))
    assertEquals("http://[fe80::1]:8000/x", CastUrls.url("fe80::1", 8000, "/x"))
  }

  @Test fun aUrlNeedsARealPortAndAPath() {
    assertThrows(IllegalArgumentException::class.java) { CastUrls.url("10.0.0.2", 0, "/x") }
    assertThrows(IllegalArgumentException::class.java) { CastUrls.url("10.0.0.2", 70_000, "/x") }
    assertThrows(IllegalArgumentException::class.java) { CastUrls.url("10.0.0.2", 80, "x") }
  }

  @Test fun tokensCompareExactly() {
    val token = CastUrls.newToken()
    assertTrue(CastUrls.sameToken(token, token))
    assertFalse(CastUrls.sameToken(token, token.dropLast(1)))
    assertFalse(CastUrls.sameToken(token, token.dropLast(1) + if (token.last() == 'a') 'b' else 'a'))
    assertNotEquals(token, CastUrls.newToken())
  }
}
