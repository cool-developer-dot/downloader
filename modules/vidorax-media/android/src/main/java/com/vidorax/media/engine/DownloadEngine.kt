package com.vidorax.media.engine

import com.vidorax.media.InvalidStateException
import com.vidorax.media.NotFoundException
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.MediaTypes
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.ProgressPhase
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.plan.HlsPlan
import com.vidorax.media.plan.HlsPlanResult
import com.vidorax.media.transfer.HlsCheckpoint
import com.vidorax.media.transfer.HlsTransferSpec
import com.vidorax.media.plan.DashResolution
import com.vidorax.media.transfer.TransferSpec
import com.vidorax.media.verify.VerifyExpectation
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The download engine. It owns the queue and the `downloads` table and drives each download through:
 * classify → persist → transfer to `.part` → verify → finalize → COMPLETED → library. It never touches media bytes
 * itself — [Prober], [Transfers], [HlsDownloads], [Verification], [MediaInspector] and [LibraryWriter] do — so this
 * class is only orchestration, state persistence and race safety.
 *
 * Two transfers share every step after them: a progressive file streamed to the `.part` (also used for a DASH
 * manifest whose chosen representation is one complete file), and an unencrypted VOD HLS stream whose segments are
 * appended to the `.part` in order with a checkpoint. Protected, live, segmented or separate-audio DASH and other
 * unsupported sources are refused at classification with their own codes.
 *
 * Race safety rests on a per-id generation counter: pause/cancel/resume/retry bump it under [mutex], which
 * invalidates every later write from the worker that held the old generation. Terminal states (COMPLETED/
 * FAILED/CANCELLED) can never be overwritten, and completion (library insert + COMPLETED) happens atomically
 * under the lock, so a cancel that loses the race cannot leave an orphan library item.
 *
 * Failures are classified, not lumped together: a dropped connection, a 5xx/408/429 or a truncated read is waited
 * out with bounded backoff (the budget refills whenever bytes advance); an expired signed link is re-resolved
 * once; everything else fails with the code that says why.
 */
internal class DownloadEngine(
  private val store: DownloadStore,
  private val prober: Prober,
  private val transfers: Transfers,
  private val verification: Verification,
  private val inspector: MediaInspector,
  private val thumbnails: ThumbnailMaker = ThumbnailMaker { _, _, _ -> null },
  private val library: LibraryWriter,
  private val paths: StoragePaths,
  private val scope: CoroutineScope,
  private val network: NetworkGate = NetworkGate.ALWAYS_USABLE,
  private val freeSpace: FreeSpace = FreeSpace { Long.MAX_VALUE },
  initialSettings: DownloadSettings = DownloadSettings.DEFAULT,
  /** Persists the settings, so a download that resumes before JavaScript runs still obeys them. */
  private val onSettingsChanged: (DownloadSettings) -> Unit = {},
  private val hls: HlsDownloads = HlsDownloads.UNSUPPORTED,
  private val dash: DashDownloads = DashDownloads.UNSUPPORTED,
  /** Backoff sleeps; injectable so tests do not wait in real time. */
  private val retryDelay: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
  private val now: () -> Long = System::currentTimeMillis,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
) : DownloadEngineApi {
  private val progressFlow = sharedFlow<DownloadProgress>()
  private val stateFlow = sharedFlow<DownloadRecord>()
  override val progress = progressFlow
  override val stateChanges = stateFlow

  @Volatile private var settings: DownloadSettings = initialSettings

  private val slots = Slots(initialSettings.maxConcurrent)

  /** Serializes all state/generation reads and writes. */
  private val mutex = Mutex()

  /** Bumped whenever a worker starts or a user action supersedes one; stale generations' writes are dropped. */
  private val generations = HashMap<String, Long>()

  private val activeJobs = ConcurrentHashMap<String, Job>()

  /** Guards startup reconciliation so it can never run twice and spawn duplicate workers. */
  private val restoreStarted = AtomicBoolean(false)

  // --- startup reconciliation ---

  /**
   * Reconciles persisted downloads with reality after a process/app restart, when no worker survives. Idempotent:
   * the first call claims the guard; later calls are no-ops. The physical `.part`/final file — never a stale DB
   * byte counter — is the source of truth (for HLS, the checkpoint that describes the `.part`). Never spawns a
   * second worker for an already-active id.
   *
   * Rules: PAUSED stays paused (bytes reconciled to what is on disk); QUEUED/PROBING re-run from a fresh probe;
   * DOWNLOADING resumes from the `.part` (HLS: from its checkpointed segment); PROCESSING is repaired from its
   * finalized file when one exists and verifies (idempotent, no redownload), otherwise re-run from the `.part`;
   * COMPLETED/FAILED/CANCELLED are left untouched.
   */
  internal suspend fun restore() {
    if (!restoreStarted.compareAndSet(false, true)) return
    for (row in store.list(now())) {
      if (activeJobs.containsKey(row.id)) continue
      when (row.state) {
        DownloadState.PAUSED -> reconcilePausedBytes(row)
        DownloadState.QUEUED,
        DownloadState.PROBING,
        DownloadState.WAITING_NETWORK,
        DownloadState.WAITING_RETRY,
        -> requeueFromPart(row, keepBytes = false)
        DownloadState.DOWNLOADING -> requeueFromPart(row, keepBytes = true)
        DownloadState.PROCESSING -> recoverProcessing(row)
        DownloadState.COMPLETED, DownloadState.FAILED, DownloadState.CANCELLED -> Unit
      }
    }
  }

  private fun partFileFor(id: String): File = File(paths.workDir(id), PART_NAME)

  private fun checkpointFileFor(id: String): File = File(paths.workDir(id), HLS_CHECKPOINT_NAME)

  private fun physicalPartBytes(id: String): Long = partFileFor(id).let { if (it.isFile) it.length() else 0L }

  /** Bytes a resume really continues from: the `.part` for a progressive file, the checkpoint for HLS. */
  private fun resumableBytes(row: DownloadRow): Long =
    if (row.kind == SourceKind.HLS) HlsCheckpoint.read(checkpointFileFor(row.id))?.partBytes ?: 0L
    else physicalPartBytes(row.id)

  /** Paused work stays paused; only its byte counter is corrected to what is on disk so a later resume is truthful. */
  private suspend fun reconcilePausedBytes(row: DownloadRow) {
    val physical = resumableBytes(row)
    if (physical == row.bytesDone) return
    mutex.withLock {
      val current = store.find(row.id) ?: return
      if (current.state != DownloadState.PAUSED) return
      store.save(current.copy(bytesDone = physical, updatedAt = now()))
    }
  }

  /** Re-queues a download and starts a fresh worker; the transfer resumes from the `.part` on its own. */
  private suspend fun requeueFromPart(row: DownloadRow, keepBytes: Boolean) {
    val requeued = mutex.withLock {
      val current = store.find(row.id) ?: return
      // Physical file truth wins over any stale DB byte count.
      val bytes = if (keepBytes) resumableBytes(row) else 0L
      save(current.copy(state = DownloadState.QUEUED, bytesDone = bytes, errorCode = null, errorMessage = null, updatedAt = now()))
    }
    stateFlow.tryEmit(requeued.toRecord())
    launchWorker(row.id)
  }

  private suspend fun recoverProcessing(row: DownloadRow) {
    val dest = row.filePath?.let { paths.fromStoredPath(it) }
    if (dest != null && dest.isFile && dest.length() > 0 && repairCompletedFromFile(row, dest)) return
    // No usable final file (or it failed re-verification): resume/re-run from the `.part`.
    dest?.takeIf { it.isFile }?.delete()
    val requeued = mutex.withLock {
      val current = store.find(row.id) ?: return
      save(current.copy(state = DownloadState.QUEUED, bytesDone = resumableBytes(row), filePath = null, updatedAt = now()))
    }
    stateFlow.tryEmit(requeued.toRecord())
    launchWorker(row.id)
  }

  /** Repairs a download whose file was finalized before the crash: re-verify the real file, then complete once. */
  private suspend fun repairCompletedFromFile(row: DownloadRow, dest: File): Boolean {
    val container = MediaTypes.forFileName(dest.name)?.container ?: Container.UNKNOWN
    // Structural re-verification only: the file already passed full verification before it was moved, and the move
    // is atomic (no partial file), so length is not re-asserted here. An assembled HLS transport stream is only a
    // valid file when it is expected to be one.
    val expectation = VerifyExpectation(container = container.takeIf { it == Container.TS }, expectedBytes = null)
    if (verification.verify(dest, expectation) is VerifyResult.Invalid) {
      return false
    }
    val metadata = runCatching { inspector.inspect(dest) }.getOrNull()
    // Same library item a normal completion writes, thumbnail included; a missing thumbnail is only cosmetic.
    val thumbnail = metadata?.let { runCatching { thumbnails.create(row.id, dest, it) }.getOrNull() }
    val item = buildLibraryItem(row, container, null, dest, metadata, thumbnail)
    val completed = mutex.withLock {
      val current = store.find(row.id) ?: return@withLock null
      if (current.state.isTerminal) return@withLock null // already resolved by a concurrent path
      library.insertCompleted(item) // idempotent: a pre-existing library row makes this a no-op
      saveCompleted(current.copy(state = DownloadState.COMPLETED, bytesDone = dest.length(), totalBytes = dest.length(), errorCode = null, errorMessage = null, updatedAt = now()))
    }
    completed?.let { stateFlow.tryEmit(it.toRecord()); cleanupWork(row.id) }
    return true
  }

  // --- probing ---

  override suspend fun probe(request: ProbeRequest): ProbeResult {
    // A stream verdict is about one variant: classify the one enqueue would pick with the same choice and settings.
    val classified = if (request.kind.isStream()) request.copy(variant = streamChoice(request.variant)) else request
    val first = prober.probe(classified)
    if (!needsSession(first, classified.request)) return first
    return prober.probe(classified.copy(request = classified.request.copy(useCookies = true)))
  }

  /**
   * A source refused a request made without the browsing session. The page played it inside that session, so the
   * WebView's cookies for this URL are what it needs — the same thing a browser sends. Only tried after a refusal,
   * so a public source still never reads the cookie jar.
   */
  private fun needsSession(result: ProbeResult, context: RequestContext): Boolean =
    result is ProbeResult.Failure && result.reason == ProbeFailure.HTTP_403 && !context.useCookies

  /** The request context this download uses now (the stored one: a session adopted mid-way sticks). */
  private suspend fun currentRequest(id: String, fallback: DownloadRow): RequestContext =
    store.find(id)?.request ?: fallback.request

  /** Records that this download needs the browsing session from now on — the flag only, never a cookie value. */
  private suspend fun adoptSession(id: String, gen: Long): RequestContext? = mutex.withLock {
    val row = store.find(id) ?: return null
    if (generations[id] != gen || row.state.isTerminal) return null
    if (row.request.useCookies) return row.request
    val upgraded = row.request.copy(useCookies = true)
    save(row.copy(request = upgraded, updatedAt = now()))
    upgraded
  }

  // --- enqueue / lifecycle ---

  override suspend fun enqueue(request: EnqueueRequest): DownloadRecord {
    val id = idFactory()
    val ts = now()
    val row = DownloadRow(
      id = id,
      state = DownloadState.QUEUED,
      kind = request.kind,
      url = request.url,
      request = request.request.sanitized(),
      title = request.title,
      site = request.site,
      pageUrl = request.pageUrl,
      thumbnailUrl = request.thumbnailUrl,
      qualityLabel = request.qualityLabel,
      bytesDone = 0,
      totalBytes = request.estimatedBytes,
      errorCode = null,
      errorMessage = null,
      attempts = 0,
      saveToGallery = request.saveToGallery,
      createdAt = ts,
      updatedAt = ts,
      variant = if (request.kind.isStream()) streamChoice(request.variant) else null,
    )
    store.create(row)
    stateFlow.tryEmit(row.toRecord())
    launchWorker(id)
    return row.toRecord()
  }

  private fun SourceKind?.isStream(): Boolean = this == SourceKind.HLS || this == SourceKind.DASH

  /**
   * The variant an HLS or DASH download keeps for its whole life: the one the user picked, else the
   * preferred-quality setting as it was when they tapped, so a restart can never quietly change the quality.
   */
  private fun streamChoice(requested: VariantChoice?): VariantChoice? {
    val maxHeight = requested?.maxHeight ?: settings.preferredMaxHeight
    if (requested?.videoId == null && maxHeight == null) return null
    return VariantChoice(videoId = requested?.videoId, audioId = null, maxHeight = maxHeight)
  }

  override suspend fun pause(id: String) {
    val paused = mutex.withLock {
      val row = store.find(id) ?: throw NotFoundException("Unknown download $id")
      // A second Pause tap on an already paused download is the state the user asked for, not an error.
      if (row.state == DownloadState.PAUSED) return@withLock null
      if (row.state !in PAUSABLE) throw InvalidStateException("Cannot pause a ${row.state.wire} download")
      bumpGenerationLocked(id) // invalidate the running worker's future writes
      save(row.copy(state = DownloadState.PAUSED, updatedAt = now()))
    }
    // Returns only once the transfer has really stopped: no bytes land after the caller sees PAUSED, and a
    // resume that follows cannot start a second writer on the same `.part`.
    stopWorker(id) // transfer sees CancellationException and preserves the .part
    paused?.let { stateFlow.tryEmit(it.toRecord()) }
  }

  override suspend fun resume(id: String) =
    restart(id, allowed = setOf(DownloadState.PAUSED), bumpAttempts = false, alreadyRunning = RUNNING)

  override suspend fun retry(id: String) =
    restart(id, allowed = setOf(DownloadState.FAILED), bumpAttempts = true, alreadyRunning = RUNNING)

  private suspend fun restart(
    id: String,
    allowed: Set<DownloadState>,
    bumpAttempts: Boolean,
    alreadyRunning: Set<DownloadState> = emptySet(),
  ) {
    val requeued = mutex.withLock {
      val row = store.find(id) ?: throw NotFoundException("Unknown download $id")
      // A repeated Resume/Retry tap while the work is already running again changes nothing.
      if (row.state in alreadyRunning) return
      if (row.state !in allowed) throw InvalidStateException("Cannot resume/retry a ${row.state.wire} download")
      save(
        row.copy(
          state = DownloadState.QUEUED,
          errorCode = null,
          errorMessage = null,
          attempts = if (bumpAttempts) row.attempts + 1 else row.attempts,
          updatedAt = now(),
        ),
      )
    }
    stateFlow.tryEmit(requeued.toRecord())
    launchWorker(id)
  }

  override suspend fun cancel(id: String) {
    val cancelled = mutex.withLock {
      val row = store.find(id) ?: throw NotFoundException("Unknown download $id")
      if (row.state.isTerminal) throw InvalidStateException("Cannot cancel a ${row.state.wire} download")
      bumpGenerationLocked(id)
      save(row.copy(state = DownloadState.CANCELLED, errorCode = null, errorMessage = null, updatedAt = now()))
    }
    // Wait for the worker to stop before deleting its work directory, so nothing recreates the `.part` after it.
    stopWorker(id)
    cleanupWork(id)
    stateFlow.tryEmit(cancelled.toRecord())
  }

  override suspend fun removeDownload(id: String) {
    mutex.withLock {
      val row = store.find(id) ?: throw NotFoundException("Unknown download $id")
      if (!row.state.isTerminal) throw InvalidStateException("Cannot remove an active download")
      bumpGenerationLocked(id)
      store.delete(id)
    }
    cleanupWork(id)
  }

  override suspend fun pauseAll() {
    for (row in store.list(now())) {
      if (row.state in PAUSABLE) runCatching { pause(row.id) }
    }
  }

  override suspend fun resumeAll() {
    for (row in store.list(now())) {
      if (row.state == DownloadState.PAUSED) runCatching { resume(row.id) }
    }
  }

  override suspend fun listDownloads(): List<DownloadRecord> = store.list(now()).map { it.toRecord() }

  override suspend fun setDownloadSettings(settings: DownloadSettings) {
    this.settings = settings
    slots.setLimit(settings.maxConcurrent)
    runCatching { onSettingsChanged(settings) }
  }

  override suspend fun listCompletions(): List<CompletionRecord> = store.listCompletions()

  override suspend fun acknowledgeCompletions(ids: List<String>) = store.acknowledgeCompletions(ids)

  override suspend fun clearTempFiles(): Long {
    val keep = store.list(now()).filterNot { it.state.isTerminal }
      .map { paths.workDir(it.id).name }
      .toSet()
    var freed = 0L
    paths.workRoot.listFiles()?.forEach { dir ->
      if (dir.isDirectory && dir.name !in keep) {
        freed += dir.walkBottomUp().filter { it.isFile }.sumOf { it.length() }
        dir.deleteRecursively()
      }
    }
    return freed
  }

  // --- worker ---

  private suspend fun launchWorker(id: String) {
    // One worker per download, always: a resume right after a pause must not write the same `.part` twice.
    stopWorker(id)
    val gen = mutex.withLock { bumpGenerationLocked(id) }
    lateinit var job: Job
    job = scope.launch(start = CoroutineStart.LAZY) {
      try {
        runWorker(id, gen)
      } catch (c: kotlinx.coroutines.CancellationException) {
        throw c // pause()/cancel() already set the terminal/paused state
      } catch (e: Throwable) {
        fail(id, gen, mapThrowable(e))
      } finally {
        activeJobs.remove(id, job)
      }
    }
    activeJobs[id] = job
    job.start()
  }

  /**
   * Cancels the worker that owns [id] and waits for it to finish. A transfer notices cancellation at its next
   * read, so the wait is short; a worker that refuses to stop within [WORKER_STOP_TIMEOUT_MS] is left to the
   * generation guard (its writes are already invalidated) instead of blocking the user's action forever.
   */
  private suspend fun stopWorker(id: String) {
    val job = activeJobs.remove(id) ?: return
    job.cancel()
    withTimeoutOrNull(WORKER_STOP_TIMEOUT_MS) { job.join() }
  }

  private suspend fun runWorker(id: String, gen: Long) {
    val start = store.find(id) ?: return
    if (!awaitNetwork(id, gen)) return
    // Beyond the configured limit the download simply stays QUEUED until a slot frees.
    slots.acquire()
    try {
      runTransfer(id, gen, start)
    } finally {
      slots.release()
    }
  }

  private suspend fun runTransfer(id: String, gen: Long, start: DownloadRow) {
    if (setState(id, gen, DownloadState.PROBING) == null) return
    when (start.kind) {
      SourceKind.HLS -> return runHls(id, gen, start)
      SourceKind.DASH -> return runDash(id, gen, start)
      else -> Unit
    }
    val probe = probeOrFail(id, gen, start) ?: return
    // Enqueued as a file, but the bytes are a playlist or a manifest (an extensionless URL): download the stream.
    when (probe.kind) {
      SourceKind.HLS -> runHls(id, gen, start)
      SourceKind.DASH -> runDash(id, gen, start)
      else -> runProgressive(id, gen, start, probe)
    }
  }

  // --- progressive ---

  /**
   * [reprobe] re-resolves the source after its link expired mid-transfer: the file URL itself, or for DASH the
   * manifest's same representation (a signed BaseURL can only be renewed through the manifest).
   */
  private suspend fun runProgressive(
    id: String,
    gen: Long,
    start: DownloadRow,
    firstProbe: ProbeResult.Success,
    reprobe: suspend () -> ProbeResult.Success? = { probeOrFail(id, gen, start, expired = true) },
  ) {
    var probe = firstProbe
    if (setState(id, gen, DownloadState.DOWNLOADING) { it.copy(totalBytes = probe.sizeBytes ?: it.totalBytes) } == null) {
      return
    }

    val workDir = paths.workDir(id).apply { mkdirs() }
    val partFile = File(workDir, PART_NAME)
    if (!hasRoomFor(id, gen, probe.sizeBytes, partFile)) return

    val outcome = transferWithRecovery(
      id = id,
      gen = gen,
      progressBytes = { physicalPartBytes(id) },
      refresh = { status ->
        // A signed URL that expired mid-transfer: one fresh probe of the same source, then continue from the
        // bytes already on disk. Never a new download, never a different source. A refusal of a request made
        // without the browsing session first adopts the session, which is all such a source was missing.
        if (status in SESSION_STATUS && adoptSession(id, gen) == null) return@transferWithRecovery false
        val again = setState(id, gen, DownloadState.PROBING)?.let { reprobe() }
        when {
          again == null -> false
          again.kind != SourceKind.PROGRESSIVE -> {
            fail(id, gen, DownloadErrorCode.UNSUPPORTED_FORMAT, "The source changed format")
            false
          }
          else -> {
            probe = again
            setState(id, gen, DownloadState.DOWNLOADING) != null
          }
        }
      },
    ) {
      // The transfer resumes against the validator it recorded beside the `.part`, so If-Range also holds after a
      // process death, a reboot or a renewed (re-signed) link.
      val spec = TransferSpec(url = probe.finalUrl, context = currentRequest(id, start), partFile = partFile)
      streamWithProgress(id, gen) { onProgress -> transfers.transfer(spec, onProgress) }
    } ?: return

    persistProgress(id, gen, outcome.bytesWritten, outcome.totalBytes)

    // VERIFYING/finalization phase (existing "processing" state).
    if (setState(id, gen, DownloadState.PROCESSING) == null) {
      // Superseded by pause/cancel at the boundary: leave temp for cancel() to clean up.
      return
    }

    val expectation = VerifyExpectation(container = probe.container, expectedBytes = probe.sizeBytes ?: outcome.totalBytes)
    if (!verifiedOrFail(id, gen, partFile, expectation)) return
    if (failedAsAudioOnly(id, gen, partFile, "This file has no video")) return
    finalizeAndComplete(id, gen, start, partFile, probe.container, probe.contentType)
  }

  // --- DASH ---

  /**
   * manifest → the exact representation (a single complete file) → classified like any progressive file → the same
   * transfer, verify and finalize as a progressive download. The row keeps the manifest URL and the representation
   * choice, so a restart or an expired link is resolved again from the manifest, never from a stale file URL.
   */
  private suspend fun runDash(id: String, gen: Long, start: DownloadRow) {
    val media = dashOrFail(id, gen, start) ?: return
    runProgressive(id, gen, start, media, reprobe = { dashOrFail(id, gen, start, expired = true) })
  }

  /** The DASH counterpart of [probeOrFail]: the persisted representation choice resolved to its classified file. */
  private suspend fun dashOrFail(id: String, gen: Long, row: DownloadRow, expired: Boolean = false): ProbeResult.Success? {
    var attempt = 0
    while (true) {
      val context = currentRequest(id, row)
      var result = dash.resolve(row.url, context, row.variant)
      if (result is DashResolution.Refused && needsSession(result.failure, context)) {
        result = dash.resolve(row.url, context.copy(useCookies = true), row.variant)
        if (result is DashResolution.Ready && adoptSession(id, gen) == null) return null
      }
      when (result) {
        is DashResolution.Ready -> return result.media
        is DashResolution.Refused -> {
          if (isTransient(result.failure) && attempt < CLASSIFY_RETRY_DELAYS_MS.size) {
            if (!waitBeforeRetry(id, gen, CLASSIFY_RETRY_DELAYS_MS[attempt++], DownloadState.PROBING)) return null
            continue
          }
          failClassification(id, gen, result.failure, expired)
          return null
        }
      }
    }
  }

  // --- HLS ---

  /**
   * master/media playlist → exact variant → classified media playlist → segments appended in order with a
   * checkpoint → the assembled file verified as the container its bytes prove → library. Never COMPLETED before
   * the finished file is a valid, single, playable stream.
   */
  private suspend fun runHls(id: String, gen: Long, start: DownloadRow) {
    var plan = planOrFail(id, gen, start) ?: return
    if (setState(id, gen, DownloadState.DOWNLOADING) { it.copy(totalBytes = plan.estimatedBytes ?: it.totalBytes) } == null) {
      return
    }
    val workDir = paths.workDir(id).apply { mkdirs() }
    val partFile = File(workDir, PART_NAME)
    val checkpoint = File(workDir, HLS_CHECKPOINT_NAME)
    if (!hasRoomFor(id, gen, plan.estimatedBytes, partFile)) return

    val outcome = transferWithRecovery(
      id = id,
      gen = gen,
      progressBytes = { HlsCheckpoint.read(checkpoint)?.partBytes ?: 0L },
      refresh = { status ->
        // Segment links expired: re-read the playlist (fresh tokens) and continue from the checkpoint. A playlist
        // that no longer describes the same stream restarts from zero instead of splicing another one in. A
        // segment refused without the browsing session first adopts the session.
        if (status in SESSION_STATUS && adoptSession(id, gen) == null) return@transferWithRecovery false
        val again = setState(id, gen, DownloadState.PROBING)?.let { planOrFail(id, gen, start, expired = true) }
        if (again == null) {
          false
        } else {
          plan = again
          setState(id, gen, DownloadState.DOWNLOADING) != null
        }
      },
    ) {
      val context = currentRequest(id, start)
      streamWithProgress(id, gen) { onProgress ->
        hls.transfer(HlsTransferSpec(plan, context, partFile, checkpoint), onProgress)
      }
    } ?: return

    persistProgress(id, gen, outcome.bytesWritten, outcome.bytesWritten)
    if (setState(id, gen, DownloadState.PROCESSING) == null) return

    val expectation = VerifyExpectation(container = outcome.container, expectedBytes = outcome.bytesWritten)
    if (!verifiedOrFail(id, gen, partFile, expectation)) return
    if (failedAsAudioOnly(id, gen, partFile, "This stream has no video")) return
    finalizeAndComplete(id, gen, start, partFile, outcome.container, contentType = null)
  }

  // --- classification with transient retry ---

  /**
   * Classifies a progressive source. Transient answers (no connection, 5xx, 408, 429) are waited out with bounded
   * backoff before anything is called failed; a 403 without the browsing session is retried once with it (and the
   * download keeps it), otherwise a 403 is reported as it is (only the live page can mint a new link); protected
   * and unsupported sources fail at once with their own codes.
   */
  private suspend fun probeOrFail(
    id: String,
    gen: Long,
    row: DownloadRow,
    expired: Boolean = false,
  ): ProbeResult.Success? {
    var attempt = 0
    while (true) {
      val context = currentRequest(id, row)
      var result = prober.probe(ProbeRequest(url = row.url, kind = null, manifestText = null, request = context))
      if (needsSession(result, context)) {
        val withSession = context.copy(useCookies = true)
        result = prober.probe(ProbeRequest(url = row.url, kind = null, manifestText = null, request = withSession))
        if (result is ProbeResult.Success && adoptSession(id, gen) == null) return null
      }
      when (result) {
        is ProbeResult.Success -> return result
        is ProbeResult.Failure -> {
          if (isTransient(result) && attempt < CLASSIFY_RETRY_DELAYS_MS.size) {
            if (!waitBeforeRetry(id, gen, CLASSIFY_RETRY_DELAYS_MS[attempt++], DownloadState.PROBING)) return null
            continue
          }
          failClassification(id, gen, result, expired)
          return null
        }
      }
    }
  }

  /** The HLS counterpart of [probeOrFail]: resolves the persisted variant choice to one classified media playlist. */
  private suspend fun planOrFail(id: String, gen: Long, row: DownloadRow, expired: Boolean = false): HlsPlan? {
    var attempt = 0
    while (true) {
      val context = currentRequest(id, row)
      var result = hls.plan(row.url, context, row.variant)
      if (result is HlsPlanResult.Refused && needsSession(result.failure, context)) {
        result = hls.plan(row.url, context.copy(useCookies = true), row.variant)
        if (result is HlsPlanResult.Ready && adoptSession(id, gen) == null) return null
      }
      when (result) {
        is HlsPlanResult.Ready -> return result.plan
        is HlsPlanResult.Refused -> {
          if (isTransient(result.failure) && attempt < CLASSIFY_RETRY_DELAYS_MS.size) {
            if (!waitBeforeRetry(id, gen, CLASSIFY_RETRY_DELAYS_MS[attempt++], DownloadState.PROBING)) return null
            continue
          }
          failClassification(id, gen, result.failure, expired)
          return null
        }
      }
    }
  }

  private suspend fun failClassification(id: String, gen: Long, failure: ProbeResult.Failure, expired: Boolean) {
    val code = if (expired && failure.reason in EXPIRY_FAILURES) DownloadErrorCode.SOURCE_EXPIRED else mapProbeFailure(failure.reason)
    val message = if (code == DownloadErrorCode.SOURCE_EXPIRED) EXPIRED_MESSAGE else failure.message
    fail(id, gen, code, message)
  }

  private fun isTransient(failure: ProbeResult.Failure): Boolean = when (failure.reason) {
    ProbeFailure.NETWORK -> true
    ProbeFailure.HTTP_ERROR -> failure.httpStatus.let { it == null || it >= 500 || it == 408 || it == 429 }
    else -> false
  }

  /**
   * Shows the wait as WAITING_RETRY, sleeps [delayMs], waits for a usable network, and moves back to [resumeAs].
   * False when the user superseded the download meanwhile.
   */
  private suspend fun waitBeforeRetry(id: String, gen: Long, delayMs: Long, resumeAs: DownloadState): Boolean {
    if (setState(id, gen, DownloadState.WAITING_RETRY) == null) return false
    retryDelay(delayMs)
    if (!awaitNetwork(id, gen, force = true)) return false
    return setState(id, gen, resumeAs) != null
  }

  /**
   * Runs [attempt] until it completes or fails for a reason that waiting cannot fix. Shared by both source kinds:
   * - a dropped connection, a truncated read or a 5xx/408/429 is retried with capped backoff; the budget of
   *   [MAX_NETWORK_ATTEMPTS] refills whenever [progressBytes] advanced, so a long flaky download is not killed by
   *   blips it survived, while one that keeps failing at the same byte still ends;
   * - a 403/410 re-resolves the source once through [refresh] and continues from the bytes on disk;
   * - the network becoming one this download may not use (Wi-Fi-only) waits without counting as a failure;
   * - a refusal, a 404 or a storage error fails at once with its own code.
   * Returns null when the download failed or was superseded (the row already says so).
   */
  private suspend fun <T> transferWithRecovery(
    id: String,
    gen: Long,
    progressBytes: () -> Long,
    /** Re-resolves the source after a refused/expired link ([MediaHttpException.statusCode]); false stops. */
    refresh: suspend (status: Int) -> Boolean,
    attempt: suspend () -> T,
  ): T? {
    var failures = 0
    var highWater = progressBytes()
    var refreshed = false
    while (true) {
      val transientCode: DownloadErrorCode
      val transientMessage: String
      try {
        return attempt()
      } catch (e: MediaRefusedException) {
        fail(id, gen, mapProbeFailure(e.reason), e.message)
        return null
      } catch (e: MediaHttpException) {
        if (!refreshed && e.statusCode in REFRESHABLE_STATUS) {
          refreshed = true
          if (!refresh(e.statusCode)) return null
          continue
        }
        if (!e.isTransient) {
          fail(id, gen, mapHttpStatus(e.statusCode), "Server returned HTTP ${e.statusCode}")
          return null
        }
        transientCode = DownloadErrorCode.HTTP_ERROR
        transientMessage = "Server returned HTTP ${e.statusCode}"
      } catch (e: NetworkNoLongerAllowed) {
        // Not a failure and not an attempt: the download waits for a connection it may use, then resumes
        // from the bytes already on disk.
        if (!awaitNetwork(id, gen, force = true)) return null
        if (setState(id, gen, DownloadState.DOWNLOADING) == null) return null
        continue
      } catch (e: MediaNetworkException) {
        transientCode = DownloadErrorCode.NETWORK
        transientMessage = "Network error during download" // the `.part` is kept for resume
      } catch (e: IOException) {
        if (isOutOfSpace(e)) {
          fail(id, gen, DownloadErrorCode.NO_SPACE, "Not enough storage left for this video")
        } else {
          fail(id, gen, DownloadErrorCode.STORAGE_ERROR, "Could not write the download")
        }
        return null
      }

      // Transient: the `.part` is intact, so a dropped connection, a Wi-Fi ⇄ mobile switch or an overloaded server
      // is something to wait out rather than a failure the user has to notice and retry by hand.
      val onDisk = progressBytes()
      if (onDisk > highWater) {
        highWater = onDisk
        failures = 0
      }
      failures += 1
      if (failures > MAX_NETWORK_ATTEMPTS) {
        fail(id, gen, transientCode, transientMessage)
        return null
      }
      // A little backoff, so a server that keeps resetting is not hammered between attempts.
      if (!waitBeforeRetry(id, gen, minOf(failures * RETRY_BACKOFF_MS, MAX_RETRY_BACKOFF_MS), DownloadState.DOWNLOADING)) {
        return null
      }
    }
  }

  /** Verifies the assembled `.part`; a protected file fails as protected, anything else invalid as corrupt. */
  private suspend fun verifiedOrFail(id: String, gen: Long, partFile: File, expectation: VerifyExpectation): Boolean {
    val verdict = verification.verify(partFile, expectation)
    if (verdict !is VerifyResult.Invalid) return true
    if (verdict.reason == ProbeFailure.DRM_PROTECTED) {
      fail(id, gen, DownloadErrorCode.DRM_PROTECTED, "This video is protected")
    } else {
      fail(id, gen, DownloadErrorCode.PROCESSING_FAILED, "The downloaded file failed verification")
    }
    cleanupWork(id)
    return false
  }

  /**
   * The verified file decodes with sound and no picture — an audio file, or the audio half of a stream split into
   * separate audio and video: not a video download. The probe already refuses one whose track list is in its first
   * bytes; this catches the rest (a `moov` at the end, WebM, MPEG-TS). True when it failed the download.
   */
  private suspend fun failedAsAudioOnly(id: String, gen: Long, partFile: File, message: String): Boolean {
    val metadata = runCatching { inspector.inspect(partFile) }.getOrNull()
    if (metadata == null || metadata.hasVideo || !metadata.hasAudio) return false
    fail(id, gen, DownloadErrorCode.UNSUPPORTED_FORMAT, message)
    cleanupWork(id)
    return true
  }

  /** Moves the verified `.part` into the library and commits COMPLETED — once, and only for the current worker. */
  private suspend fun finalizeAndComplete(
    id: String,
    gen: Long,
    start: DownloadRow,
    partFile: File,
    container: Container,
    contentType: String?,
  ) {
    val mediaType = MediaTypes.forContainer(container)
    val extension = mediaType?.extension ?: container.wire.takeIf { it != Container.UNKNOWN.wire } ?: "bin"
    val dest = paths.newLibraryFile(start.site, start.title, id, extension)
    // Persist the intended final path *before* the move, so a crash between the move and the COMPLETED commit is
    // recoverable at startup by the real file. Superseded (paused/cancelled) → abort and leave temp for cleanup.
    if (setFilePath(id, gen, paths.toStoredPath(dest)) == null) return
    try {
      transfers.finalizeToFile(partFile, dest)
    } catch (e: IOException) {
      fail(id, gen, DownloadErrorCode.STORAGE_ERROR, "Could not save the finished file")
      return
    }

    val metadata = runCatching { inspector.inspect(dest) }.getOrNull()
    // A missing thumbnail is a cosmetic gap, never a reason to fail a verified download.
    val thumbnail = metadata?.let { runCatching { thumbnails.create(id, dest, it) }.getOrNull() }
    val item = buildLibraryItem(start, container, contentType, dest, metadata, thumbnail)

    // Atomically: only if still the current, non-terminal owner do we insert the library item AND mark COMPLETED.
    val completed = try {
      mutex.withLock {
        val row = store.find(id) ?: return@withLock null
        if (generations[id] != gen || row.state.isTerminal) return@withLock null
        library.insertCompleted(item) // idempotent: a re-run finds the item already there
        saveCompleted(row.copy(state = DownloadState.COMPLETED, bytesDone = dest.length(), totalBytes = dest.length(), errorCode = null, errorMessage = null, updatedAt = now()))
      }
    } catch (c: kotlinx.coroutines.CancellationException) {
      throw c
    } catch (e: Exception) {
      // Library persistence genuinely failed: never claim COMPLETED, and drop the finalized file so it is not orphaned.
      dest.delete()
      cleanupWork(id)
      fail(id, gen, DownloadErrorCode.STORAGE_ERROR, "Could not record the finished file in the library")
      return
    }
    if (completed != null) {
      stateFlow.tryEmit(completed.toRecord())
      cleanupWork(id)
    } else {
      // Lost the race to pause/cancel: no library insert happened, so drop the finalized file we produced.
      dest.delete()
      cleanupWork(id)
    }
  }

  /**
   * Holds the download in WAITING_NETWORK until there is a network it is allowed to use. Returns false when the
   * user superseded it meanwhile (paused, cancelled), so the caller stops without touching the row.
   */
  private suspend fun awaitNetwork(id: String, gen: Long, force: Boolean = false): Boolean {
    val wifiOnly = settings.wifiOnly
    if (!force && network.isUsable(wifiOnly)) return true
    if (network.isUsable(wifiOnly)) return true
    if (setState(id, gen, DownloadState.WAITING_NETWORK) == null) return false
    network.awaitUsable(wifiOnly)
    return store.find(id)?.let { generations[id] == gen && !it.state.isTerminal } ?: false
  }

  /** Refuses before the first byte when the volume cannot hold the file, instead of failing near the end. */
  private suspend fun hasRoomFor(id: String, gen: Long, sizeBytes: Long?, partFile: File): Boolean {
    val needed = sizeBytes ?: return true
    val onDisk = if (partFile.isFile) partFile.length() else 0L
    val free = runCatching { freeSpace.bytes() }.getOrDefault(Long.MAX_VALUE)
    if (free >= needed - onDisk + FREE_SPACE_MARGIN_BYTES) return true
    fail(id, gen, DownloadErrorCode.NO_SPACE, "Not enough storage left for this video")
    return false
  }

  private fun isOutOfSpace(e: IOException): Boolean {
    val message = generateSequence<Throwable>(e) { it.cause }.mapNotNull { it.message }.joinToString(" ")
    return message.contains("ENOSPC", ignoreCase = true) || message.contains("No space left", ignoreCase = true)
  }

  /** Raised when the network stopped being one this download is allowed to use, mid-transfer. */
  private class NetworkNoLongerAllowed : Exception()

  /**
   * How many downloads may actually run at once. Extra taps stay QUEUED — which is what the word means — so a
   * user who starts ten videos gets a working queue instead of ten transfers fighting for the same connection,
   * the same disk and the same CPU.
   */
  private class Slots(limit: Int) {
    private val lock = Mutex()
    private val waiting = ArrayDeque<kotlinx.coroutines.CompletableDeferred<Unit>>()
    private var limit = limit.coerceAtLeast(1)
    private var used = 0

    suspend fun acquire() {
      val waiter = lock.withLock {
        if (used < limit) {
          used += 1
          return
        }
        kotlinx.coroutines.CompletableDeferred<Unit>().also { waiting.addLast(it) }
      }
      try {
        waiter.await()
      } catch (c: kotlinx.coroutines.CancellationException) {
        // A download paused or cancelled while queued must not hold a place in the line.
        lock.withLock { waiting.remove(waiter) }
        throw c
      }
    }

    suspend fun release() {
      lock.withLock {
        val next = waiting.removeFirstOrNull()
        if (next != null) {
          // The slot moves straight to the next download: `used` stays as it is.
          next.complete(Unit)
        } else {
          used = (used - 1).coerceAtLeast(0)
        }
      }
    }

    suspend fun setLimit(next: Int) {
      lock.withLock {
        limit = next.coerceAtLeast(1)
        while (used < limit) {
          val waiter = waiting.removeFirstOrNull() ?: break
          used += 1
          waiter.complete(Unit)
        }
      }
    }
  }

  /**
   * Runs one transfer with its progress pipeline and the Wi-Fi-only watchdog. [block] receives the progress
   * callback to hand to the transfer.
   */
  private suspend fun <T> streamWithProgress(
    id: String,
    gen: Long,
    block: suspend (onProgress: (Long, Long?) -> Unit) -> T,
  ): T =
    coroutineScope {
      val channel = Channel<ProgressSample>(Channel.CONFLATED)
      val collector = launch { drainProgress(id, gen, channel) }
      val stoppedByPolicy = AtomicBoolean(false)
      val transfer = async {
        block { bytes, total -> channel.trySend(ProgressSample(bytes, total)) }
      }
      // Watches the connection for as long as the transfer runs: Wi-Fi-only must hold a download that is
      // already going, not only refuse to start one.
      val watchdog = launch {
        network.awaitUnusable(settings.wifiOnly)
        stoppedByPolicy.set(true)
        transfer.cancel()
      }
      try {
        transfer.await()
      } catch (c: kotlinx.coroutines.CancellationException) {
        if (stoppedByPolicy.get()) throw NetworkNoLongerAllowed() else throw c
      } finally {
        watchdog.cancel()
        channel.close()
        collector.join()
      }
    }

  /**
   * Persists progress (≤ 2 Hz) and emits it (≤ 4 Hz) with the speed over the last seconds, not the last chunk. The
   * first sample and a restart from zero go out at once; the newest sample is always emitted before the transfer's
   * next state, so the final numbers are never held back.
   */
  private suspend fun drainProgress(id: String, gen: Long, channel: ReceiveChannel<ProgressSample>) {
    val meter = SpeedMeter()
    var lastBytes = -1L
    var lastPersist = 0L
    var lastEmit = 0L
    var held: DownloadProgress? = null
    for (sample in channel) {
      val t = now()
      val first = lastBytes < 0
      val restarted = sample.bytes < lastBytes // server ignored Range: progress correctly resets, never lies upward
      val speed = meter.add(t, sample.bytes)
      if (first || restarted || t - lastPersist >= PROGRESS_PERSIST_MS) {
        persistProgress(id, gen, sample.bytes, sample.total)
        lastPersist = t
      }
      val progress = buildProgress(id, sample.bytes, sample.total, speed)
      if (first || restarted || t - lastEmit >= PROGRESS_EMIT_MS) {
        progressFlow.tryEmit(progress)
        lastEmit = t
        held = null
      } else {
        held = progress
      }
      lastBytes = sample.bytes
    }
    held?.let { progressFlow.tryEmit(it) }
  }

  // --- guarded state writes ---

  /** Persists a state transition if [id] is still owned by [gen] and not already terminal; returns the new row. */
  private suspend fun setState(
    id: String,
    gen: Long,
    state: DownloadState,
    mutate: (DownloadRow) -> DownloadRow = { it },
  ): DownloadRow? {
    val updated = mutex.withLock {
      val row = store.find(id) ?: return null
      if (generations[id] != gen || row.state.isTerminal) return null
      save(mutate(row).copy(state = state, updatedAt = now()))
    }
    stateFlow.tryEmit(updated.toRecord())
    return updated
  }

  private suspend fun fail(id: String, gen: Long, code: DownloadErrorCode, message: String? = null) {
    val failed = mutex.withLock {
      val row = store.find(id) ?: return
      if (generations[id] != gen || row.state.isTerminal) return
      save(row.copy(state = DownloadState.FAILED, errorCode = code, errorMessage = message, updatedAt = now()))
    }
    stateFlow.tryEmit(failed.toRecord())
  }

  private suspend fun persistProgress(id: String, gen: Long, bytes: Long, total: Long?) {
    // Only persists bytes/total; the progress event is emitted by the drain loop. State is left unchanged.
    mutex.withLock {
      val row = store.find(id) ?: return
      if (generations[id] != gen || row.state.isTerminal) return
      store.save(row.copy(bytesDone = bytes, totalBytes = total ?: row.totalBytes, updatedAt = now()))
    }
  }

  /** Records the intended final path if the worker still owns the download; no state change, no event. */
  private suspend fun setFilePath(id: String, gen: Long, path: String): DownloadRow? =
    mutex.withLock {
      val row = store.find(id) ?: return null
      if (generations[id] != gen || row.state.isTerminal) return null
      save(row.copy(filePath = path, updatedAt = now()))
    }

  /** Must be called while holding [mutex]. */
  private suspend fun save(row: DownloadRow): DownloadRow {
    store.save(row)
    return row
  }

  /** COMPLETED is only ever written here: with the completion recorded for JavaScript in the same transaction. */
  private suspend fun saveCompleted(row: DownloadRow): DownloadRow {
    store.saveCompleted(row)
    return row
  }

  /** Must be called while holding [mutex]. */
  private fun bumpGenerationLocked(id: String): Long {
    val next = (generations[id] ?: 0L) + 1
    generations[id] = next
    return next
  }

  private fun cleanupWork(id: String) {
    runCatching { paths.workDir(id).deleteRecursively() }
  }

  private fun buildLibraryItem(
    row: DownloadRow,
    container: Container,
    probeContentType: String?,
    dest: File,
    metadata: MediaMetadata?,
    thumbnail: File? = null,
  ): LibraryItem = LibraryItem(
    id = row.id,
    title = row.title,
    site = row.site,
    pageUrl = row.pageUrl,
    sourceUrl = row.url,
    file = dest,
    // The container proven from the bytes names the type; the platform's report only fills in an unknown one.
    mimeType = MediaTypes.libraryMimeType(container, metadata?.containerMimeType ?: probeContentType)
      ?: "application/octet-stream",
    container = container,
    videoCodec = metadata?.videoCodec,
    audioCodec = metadata?.audioCodec,
    hasAudio = metadata?.hasAudio ?: false,
    width = metadata?.width,
    height = metadata?.height,
    durationMs = metadata?.durationMs,
    sizeBytes = dest.length(),
    thumbnail = thumbnail,
    favorite = false,
    galleryUri = null,
    createdAt = row.createdAt,
    completedAt = now(),
  )

  private fun buildProgress(id: String, bytes: Long, total: Long?, speedBps: Long): DownloadProgress {
    val fraction = total?.takeIf { it > 0 }?.let { (bytes.toDouble() / it).coerceIn(0.0, 1.0) }
    val eta = if (speedBps > 0 && total != null && total > bytes) (total - bytes) / speedBps else null
    return DownloadProgress(
      id = id,
      phase = ProgressPhase.DOWNLOAD,
      bytesDone = bytes,
      totalBytes = total,
      fraction = fraction,
      speedBps = speedBps,
      etaSeconds = eta,
    )
  }

  /** Test hook: waits until no worker is running. */
  internal suspend fun awaitIdle() {
    while (true) {
      val jobs = activeJobs.values.toList()
      if (jobs.isEmpty()) return
      jobs.joinAll()
    }
  }

  private fun RequestContext.sanitized(): RequestContext =
    copy(headers = headers.filterKeys { it.lowercase() !in SANITIZED_HEADERS })

  private fun mapProbeFailure(reason: ProbeFailure): DownloadErrorCode = when (reason) {
    ProbeFailure.NETWORK -> DownloadErrorCode.NETWORK
    ProbeFailure.HTTP_403 -> DownloadErrorCode.HTTP_403
    ProbeFailure.HTTP_404 -> DownloadErrorCode.HTTP_404
    ProbeFailure.HTTP_ERROR -> DownloadErrorCode.HTTP_ERROR
    ProbeFailure.DRM_PROTECTED -> DownloadErrorCode.DRM_PROTECTED
    ProbeFailure.LIVE_UNSUPPORTED -> DownloadErrorCode.LIVE_UNSUPPORTED
    ProbeFailure.UNSUPPORTED_FORMAT -> DownloadErrorCode.UNSUPPORTED_FORMAT
    ProbeFailure.NOT_MEDIA -> DownloadErrorCode.NOT_MEDIA
    ProbeFailure.POLICY_BLOCKED -> DownloadErrorCode.UNSUPPORTED_FORMAT
  }

  private fun mapHttpStatus(status: Int): DownloadErrorCode = when (status) {
    404 -> DownloadErrorCode.HTTP_404
    401, 403, 410 -> DownloadErrorCode.SOURCE_EXPIRED
    else -> DownloadErrorCode.HTTP_ERROR
  }

  private fun mapThrowable(e: Throwable): DownloadErrorCode = when (e) {
    is MediaRefusedException -> mapProbeFailure(e.reason)
    is MediaHttpException -> mapHttpStatus(e.statusCode)
    is MediaNetworkException -> DownloadErrorCode.NETWORK
    is IOException -> DownloadErrorCode.STORAGE_ERROR
    else -> DownloadErrorCode.UNKNOWN
  }

  private data class ProgressSample(val bytes: Long, val total: Long?)

  internal companion object {
    const val PART_NAME = "download.part"
    const val HLS_CHECKPOINT_NAME = "hls.checkpoint"
    const val PROGRESS_PERSIST_MS = 500L
    /** Progress events at most 4 times a second per download: enough for a smooth bar, cheap for the bridge. */
    const val PROGRESS_EMIT_MS = 250L
    /** Long enough for a transfer to notice cancellation at its next read, short enough to never hang a tap. */
    const val WORKER_STOP_TIMEOUT_MS = 3_000L

    /**
     * Pausable: anything not yet verifying. Waiting states included — the notification offers Pause there, and a
     * download waiting for a network or a retry is exactly one a user may want to hold.
     */
    val PAUSABLE = setOf(
      DownloadState.QUEUED,
      DownloadState.PROBING,
      DownloadState.DOWNLOADING,
      DownloadState.WAITING_NETWORK,
      DownloadState.WAITING_RETRY,
    )

    /** Already-running states: a repeated Resume/Retry is a no-op rather than an error. */
    val RUNNING = setOf(
      DownloadState.QUEUED,
      DownloadState.PROBING,
      DownloadState.DOWNLOADING,
      DownloadState.WAITING_NETWORK,
      DownloadState.WAITING_RETRY,
    )
    val SANITIZED_HEADERS = setOf("cookie", "authorization", "proxy-authorization")

    /** How often a transient failure is waited out, without progress in between, before the download fails. */
    const val MAX_NETWORK_ATTEMPTS = 5
    const val RETRY_BACKOFF_MS = 250L
    const val MAX_RETRY_BACKOFF_MS = 2_000L

    /** Backoff before re-classifying a source that answered with a transient failure. */
    val CLASSIFY_RETRY_DELAYS_MS = listOf(1_000L, 3_000L, 6_000L)

    /** Signed links expire; these are the answers a fresh probe of the same source can fix. */
    val REFRESHABLE_STATUS = setOf(401, 403, 410)

    /** Refusals the browsing session can answer: a request made without it is retried with it. */
    val SESSION_STATUS = setOf(401, 403)

    val EXPIRY_FAILURES = setOf(ProbeFailure.HTTP_403, ProbeFailure.HTTP_404, ProbeFailure.HTTP_ERROR)

    const val EXPIRED_MESSAGE = "This link expired. Open the page again and start the download from there."

    /** Space kept free beyond the file itself, for the finalized copy's directory entry and the database. */
    const val FREE_SPACE_MARGIN_BYTES = 32L * 1024 * 1024
  }
}

private fun <T> sharedFlow() = kotlinx.coroutines.flow.MutableSharedFlow<T>(
  extraBufferCapacity = 64,
  onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
)
