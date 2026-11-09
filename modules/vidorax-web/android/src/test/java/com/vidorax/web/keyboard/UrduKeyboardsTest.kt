package com.vidorax.web.keyboard

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrduKeyboardsTest {
  @Test
  fun urduSubtypeTagsAreRecognised() {
    for (tag in listOf("ur", "ur_PK", "ur-IN", "UR", "ur-Arab-PK")) assertTrue(tag, UrduKeyboards.isUrduTag(tag))
    for (tag in listOf("en_US", "ar", "fa", "pa_PK", "", null, "uru", "u")) assertFalse(tag.toString(), UrduKeyboards.isUrduTag(tag))
  }
}
