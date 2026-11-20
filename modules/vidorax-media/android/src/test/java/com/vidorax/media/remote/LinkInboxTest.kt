package com.vidorax.media.remote

import com.vidorax.media.model.DownloadState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** P6: links from outside wait for the app's Batch Add path and survive a restart until reported. */
class LinkInboxTest {
  private val storage = InMemoryPendingLinkStorage()
  private val inbox = LinkInbox(storage)
  private val url = "https://example.com/video.mp4"

  @Test
  fun aLinkWaitsUntilTheAppListensThenIsHandedOver() {
    val request = inbox.submit(url, LinkSource.AUTOMATION)!!
    assertEquals(LinkRequest.WAITING_FOR_APP, request.status)
    val delivered = mutableListOf<LinkRequest>()
    inbox.setListener { delivered += it }
    assertEquals(listOf(request.requestId), delivered.map { it.requestId })
    assertEquals(LinkRequest.CHECKING, inbox.get(request.requestId)!!.status)
  }

  @Test
  fun whileTheAppListensLinksGoStraightThrough() {
    val delivered = mutableListOf<LinkRequest>()
    inbox.setListener { delivered += it }
    val request = inbox.submit(url, LinkSource.WEB)!!
    assertEquals(LinkRequest.CHECKING, request.status)
    assertEquals(request, delivered.single())
  }

  @Test
  fun unreportedLinksSurviveARestart() {
    val request = inbox.submit(url, LinkSource.AUTOMATION)!!
    val restarted = LinkInbox(storage)
    assertEquals(request.requestId, restarted.pending().single().requestId)
    restarted.report(request.requestId, "added", "Title", "d1", "ENQUEUED")
    assertTrue(storage.saved.isEmpty())
    assertTrue(LinkInbox(storage).pending().isEmpty())
  }

  @Test
  fun aNewJavascriptRuntimeGetsLinksTheOldOneWasChecking() {
    inbox.setListener { }
    val request = inbox.submit(url, LinkSource.WEB)!!
    inbox.setListener(null)
    val delivered = mutableListOf<LinkRequest>()
    inbox.setListener { delivered += it }
    assertEquals(request.requestId, delivered.single().requestId)
  }

  @Test
  fun outcomesMapToApiStatuses() {
    val request = inbox.submit(url, LinkSource.WEB)!!
    assertTrue(inbox.report(request.requestId, "needs-review", null, null, "UNRESOLVED"))
    assertEquals("needs_review", inbox.get(request.requestId)!!.status)
    assertFalse(inbox.report(request.requestId, "exploded", null, null, null))
    assertFalse(inbox.report("unknown", "added", null, null, null))
  }

  @Test
  fun refusesBadLinksAndAFullInbox() {
    assertNull(inbox.submit("ftp://example.com/x", LinkSource.WEB))
    assertNull(inbox.submit("javascript:alert(1)", LinkSource.WEB))
    repeat(LinkInbox.MAX_PENDING) { assertNotNull(inbox.submit("$url?$it", LinkSource.WEB)) }
    assertNull(inbox.submit(url, LinkSource.WEB))
  }

  @Test
  fun linkRulesAcceptOnlyPlainHttpLinks() {
    assertEquals(url, LinkRules.acceptable("  $url "))
    assertEquals("HTTP://EXAMPLE.COM/a", LinkRules.acceptable("HTTP://EXAMPLE.COM/a"))
    assertNull(LinkRules.acceptable("content://media/1"))
    assertNull(LinkRules.acceptable("https:///nohost"))
    assertNull(LinkRules.acceptable("https://exa mple.com"))
    assertNull(LinkRules.acceptable(null))
  }

  @Test
  fun queueActionsMatchTheAppsOwnRow() {
    assertEquals(listOf("pause", "cancel"), RemoteDownload.actionsFor(DownloadState.DOWNLOADING))
    assertEquals(listOf("resume", "cancel"), RemoteDownload.actionsFor(DownloadState.PAUSED))
    assertEquals(listOf("retry"), RemoteDownload.actionsFor(DownloadState.FAILED))
    assertEquals(emptyList<String>(), RemoteDownload.actionsFor(DownloadState.COMPLETED))
    assertEquals(emptyList<String>(), RemoteDownload.actionsFor(DownloadState.RECORDING))
  }
}
