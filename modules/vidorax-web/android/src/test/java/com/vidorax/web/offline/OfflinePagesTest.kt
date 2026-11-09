package com.vidorax.web.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.io.File

@RunWith(RobolectricTestRunner::class)
class OfflinePagesTest {
  @get:Rule val folder = TemporaryFolder()

  @Test
  fun archivesLiveInTheirProfilesFolderOnly() {
    val files = folder.root
    assertEquals(File(files, "offline-pages/default/abc-1.mht"), OfflinePages.archiveFile(files, "default", "abc-1"))
    assertNull(OfflinePages.archiveFile(files, "default", "../x"))
    assertNull(OfflinePages.archiveFile(files, "../evil", "abc"))
    assertNull(OfflinePages.archiveFile(files, "default", ""))
    val inside = OfflinePages.archiveFile(files, "p2", "id")!!
    assertTrue(OfflinePages.isInside(files, inside))
    assertFalse(OfflinePages.isInside(files, File(files, "offline-pages/p2/../../secret.mht")))
    assertFalse(OfflinePages.isInside(files, File(files, "offline-pages/p2/id.html")))
    assertFalse(OfflinePages.isInside(files, File(files, "other/p2/id.mht")))
  }

  @Test
  fun deletingAProfileRemovesItsPagesOnly() {
    val files = folder.root
    val a = OfflinePages.archiveFile(files, "guest", "a")!!.apply { parentFile!!.mkdirs(); writeText("x") }
    val b = OfflinePages.archiveFile(files, "default", "b")!!.apply { parentFile!!.mkdirs(); writeText("x") }
    assertTrue(OfflinePages.deleteProfile(files, "guest"))
    assertFalse(a.exists())
    assertTrue(b.exists())
    assertFalse(OfflinePages.deleteProfile(files, "../default"))
  }

  @Test
  fun theViewerRefusesAPathOutsideItsFolder() {
    val context = RuntimeEnvironment.getApplication()
    val outside = File(context.filesDir, "notes.mht").apply { writeText("x") }
    val activity = Robolectric.buildActivity(OfflinePageActivity::class.java, OfflinePageActivity.intent(context, outside, "t")).create().get()
    assertTrue(activity.isFinishing)
  }
}
