package com.vidorax.media.widget

import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.ProgressPhase
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.widget.DownloadsWidgetContent.Status
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** H22 Home Widget (#456): what the widget shows, and how often it is redrawn. */
class DownloadsWidgetTest {
  private fun record(id: String, state: DownloadState, done: Long = 0, total: Long? = null, title: String = id) = DownloadRecord(
    id = id,
    state = state,
    title = title,
    site = SiteId.WEB,
    kind = SourceKind.PROGRESSIVE,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = done,
    totalBytes = total,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    libraryItemId = null,
    createdAt = 0,
    updatedAt = 0,
  )

  // --- content ---

  @Test fun upToThreeActiveDownloadsRunningOnesFirst() {
    val rows = DownloadsWidgetContent.of(
      listOf(
        record("paused", DownloadState.PAUSED),
        record("queued", DownloadState.QUEUED),
        record("done", DownloadState.COMPLETED),
        record("running", DownloadState.DOWNLOADING, 50, 200),
        record("waiting", DownloadState.WAITING_NETWORK),
        record("failed", DownloadState.FAILED),
        record("finishing", DownloadState.PROCESSING, 200, 200),
      ),
    )
    assertEquals(listOf("running", "finishing", "waiting"), rows.map { it.id })
    assertEquals(DownloadsWidgetContent.MAX_ROWS, rows.size)
  }

  @Test fun finishedDownloadsAreNeverShownAndNothingActiveIsTheEmptyState() {
    val rows = DownloadsWidgetContent.of(
      listOf(record("a", DownloadState.COMPLETED), record("b", DownloadState.FAILED), record("c", DownloadState.CANCELLED)),
    )
    assertTrue(rows.isEmpty())
    assertTrue(DownloadsWidgetContent.of(emptyList()).isEmpty())
  }

  @Test fun eachStateHasItsStatus() {
    assertEquals(Status.QUEUED, DownloadsWidgetContent.statusOf(DownloadState.QUEUED))
    assertEquals(Status.QUEUED, DownloadsWidgetContent.statusOf(DownloadState.PROBING))
    assertEquals(Status.DOWNLOADING, DownloadsWidgetContent.statusOf(DownloadState.DOWNLOADING))
    assertEquals(Status.PROCESSING, DownloadsWidgetContent.statusOf(DownloadState.PROCESSING))
    assertEquals(Status.WAITING_NETWORK, DownloadsWidgetContent.statusOf(DownloadState.WAITING_NETWORK))
    assertEquals(Status.WAITING_RETRY, DownloadsWidgetContent.statusOf(DownloadState.WAITING_RETRY))
    assertEquals(Status.PAUSED, DownloadsWidgetContent.statusOf(DownloadState.PAUSED))
    for (state in listOf(DownloadState.COMPLETED, DownloadState.FAILED, DownloadState.CANCELLED)) {
      assertNull("$state", DownloadsWidgetContent.statusOf(state))
    }
  }

  @Test fun thePercentageIsWholeAndOnlyForAKnownSize() {
    assertEquals(25, DownloadsWidgetContent.percentOf(50, 200))
    assertEquals(0, DownloadsWidgetContent.percentOf(0, 200))
    assertEquals(100, DownloadsWidgetContent.percentOf(300, 200))
    assertEquals(33, DownloadsWidgetContent.percentOf(1, 3))
    assertNull(DownloadsWidgetContent.percentOf(50, null))
    assertNull(DownloadsWidgetContent.percentOf(50, 0))
  }

  @Test fun aBlankTitleIsLeftForTheUntitledLabel() {
    val row = DownloadsWidgetContent.of(listOf(record("a", DownloadState.DOWNLOADING, title = "   "))).single()
    assertNull(row.title)
    assertEquals("Clip", DownloadsWidgetContent.of(listOf(record("b", DownloadState.PAUSED, title = " Clip "))).single().title)
  }

  // --- throttling ---

  private class Clock {
    var now = 0L
  }

  @Test fun theFirstChangeDrawsAtOnceAndABurstIsFoldedIntoOneMoreAtTheIntervalsEnd() = runBlocking {
    val clock = Clock()
    val renders = mutableListOf<Long>()
    val updates = WidgetUpdates(this, render = { renders += clock.now }, now = { clock.now }, sleep = { clock.now += it; yield() })

    updates.onStateChange()
    yield()
    assertEquals(listOf(0L), renders)

    repeat(10) {
      clock.now += 50
      updates.onStateChange()
    }
    repeat(10) { yield() }
    assertEquals("ten changes, one more redraw", 2, renders.size)
    assertTrue("at most one redraw every 2 s: $renders", renders[1] - renders[0] >= WidgetUpdates.MIN_INTERVAL_MS)
  }

  @Test fun neverMoreThanOneRedrawEveryTwoSeconds() = runBlocking {
    val clock = Clock()
    val renders = mutableListOf<Long>()
    val updates = WidgetUpdates(this, render = { renders += clock.now }, now = { clock.now }, sleep = { clock.now += it; yield() })
    repeat(200) {
      clock.now += 37
      updates.onStateChange()
      yield()
    }
    repeat(5) { yield() }
    assertTrue(renders.size >= 2)
    assertTrue("$renders", renders.zipWithNext().all { (a, b) -> b - a >= WidgetUpdates.MIN_INTERVAL_MS })
  }

  @Test fun aChangeAfterAQuietMomentDrawsAtOnce() = runBlocking {
    val clock = Clock()
    val renders = mutableListOf<Long>()
    val updates = WidgetUpdates(this, render = { renders += clock.now }, now = { clock.now }, sleep = { clock.now += it; yield() })
    updates.onStateChange()
    yield()
    clock.now = 10_000
    updates.onStateChange()
    yield()
    assertEquals(listOf(0L, 10_000L), renders)
  }

  @Test fun aChangeWhileTheWidgetIsBeingDrawnIsNotLost() = runBlocking {
    val clock = Clock()
    val renders = mutableListOf<Long>()
    val gate = CompletableDeferred<Unit>()
    lateinit var updates: WidgetUpdates
    updates = WidgetUpdates(
      this,
      render = {
        renders += clock.now
        if (renders.size == 1) gate.await()
      },
      now = { clock.now },
      sleep = { clock.now += it; yield() },
    )
    updates.onStateChange()
    yield()
    updates.onStateChange() // while the first drawing still runs
    gate.complete(Unit)
    repeat(5) { yield() }
    assertEquals(listOf(0L, 2_000L), renders)
  }

  @Test fun progressTicksNeverRedrawOnlyStateChangesDo() = runBlocking {
    val clock = Clock()
    var renders = 0
    val states = MutableSharedFlow<DownloadRecord>(extraBufferCapacity = 64)
    val progress = MutableSharedFlow<DownloadProgress>(extraBufferCapacity = 64)
    val updates = WidgetUpdates(this, render = { renders += 1 }, now = { clock.now }, sleep = { clock.now += it; yield() })
    val job = DownloadsWidget.follow(states, updates, this)
    yield()

    repeat(100) { progress.emit(DownloadProgress("a", ProgressPhase.DOWNLOAD, it.toLong(), 100, null, 0, null)) }
    repeat(5) { yield() }
    assertEquals("the widget does not even listen to progress", 0, renders)

    states.emit(record("a", DownloadState.PAUSED))
    repeat(5) { yield() }
    assertEquals(1, renders)
    job.cancel()
  }
}
