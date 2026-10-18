package com.vidorax.media.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #480: each download's own "Wi-Fi only", what is stored for it, and the rule the engine applies. */
class NetworkChoicesTest {
  @Test fun aDownloadWithoutAChoiceFollowsTheSetting() {
    val choices = NetworkChoices()
    assertNull(choices.wifiOnly("a"))
    assertTrue(NetworkChoices.effective(null, setting = true))
    assertFalse(NetworkChoices.effective(null, setting = false))
  }

  @Test fun theDownloadsOwnChoiceWinsEitherWay() {
    assertFalse("allowed on mobile data although the setting says Wi-Fi only", NetworkChoices.effective(false, setting = true))
    assertTrue("Wi-Fi only although the setting allows mobile data", NetworkChoices.effective(true, setting = false))
  }

  @Test fun choicesSurviveARestartAndEndedDownloadsAreDropped() {
    val storage = NetworkChoices.Storage.memory()
    NetworkChoices(storage).apply {
      put("a", true, live = emptyList())
      put("b", false, live = listOf("a"))
    }
    val restored = NetworkChoices(storage)
    assertEquals(true, restored.wifiOnly("a"))
    assertEquals(false, restored.wifiOnly("b"))

    // "a" ended: the next write keeps only downloads that still exist.
    restored.put("c", true, live = listOf("b"))
    val again = NetworkChoices(storage)
    assertNull(again.wifiOnly("a"))
    assertEquals(false, again.wifiOnly("b"))
    assertEquals(true, again.wifiOnly("c"))
  }

  @Test fun unreadableOrForeignStorageIsNoChoice() {
    val storage = NetworkChoices.Storage.memory()
    storage.write("""{"a":"yes","b":1,"":true,"c":false}""")
    val choices = NetworkChoices(storage)
    assertNull(choices.wifiOnly("a"))
    assertNull(choices.wifiOnly("b"))
    assertEquals(false, choices.wifiOnly("c"))

    storage.write("not json")
    assertNull(NetworkChoices(storage).wifiOnly("c"))
  }

  @Test fun theSameChoiceTwiceIsStoredOnce() {
    val storage = NetworkChoices.Storage.memory()
    val choices = NetworkChoices(storage)
    choices.put("a", true, live = emptyList())
    choices.put("a", true, live = emptyList())
    assertEquals("""{"a":true}""", storage.read())
  }
}
