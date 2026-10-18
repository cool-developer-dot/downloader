package com.vidorax.media.engine

import com.vidorax.media.model.Container
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #494 Custom Extension: which asked-for extensions are safe aliases, and how the per-download choice is kept. */
class PreferredExtensionsTest {
  @Test fun onlyTheKnownAliasesAreAPreference() {
    assertEquals("m4v", PreferredExtensions.normalize("m4v"))
    assertEquals("m4v", PreferredExtensions.normalize(" .M4V "))
    assertEquals("mp4", PreferredExtensions.normalize("MP4"))
    assertEquals("m4a", PreferredExtensions.normalize(".m4a"))
    for (other in listOf(null, "", " ", "mkv", "webm", "mov", "exe", "mp4.exe", "../mp4", "auto", "automatic")) {
      assertNull(other, PreferredExtensions.normalize(other))
    }
  }

  @Test fun anMp4VideoTakesMp4OrM4v() {
    assertEquals("m4v", PreferredExtensions.resolve("m4v", Container.MP4, audioOnly = false))
    assertEquals("mp4", PreferredExtensions.resolve("mp4", Container.MP4, audioOnly = false))
    assertNull("m4a is not a video", PreferredExtensions.resolve("m4a", Container.MP4, audioOnly = false))
  }

  @Test fun anAudioOnlyMp4TakesM4aOrMp4() {
    assertEquals("m4a", PreferredExtensions.resolve("m4a", Container.MP4, audioOnly = true))
    assertEquals("mp4", PreferredExtensions.resolve("mp4", Container.MP4, audioOnly = true))
    assertNull("m4v is a video", PreferredExtensions.resolve("m4v", Container.MP4, audioOnly = true))
  }

  @Test fun everyOtherContainerIgnoresThePreference() {
    for (container in Container.values().filter { it != Container.MP4 }) {
      for (preferred in PreferredExtensions.ACCEPTED) {
        assertNull("$preferred for $container", PreferredExtensions.resolve(preferred, container, audioOnly = false))
        assertNull("$preferred for audio $container", PreferredExtensions.resolve(preferred, container, audioOnly = true))
      }
    }
    assertNull(PreferredExtensions.resolve(null, Container.MP4, audioOnly = false))
    assertNull(PreferredExtensions.resolve("mkv", Container.MP4, audioOnly = false))
  }

  @Test fun anM4vFileIsRecordedAsVideoXM4vAndNothingElseChanges() {
    assertEquals("video/x-m4v", PreferredExtensions.libraryMimeType(java.io.File("a/Clip_ab12.m4v"), "video/mp4"))
    assertEquals("video/x-m4v", PreferredExtensions.libraryMimeType(java.io.File("Clip.M4V"), "video/mp4"))
    assertEquals("video/mp4", PreferredExtensions.libraryMimeType(java.io.File("Clip.mp4"), "video/mp4"))
    assertEquals("audio/mp4", PreferredExtensions.libraryMimeType(java.io.File("Clip.m4a"), "audio/mp4"))
    assertEquals("video/webm", PreferredExtensions.libraryMimeType(java.io.File("Clip.m4v"), "video/webm"))
    assertNull(PreferredExtensions.libraryMimeType(java.io.File("Clip.m4v"), null))
  }

  @Test fun theChoiceSurvivesARestartAndGoneDownloadsAreDropped() {
    val storage = PreferredExtensions.Storage.memory()
    val first = PreferredExtensions(storage)
    first.put("a", "m4v", live = emptyList())
    first.put("b", "mp4", live = listOf("a"))
    assertEquals("m4v", first.get("a"))

    val restarted = PreferredExtensions(storage)
    assertEquals("m4v", restarted.get("a"))
    assertEquals("mp4", restarted.get("b"))
    assertNull(restarted.get("c"))

    // "a" finished or was removed: it is dropped when the next download asks for an extension.
    restarted.put("c", "m4v", live = listOf("b"))
    assertNull(PreferredExtensions(storage).get("a"))
    assertEquals("m4v", PreferredExtensions(storage).get("c"))
  }

  @Test fun brokenOrForeignStorageIsIgnored() {
    for (stored in listOf("not json", "[]", "{\"a\":\"exe\",\"b\":5}", "{\"\":\"m4v\"}")) {
      val storage = PreferredExtensions.Storage.memory().apply { write(stored) }
      val loaded = PreferredExtensions(storage)
      assertNull(stored, loaded.get("a"))
      assertNull(stored, loaded.get("b"))
      assertNull(stored, loaded.get(""))
    }
  }
}
