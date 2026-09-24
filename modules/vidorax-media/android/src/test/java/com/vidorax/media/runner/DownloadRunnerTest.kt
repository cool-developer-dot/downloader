package com.vidorax.media.runner

import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.ProgressPhase
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The runner turns engine state into "is a background host needed" and "what does each notification say".
 * These are the background/notification behaviours Phase 8 promises, without an Android runtime.
 */
class DownloadRunnerTest {
  private class FakeHost : RunnerHost {
    var starts = 0
    var updates = 0
    var stops = 0
    var summary: RunnerSummaryContent = RunnerSummaryContent.IDLE

    override fun start(summary: RunnerSummaryContent) {
      starts += 1
      this.summary = summary
    }

    override fun update(summary: RunnerSummaryContent) {
      updates += 1
      this.summary = summary
    }

    override fun stop() {
      stops += 1
      summary = RunnerSummaryContent.IDLE
    }
  }

  private class FakeNotifier : DownloadNotifier {
    val posted = mutableListOf<DownloadNotificationContent>()
    val cleared = mutableListOf<String>()

    override fun show(content: DownloadNotificationContent) {
      posted += content
    }

    override fun clear(downloadId: String) {
      cleared += downloadId
    }

    fun latest(id: String): DownloadNotificationContent? = posted.lastOrNull { it.downloadId == id }

    fun countOf(id: String, kind: DownloadNotificationContent.Kind): Int =
      posted.count { it.downloadId == id && it.kind == kind }
  }

  private val host = FakeHost()
  private val notifier = FakeNotifier()
  private var now = 0L
  private val runner = DownloadRunner(host, notifier) { now }

  private fun record(
    id: String = "dl-1",
    state: DownloadState,
    bytesDone: Long = 0,
    totalBytes: Long? = 1_000,
    title: String = "Beach clip",
    errorCode: DownloadErrorCode? = null,
    errorMessage: String? = null,
  ) = DownloadRecord(
    id = id,
    state = state,
    title = title,
    site = SiteId.WEB,
    kind = SourceKind.PROGRESSIVE,
    pageUrl = "https://example.test/watch/42",
    thumbnailUrl = null,
    qualityLabel = "720p",
    bytesDone = bytesDone,
    totalBytes = totalBytes,
    errorCode = errorCode,
    errorMessage = errorMessage,
    attempts = 0,
    libraryItemId = null,
    createdAt = 0,
    updatedAt = 0,
  )

  private fun progress(id: String = "dl-1", bytesDone: Long, totalBytes: Long? = 1_000, speedBps: Long = 100) = DownloadProgress(
    id = id,
    phase = ProgressPhase.DOWNLOAD,
    bytesDone = bytesDone,
    totalBytes = totalBytes,
    fraction = totalBytes?.let { bytesDone.toDouble() / it },
    speedBps = speedBps,
    etaSeconds = null,
  )

  private fun tick(ms: Long = 1_000) {
    now += ms
  }

  @Test
  fun `1 a live download keeps the background host running while it transfers`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    assertEquals("the host starts as soon as work is live", 1, host.starts)

    repeat(3) { step ->
      tick()
      runner.onProgress(progress(bytesDone = 200L * (step + 1)))
    }

    assertEquals("nothing may stop the host mid-transfer", 0, host.stops)
    assertEquals("and it is started exactly once", 1, host.starts)
    assertEquals(1, host.summary.activeCount)
    assertEquals("the one live download is the runner's own notification", "Beach clip", host.summary.title)
    assertEquals(60, host.summary.percent)
    assertTrue(
      "and it is not shown twice",
      notifier.posted.none { it.kind == DownloadNotificationContent.Kind.ACTIVE },
    )
    assertTrue(runner.hasLiveWork())
  }

  @Test
  fun `2 returning to the foreground finds the current progress`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    tick()
    runner.onProgress(progress(bytesDone = 500))
    assertEquals(50, host.summary.percent)

    tick()
    runner.onProgress(progress(bytesDone = 900))
    assertEquals(90, host.summary.percent)
    assertEquals("Beach clip", host.summary.title)
    assertTrue(
      "bytes are shown when they are known: ${host.summary.text}",
      host.summary.text.contains("900 B of 1.0 kB"),
    )
  }

  @Test
  fun `3 a paused download stays paused in the background`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    tick()
    runner.onProgress(progress(bytesDone = 400))
    runner.onState(record(state = DownloadState.PAUSED, bytesDone = 400))

    assertEquals("nothing is live, so the host is released", 1, host.stops)
    assertFalse(runner.hasLiveWork())
    val paused = notifier.latest("dl-1")!!
    assertEquals(DownloadNotificationContent.Kind.PAUSED, paused.kind)
    assertEquals(DownloadNotificationText.PAUSED, paused.text.substringBefore(" ·"))
    assertFalse("a paused notification is the user's to dismiss", paused.ongoing)
    assertEquals(40, paused.percent)

    // A late progress event from a worker that is winding down must not make it look like it resumed.
    tick()
    runner.onProgress(progress(bytesDone = 450))
    assertEquals(DownloadNotificationContent.Kind.PAUSED, notifier.latest("dl-1")!!.kind)
    assertEquals("the host is not brought back by a stray event", 1, host.starts)
  }

  @Test
  fun `4 resuming after a background pause brings the host back`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    runner.onState(record(state = DownloadState.PAUSED, bytesDone = 400))
    runner.onState(record(state = DownloadState.DOWNLOADING, bytesDone = 400))

    assertEquals(2, host.starts)
    assertEquals(1, host.stops)
    assertEquals(1, host.summary.activeCount)
    assertEquals("the paused notification gives way to the running one", listOf("dl-1"), notifier.cleared)
    assertEquals("Beach clip", host.summary.title)
    assertEquals("resume continues from the bytes already on disk", 40, host.summary.percent)
    assertFalse(host.summary.indeterminate)
  }

  @Test
  fun `5 cancelling removes the notification and releases the host`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    val postedBefore = notifier.posted.size
    runner.onState(record(state = DownloadState.CANCELLED, bytesDone = 400))

    assertEquals(listOf("dl-1"), notifier.cleared)
    assertEquals("a cancelled download leaves no notification behind", postedBefore, notifier.posted.size)
    assertEquals(1, host.stops)
    assertFalse(runner.hasLiveWork())
  }

  @Test
  fun `6 completion notifies exactly once`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    tick()
    runner.onProgress(progress(bytesDone = 900))
    runner.onState(record(state = DownloadState.COMPLETED, bytesDone = 1_000))

    assertEquals(1, notifier.countOf("dl-1", DownloadNotificationContent.Kind.COMPLETED))
    val done = notifier.latest("dl-1")!!
    assertEquals(DownloadNotificationText.COMPLETED, done.text.substringBefore(" ·"))
    assertFalse(done.ongoing)
    assertFalse(done.showProgress)
    assertEquals(1, host.stops)

    // Anything still in flight from the worker cannot resurrect a finished download.
    val postedAfterCompletion = notifier.posted.size
    tick()
    runner.onProgress(progress(bytesDone = 1_000))
    assertEquals(postedAfterCompletion, notifier.posted.size)
    assertEquals(1, notifier.countOf("dl-1", DownloadNotificationContent.Kind.COMPLETED))
  }

  @Test
  fun `7 failure notifies with a reason that leaks nothing`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    runner.onState(
      record(
        state = DownloadState.FAILED,
        bytesDone = 400,
        errorCode = DownloadErrorCode.HTTP_403,
        errorMessage = "GET https://cdn.example.test/v.mp4?token=SECRET failed with 403",
      ),
    )

    val failed = notifier.latest("dl-1")!!
    assertEquals(DownloadNotificationContent.Kind.FAILED, failed.kind)
    assertEquals(DownloadNotificationText.failure(DownloadErrorCode.HTTP_403), failed.text)
    assertFalse("no URL reaches the lock screen", failed.text.contains("http"))
    assertFalse(failed.text.contains("SECRET"))
    assertEquals(1, host.stops)
  }

  @Test
  fun `8 a repeated restore adopts the same downloads without a second runner`() {
    val rows = listOf(
      record(id = "dl-1", state = DownloadState.DOWNLOADING, bytesDone = 400),
      record(id = "dl-2", state = DownloadState.PAUSED, bytesDone = 100, title = "Second clip"),
      record(id = "dl-3", state = DownloadState.COMPLETED, bytesDone = 1_000, title = "Old clip"),
    )
    runner.restore(rows)
    runner.restore(rows)

    assertEquals("the host is started once, however often restore runs", 1, host.starts)
    assertEquals(0, host.stops)
    assertEquals(1, host.summary.activeCount)
    assertEquals(1, host.summary.pausedCount)
    assertNull("a finished download is not resurrected by a restart", notifier.latest("dl-3"))
    assertEquals(
      "the paused download keeps its own notification",
      DownloadNotificationContent.Kind.PAUSED,
      notifier.latest("dl-2")!!.kind,
    )
    assertEquals(
      "the same download keeps the same notification across processes",
      notificationIdFor("dl-1"),
      notificationIdFor("dl-1"),
    )
  }

  @Test
  fun `9 a restored download reconnects to its notification`() {
    runner.restore(listOf(record(state = DownloadState.DOWNLOADING, bytesDone = 400)))

    assertEquals(40, host.summary.percent)
    assertEquals("Beach clip", host.summary.title)
    assertEquals(1, host.summary.activeCount)

    tick()
    runner.onProgress(progress(bytesDone = 700))
    assertEquals(70, host.summary.percent)
    assertEquals(1, host.starts)
  }

  @Test
  fun `10 several downloads keep their own notification state`() {
    runner.onState(record(id = "dl-1", state = DownloadState.DOWNLOADING, bytesDone = 200, title = "First"))
    runner.onState(record(id = "dl-2", state = DownloadState.DOWNLOADING, bytesDone = 800, title = "Second"))

    assertNotEquals(notificationIdFor("dl-1"), notificationIdFor("dl-2"))
    assertEquals("a second live download gives both their own notification", 2, host.summary.activeCount)
    assertEquals("First", notifier.latest("dl-1")!!.title)
    assertEquals(20, notifier.latest("dl-1")!!.percent)
    assertEquals("Second", notifier.latest("dl-2")!!.title)
    assertEquals(80, notifier.latest("dl-2")!!.percent)
    assertEquals(2, host.summary.activeCount)

    runner.onState(record(id = "dl-1", state = DownloadState.PAUSED, bytesDone = 200, title = "First"))

    assertEquals("the second download still needs the host", 0, host.stops)
    assertEquals(1, host.summary.activeCount)
    assertEquals(1, host.summary.pausedCount)
    assertEquals("the paused one keeps its own notification", DownloadNotificationContent.Kind.PAUSED, notifier.latest("dl-1")!!.kind)
    assertEquals(20, notifier.latest("dl-1")!!.percent)
    assertEquals("the last live one moves into the runner notification", listOf("dl-2"), notifier.cleared)
    assertEquals("Second", host.summary.title)
    assertEquals(80, host.summary.percent)

    tick()
    runner.onProgress(progress(id = "dl-2", bytesDone = 900))
    assertEquals("and the paused one is untouched by it", 20, notifier.latest("dl-1")!!.percent)
    assertEquals(90, host.summary.percent)
  }


  @Test
  fun `a running download can be paused or cancelled from its notification`() {
    runner.onState(record(id = "dl-1", state = DownloadState.DOWNLOADING, title = "First"))
    runner.onState(record(id = "dl-2", state = DownloadState.DOWNLOADING, title = "Second"))

    val content = notifier.latest("dl-1")!!
    assertEquals(
      listOf(DownloadNotificationContent.Action.PAUSE, DownloadNotificationContent.Action.CANCEL),
      content.actions,
    )
    assertEquals(DownloadNotificationContent.Target.DOWNLOADS, content.target)
  }

  @Test
  fun `a paused download offers resume, a failed one offers retry`() {
    runner.onState(record(state = DownloadState.PAUSED, bytesDone = 400))
    assertEquals(
      listOf(DownloadNotificationContent.Action.RESUME, DownloadNotificationContent.Action.CANCEL),
      notifier.latest("dl-1")!!.actions,
    )

    runner.onState(record(state = DownloadState.FAILED, errorCode = DownloadErrorCode.NETWORK))
    assertEquals(listOf(DownloadNotificationContent.Action.RETRY), notifier.latest("dl-1")!!.actions)
  }

  @Test
  fun `a finished download opens the library, and offers nothing to stop`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    runner.onState(record(state = DownloadState.COMPLETED, bytesDone = 1_000))

    val done = notifier.latest("dl-1")!!
    assertEquals(DownloadNotificationContent.Target.LIBRARY, done.target)
    assertTrue(done.actions.isEmpty())
  }

  @Test
  fun `finishing up cannot be interrupted from the notification`() {
    val content = notificationContentFor(record(state = DownloadState.PROCESSING, bytesDone = 1_000))!!
    assertTrue(
      "verify/finalize is not something the engine can stop halfway",
      content.actions.isEmpty(),
    )
  }

  @Test
  fun `an unknown size shows an indeterminate transfer instead of a wrong percentage`() {
    runner.onState(record(state = DownloadState.DOWNLOADING, bytesDone = 0, totalBytes = null))
    tick()
    runner.onProgress(progress(bytesDone = 12_345, totalBytes = null))

    assertNull(host.summary.percent)
    assertTrue(host.summary.indeterminate)
    assertTrue("shows what has landed: ${host.summary.text}", host.summary.text.contains("12 kB"))
  }

  @Test
  fun `the summary aggregates what is actually live`() {
    runner.onState(record(id = "dl-1", state = DownloadState.DOWNLOADING, bytesDone = 250))
    runner.onState(record(id = "dl-2", state = DownloadState.QUEUED, bytesDone = 0, title = "Second"))

    assertEquals(2, host.summary.activeCount)
    assertEquals("250 of 2000 bytes across both", 12, host.summary.percent)
    assertEquals("Downloading 2 videos", host.summary.title)

    runner.onState(record(id = "dl-2", state = DownloadState.CANCELLED))
    assertEquals(1, host.summary.activeCount)
    assertEquals("the survivor takes the runner notification back", "Beach clip", host.summary.title)
    assertEquals("and stops being shown twice", listOf("dl-1", "dl-2"), notifier.cleared)
  }

  @Test
  fun `a downloading notification shows speed next to downloaded and total`() {
    runner.onState(record(state = DownloadState.DOWNLOADING, totalBytes = 13_000_000))
    tick()
    runner.onProgress(progress(bytesDone = 6_800_000, totalBytes = 13_000_000, speedBps = 1_200_000))

    assertEquals("Downloading · 6.8 MB of 13 MB · 1.2 MB/s", host.summary.text)
    assertEquals(52, host.summary.percent)
  }

  @Test
  fun `a download that stops moving shows no stale speed`() {
    runner.onState(record(state = DownloadState.DOWNLOADING))
    tick()
    runner.onProgress(progress(bytesDone = 400, speedBps = 50_000))
    assertTrue(host.summary.text.endsWith("50 kB/s"))

    runner.onState(record(state = DownloadState.WAITING_NETWORK, bytesDone = 400))
    assertEquals("Waiting for network · 400 B of 1.0 kB", host.summary.text)

    runner.onState(record(state = DownloadState.PAUSED, bytesDone = 400))
    assertFalse(notifier.latest("dl-1")!!.text.contains("/s"))
  }

  @Test
  fun `the aggregate notification shows the combined speed`() {
    runner.onState(record(id = "dl-1", state = DownloadState.DOWNLOADING))
    runner.onState(record(id = "dl-2", state = DownloadState.DOWNLOADING, title = "Second"))
    tick()
    runner.onProgress(progress(id = "dl-1", bytesDone = 300, speedBps = 700_000))
    runner.onProgress(progress(id = "dl-2", bytesDone = 300, speedBps = 500_000))

    assertEquals("Downloading 2 videos", host.summary.title)
    assertTrue("combined speed: ${host.summary.text}", host.summary.text.contains("1.2 MB/s"))
    assertTrue(
      "and each download's own notification has its own speed",
      notifier.latest("dl-2")!!.text.endsWith("500 kB/s"),
    )
  }
}
