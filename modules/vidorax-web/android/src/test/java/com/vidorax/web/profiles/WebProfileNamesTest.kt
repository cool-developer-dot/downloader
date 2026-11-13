package com.vidorax.web.profiles

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebProfileNamesTest {
  @Test
  fun acceptsTheDefaultProfileAndVidoraXNamesOnly() {
    assertTrue(WebProfileNames.isValid("Default"))
    assertTrue(WebProfileNames.isValid("vidorax-guest"))
    assertTrue(WebProfileNames.isValid("vidorax-p1x9k2"))
    assertTrue(WebProfileNames.isValid("vidorax-" + "a".repeat(32)))
  }

  @Test
  fun refusesAnyOtherName() {
    listOf(
      "",
      "default",
      "vidorax-",
      "vidorax-Work",
      "vidorax-a b",
      "vidorax-../x",
      "vidorax-" + "a".repeat(33),
      "other-profile",
      "Default ",
    ).forEach { assertFalse(it, WebProfileNames.isValid(it)) }
  }

  @Test
  fun onlyDefaultIsTheDefault() {
    assertTrue(WebProfileNames.isDefault("Default"))
    assertFalse(WebProfileNames.isDefault("vidorax-guest"))
  }
}
