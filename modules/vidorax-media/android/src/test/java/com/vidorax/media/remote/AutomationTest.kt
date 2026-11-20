package com.vidorax.media.remote

import android.content.Intent
import android.net.Uri
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** #499: intents are ignored while the switch is off; the completion broadcast carries no URL. */
@RunWith(RobolectricTestRunner::class)
class AutomationTest {
  private val context = RuntimeEnvironment.getApplication()

  private fun record(id: String, state: DownloadState) = DownloadRecord(
    id = id,
    state = state,
    title = "Big Buck Bunny",
    site = SiteId.entries.first(),
    kind = SourceKind.entries.first(),
    pageUrl = "https://example.com/page",
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = 1,
    totalBytes = 1,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    libraryItemId = "lib",
    createdAt = 1,
    updatedAt = 2,
  )

  @Test
  fun theSwitchIsOffByDefault() {
    assertFalse(AutomationSettings.allowed(context))
    AutomationSettings.setAllowed(context, true)
    assertTrue(AutomationSettings.allowed(context))
    AutomationSettings.setAllowed(context, false)
  }

  @Test
  fun addDownloadIsIgnoredWhileTheSwitchIsOff() {
    val pendingBefore = RemoteComponents.get(context).inbox.pending().size
    AutomationReceiver().onReceive(
      context,
      Intent(AutomationReceiver.ACTION_ADD_DOWNLOAD).putExtra("url", "https://example.com/off.mp4"),
    )
    assertEquals(pendingBefore, RemoteComponents.get(context).inbox.pending().size)

    AutomationSettings.setAllowed(context, true)
    AutomationReceiver().onReceive(
      context,
      Intent(AutomationReceiver.ACTION_ADD_DOWNLOAD).putExtra("url", "https://example.com/on.mp4"),
    )
    val pending = RemoteComponents.get(context).inbox.pending()
    assertEquals("https://example.com/on.mp4", pending.last().url)
    assertEquals(LinkSource.AUTOMATION, pending.last().source)
    AutomationSettings.setAllowed(context, false)
  }

  @Test
  fun theLinkComesFromUrlTextOrData() {
    assertEquals("https://a.example/1", AutomationReceiver.linkFrom(Intent().putExtra("url", "https://a.example/1")))
    assertEquals(
      "https://b.example/2",
      AutomationReceiver.linkFrom(Intent().putExtra(Intent.EXTRA_TEXT, "Watch this https://b.example/2 now")),
    )
    assertEquals("https://c.example/3", AutomationReceiver.linkFrom(Intent().setData(Uri.parse("https://c.example/3"))))
    assertNull(AutomationReceiver.linkFrom(Intent().putExtra("url", "file:///sdcard/x")))
  }

  @Test
  fun completionIsAnnouncedOnceWithIdAndTitleOnly() {
    assertFalse(AutomationEvents.shouldAnnounce(record("x1", DownloadState.DOWNLOADING)))
    assertTrue(AutomationEvents.shouldAnnounce(record("x1", DownloadState.COMPLETED)))
    assertFalse(AutomationEvents.shouldAnnounce(record("x1", DownloadState.COMPLETED)))
    val intent = AutomationEvents.completionIntent(record("x2", DownloadState.COMPLETED))
    assertEquals(AutomationEvents.ACTION_DOWNLOAD_COMPLETE, intent.action)
    assertEquals(setOf("id", "title"), intent.extras!!.keySet())
    assertEquals("Big Buck Bunny", intent.getStringExtra("title"))
  }
}
