package com.vidorax.media.library

import android.app.PendingIntent
import android.content.Intent
import android.content.IntentSender
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** H21 "Also remove the Gallery copy": only VidoraX's own recorded copy, in its own folders; Android's dialog when needed. */
@RunWith(RobolectricTestRunner::class)
class GalleryCopyRemovalTest {
  private val ours = "content://media/external_primary/video/media/41"

  private class Records(vararg recorded: String) : GalleryCopyRecords {
    val uris = recorded.toMutableSet()
    val forgotten = mutableListOf<String>()

    override suspend fun isRecorded(uri: String) = uri in uris

    override suspend fun forget(uri: String) {
      forgotten += uri
      uris.remove(uri)
    }
  }

  private class Store(
    var folder: String? = "Movies/VidoraX/Web/",
    val answers: ArrayDeque<GalleryDeleteAttempt> = ArrayDeque(listOf(GalleryDeleteAttempt.Deleted)),
  ) : GalleryMediaStore {
    val deletes = mutableListOf<String>()

    override fun folderOf(uri: String): String? = folder

    override fun delete(uri: String): GalleryDeleteAttempt {
      deletes += uri
      val answer = answers.removeFirstOrNull() ?: GalleryDeleteAttempt.Failed(IllegalStateException("unexpected"))
      if (answer == GalleryDeleteAttempt.Deleted) folder = null
      return answer
    }
  }

  private class Consent(private val allow: Boolean, private val onAllow: () -> Unit = {}) : GalleryDeleteConsent {
    var asked = 0

    override suspend fun ask(request: IntentSender): Boolean {
      asked += 1
      if (allow) onAllow()
      return allow
    }
  }

  private fun sender(): IntentSender = PendingIntent.getBroadcast(
    RuntimeEnvironment.getApplication(),
    0,
    Intent("delete"),
    PendingIntent.FLAG_IMMUTABLE,
  ).intentSender

  @Test fun ourOwnRecordedCopyIsDeletedAndForgotten() = runBlocking {
    val records = Records(ours)
    val store = Store()
    assertEquals(GalleryRemovalOutcome.REMOVED, GalleryCopyRemoval(records, store, Consent(allow = false)).remove(ours))
    assertEquals(listOf(ours), store.deletes)
    assertEquals("no longer counted as downloaded", listOf(ours), records.forgotten)
  }

  @Test fun aCopyVidoraXNeverRecordedIsNeverTouched() = runBlocking {
    val store = Store()
    val other = "content://media/external_primary/video/media/7"
    assertEquals(GalleryRemovalOutcome.NOT_OURS, GalleryCopyRemoval(Records(ours), store, Consent(true)).remove(other))
    assertTrue(store.deletes.isEmpty())
  }

  @Test fun aRecordedUriThatNowPointsOutsideVidoraXsFoldersIsNeverTouched() = runBlocking {
    val records = Records(ours)
    for (folder in listOf("DCIM/Camera/", "Movies/", "Movies/VidoraXOther/", "Download/VidoraX/")) {
      val store = Store(folder = folder)
      assertEquals(folder, GalleryRemovalOutcome.NOT_OURS, GalleryCopyRemoval(records, store, Consent(true)).remove(ours))
      assertTrue(folder, store.deletes.isEmpty())
    }
    assertTrue("its record is kept", records.forgotten.isEmpty())
  }

  @Test fun anythingButAMediaStoreUriIsRefused() = runBlocking {
    val path = "file:///storage/emulated/0/Movies/VidoraX/Web/clip.mp4"
    val store = Store()
    assertEquals(GalleryRemovalOutcome.NOT_OURS, GalleryCopyRemoval(Records(path), store, Consent(true)).remove(path))
    assertTrue(store.deletes.isEmpty())
  }

  @Test fun aCopyAlreadyDeletedInTheGalleryIsJustForgotten() = runBlocking {
    val records = Records(ours)
    val store = Store(folder = null)
    assertEquals(GalleryRemovalOutcome.GONE, GalleryCopyRemoval(records, store, Consent(true)).remove(ours))
    assertTrue(store.deletes.isEmpty())
    assertEquals(listOf(ours), records.forgotten)
  }

  @Test fun fromAndroid11TheSystemDialogDeletesItWhenTheUserAllows() = runBlocking {
    val store = Store(answers = ArrayDeque(listOf(GalleryDeleteAttempt.NeedsConsent(sender(), retryAfterConsent = false))))
    val consent = Consent(allow = true) { store.folder = null }
    val records = Records(ours)
    assertEquals(GalleryRemovalOutcome.REMOVED, GalleryCopyRemoval(records, store, consent).remove(ours))
    assertEquals(1, consent.asked)
    assertEquals("the dialog deleted it; VidoraX did not delete again", 1, store.deletes.size)
    assertEquals(listOf(ours), records.forgotten)
  }

  @Test fun onAndroid10TheDeleteIsRepeatedAfterConsent() = runBlocking {
    val store = Store(
      answers = ArrayDeque(listOf(GalleryDeleteAttempt.NeedsConsent(sender(), retryAfterConsent = true), GalleryDeleteAttempt.Deleted)),
    )
    assertEquals(GalleryRemovalOutcome.REMOVED, GalleryCopyRemoval(Records(ours), store, Consent(true)).remove(ours))
    assertEquals(2, store.deletes.size)
  }

  @Test fun aUserWhoSaysNoKeepsTheCopyAndItsRecord() = runBlocking {
    val records = Records(ours)
    val store = Store(answers = ArrayDeque(listOf(GalleryDeleteAttempt.NeedsConsent(sender(), retryAfterConsent = false))))
    assertEquals(GalleryRemovalOutcome.DECLINED, GalleryCopyRemoval(records, store, Consent(false)).remove(ours))
    assertTrue(records.forgotten.isEmpty())
  }

  @Test fun aDialogThatSaysYesButLeavesTheCopyIsAFailure() = runBlocking {
    val records = Records(ours)
    val store = Store(answers = ArrayDeque(listOf(GalleryDeleteAttempt.NeedsConsent(sender(), retryAfterConsent = false))))
    assertEquals(GalleryRemovalOutcome.FAILED, GalleryCopyRemoval(records, store, Consent(true)).remove(ours))
    assertTrue(records.forgotten.isEmpty())
  }

  @Test fun aFailedDeleteKeepsTheRecord() = runBlocking {
    val records = Records(ours)
    val store = Store(answers = ArrayDeque(listOf(GalleryDeleteAttempt.Failed(SecurityException("no")))))
    assertEquals(GalleryRemovalOutcome.FAILED, GalleryCopyRemoval(records, store, Consent(true)).remove(ours))
    assertTrue(records.forgotten.isEmpty())
  }

  @Test fun ownGalleryFolders() {
    assertTrue(GalleryCopyRemoval.isInOwnGalleryFolder("Movies/VidoraX/Instagram/"))
    assertTrue(GalleryCopyRemoval.isInOwnGalleryFolder("/movies/vidorax/web"))
    assertTrue(GalleryCopyRemoval.isInOwnGalleryFolder("Music/VidoraX/"))
    assertFalse(GalleryCopyRemoval.isInOwnGalleryFolder("Movies/VidoraX2/"))
    assertFalse(GalleryCopyRemoval.isInOwnGalleryFolder("Pictures/VidoraX/"))
    assertFalse(GalleryCopyRemoval.isInOwnGalleryFolder(""))
  }
}
