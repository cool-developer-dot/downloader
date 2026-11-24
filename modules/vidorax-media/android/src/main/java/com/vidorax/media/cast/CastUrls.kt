package com.vidorax.media.cast

import java.security.SecureRandom

/**
 * P13 #667: the secret part of the local server's URLs. Pure, so it is unit tested.
 *
 * Each cast gets new tokens of [TOKEN_BYTES] random bytes (128 bits) from [SecureRandom], written as lowercase hex.
 * The server answers only `/<videoToken>` and `/<subtitleToken>.vtt`; anything else is a 404, so nobody on the
 * network can guess a URL or list what the phone has.
 */
object CastUrls {
  const val TOKEN_BYTES = 16
  const val TOKEN_HEX_LENGTH = TOKEN_BYTES * 2
  const val SUBTITLE_SUFFIX = ".vtt"

  private val random = SecureRandom()

  fun newToken(source: SecureRandom = random): String {
    val bytes = ByteArray(TOKEN_BYTES)
    source.nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  fun isToken(value: String): Boolean =
    value.length == TOKEN_HEX_LENGTH && value.all { it in '0'..'9' || it in 'a'..'f' }

  fun videoPath(token: String): String = "/$token"

  fun subtitlePath(token: String): String = "/$token$SUBTITLE_SUFFIX"

  /** `http://<ipv4>:<port><path>`; the address is the phone's Wi-Fi IPv4 (an IPv6 one would need brackets). */
  fun url(host: String, port: Int, path: String): String {
    require(port in 1..65_535) { "port" }
    require(path.startsWith("/")) { "path" }
    val authority = if (host.contains(':')) "[$host]" else host
    return "http://$authority:$port$path"
  }

  /** Compares a requested token in time independent of where it differs (no timing hint for guessing). */
  fun sameToken(expected: String, requested: String): Boolean {
    if (expected.length != requested.length) return false
    var diff = 0
    for (i in expected.indices) diff = diff or (expected[i].code xor requested[i].code)
    return diff == 0
  }
}
