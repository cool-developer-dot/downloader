package com.vidorax.media.runner

import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * H4: a download waiting in a held queue is not work. It keeps neither the background host nor a notification up;
 * when its queue is resumed the engine announces it again and the runner counts it as before.
 */
class DownloadRunnerHeldQueueTest {
  private class FakeHost : RunnerHost {
    var starts = 0
    var stops = 0
    var running = false
    var activeCount = 0

    override fun start(summary: RunnerSummaryContent) {
      starts += 1
      running = true
      activeCount = summary.activeCount
    }

    override fun update(summary: RunnerSummaryContent) {
      activeCount = summary.activeCount
    }

    override fun stop() {
      stops += 1
      running = false
      activeCount = 0
    }
  }

  private class FakeNotifier : DownloadNotifier {
    val shown = mutableListOf<String>()
    val cleared = mutableListOf<String>()

    override fun show(content: DownloadNotificationContent) {
      shown += content.downloadId
    }

    override fun clear(downloadId: String) {
      cleared += downloadId
    }
  }

  private val host = FakeHost()
  private val notifier = FakeNotifier()
  private val held = mutableSetOf<String>()
  private val runner = DownloadRunner(host, notifier) { 0L }.also { runner -> runner.isHeld = { it in held } }

  private fun record(id: String, state: DownloadState) = DownloadRecord(
    id = id,
    state = state,
    title = "Clip $id",
    site = SiteId.WEB,
    kind = SourceKind.PROGRESSIVE,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = 0,
    totalBytes = 1_000,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    libraryItemId = null,
    createdAt = 0,
    updatedAt = 0,
  )

  @Test fun withoutHeldQueuesAQueuedDownloadKeepsTheHostUpAsToday() {
    val plain = DownloadRunner(host, notifier) { 0L }
    plain.onState(record("a", DownloadState.QUEUED))
    assertTrue(host.running)
    assertTrue(plain.hasLiveWork())
  }

  @Test fun aHeldDownloadNeverStartsTheHost() {
    held += "a"
    runner.onState(record("a", DownloadState.QUEUED))
    assertFalse(host.running)
    assertFalse(runner.hasLiveWork())
    assertTrue(notifier.shown.isEmpty())
  }

  @Test fun holdingTheLastWaitingDownloadStopsTheHostAndResumingStartsItAgain() {
    runner.onState(record("a", DownloadState.QUEUED))
    assertTrue(host.running)
    held += "a"
    runner.onState(record("a", DownloadState.QUEUED)) // the engine announces it again when its queue is held
    assertFalse(host.running)
    assertEquals(1, host.stops)
    assertFalse(runner.hasLiveWork())

    held -= "a"
    runner.onState(record("a", DownloadState.QUEUED)) // and again when the queue is resumed
    assertTrue(host.running)
    assertEquals(2, host.starts)
  }

  @Test fun aHeldDownloadNextToARunningOneLeavesOnlyTheRunningOneCounted() {
    runner.onState(record("a", DownloadState.DOWNLOADING))
    runner.onState(record("b", DownloadState.QUEUED))
    assertEquals(2, host.activeCount)
    assertTrue("two live downloads: each has its own notification", "b" in notifier.shown)
    held += "b"
    runner.onState(record("b", DownloadState.QUEUED))
    assertEquals(1, host.activeCount)
    assertTrue("its own notification is taken away", "b" in notifier.cleared)
    assertTrue(host.running)
  }

  @Test fun aHeldDownloadThatIsPausedOrStartsIsTrackedAsUsual() {
    held += "a"
    runner.onState(record("a", DownloadState.QUEUED))
    runner.onState(record("a", DownloadState.DOWNLOADING))
    assertTrue("only a waiting download is affected", host.running)
    runner.onState(record("a", DownloadState.PAUSED))
    assertFalse(host.running)
  }
}
