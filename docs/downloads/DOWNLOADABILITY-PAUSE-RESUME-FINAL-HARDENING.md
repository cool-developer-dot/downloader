# Downloadability + Pause/Resume Final Hardening

## 1. Real Android failures

Two production-blocking failures remained after prior static-green passes:

- Supported-looking current videos (TikTok feeds, possibly Instagram/general) showed **“This video isn't available to download.”**
- Pause/Resume did not reliably stop or continue the actual Android transfer.

Static verifiers from earlier passes did not override this device evidence.

## 2. Unsupported vs unresolved distinction

Internal taxonomy (`media-resolution-outcome.ts`):

| Kind | Meaning | Unavailable toast |
| --- | --- | --- |
| RESOLVED_SUPPORTED | Verified executable offer | No |
| PROVEN_UNSUPPORTED | Bounded attempt proved no supported source | Yes |
| TRANSIENT_UNRESOLVED | No candidate yet / verify in flight | No |
| STALE_CONTEXT | Token/generation mismatch | No |
| SESSION_REQUIRED | Phase 6 session/auth context | No (session copy) |
| NETWORK_FAILURE | Probe/network error | No (network copy) |

## 3. Media resolution architecture

```
current video owner
  → content identity
  → observations (DOM / network / native bridge)
  → bounded candidate window
  → correlation (Phase 4 social / Phase 5 general)
  → ranked HTTP candidates
  → verification
  → verified offer
  → Phase 1 enqueue
```

No second detector. Blob remains clue-only.

## 4. Content identities

- TikTok: `/video/{id}` or feed item id; `/foryou` is a shell, not an id.
- Instagram: `/reel|reels|p|tv/{shortcode}` (existing Phase 4 rules).
- General: `currentMediaIdentity` + `pageGeneration`.
- Never: raw signed CDN URL or `blob:`.

## 5. Candidate observation

Existing ingest paths (DOM, fetch/XHR, performance, native `MediaNetworkBridge`, play events) are unchanged. `upsertMedia` now records HTTP candidates into a **count-bounded window** keyed by tab + navigation epoch + generation + platform.

## 6. Extensionless media handling

TikTok `/video/tos/…` Range objects remain eligible via `isLikelyTikTokProgressiveMediaUrl` + parser exception. Arbitrary extensionless URLs are not media. Final HTTP verification is mandatory.

## 7. MSE / blob correlation

`blob:` never goes to Phase 1. Active blob player + correlated HTTP progressive/Range object can produce an executable candidate. Segment-only MSE with no complete object is PROVEN_UNSUPPORTED.

## 8. Early / late race handling

Early network before identity: window retains up to 8 HTTP candidates per key. When identity/owner is ready, tap and correlation **re-evaluate** window + store candidates. Late network after identity triggers the existing correlation/verify path without requiring another scroll.

## 9. Preload arbitration

Not “latest request wins.” Rank: owner association, active item, generation, request family, playback, then bounded time as **secondary rank** only.

## 10. 2.5s heuristic review

Previously, blob players treated any HTTP candidate with `detectedAt - ownerObservedAt > 2500` as `OFFSCREEN_PRELOAD` and **rejected** it. Long dwell (10/30/60s) and CDN refresh of the **current** tos object were false-negatives.

Now: `PROGRESSIVE_MEDIA` on the same generation is **not** time-rejected. Time only applies a rank penalty so neighbor preloads rank lower than the closer current object.

## 11. Candidate ranking

`selectCurrentSocialMedia` now fills `activeCandidateIds` with up to **6** non-rejected ranked ids (not only the winner). Verification tries the next candidate after an invalid fragment/image.

## 12. Verification

Phase 4B / 5B `buildVerified*Offer` remain the verifiers. Tap joins/starts that path instead of toasting on first empty lookup.

## 13. Definitive unsupported criteria

DRM, encrypted HLS, unsupported DASH, blob-only after bounded resolution, segment/init-only, HTML/JSON/non-media after all bounded current-content candidates fail.

## 14. Session-aware source handling

Session failures map to `SESSION_REQUIRED`, not generic unavailable. Phase 6 ephemeral CookieManager/request context is unchanged. No Cookie/Authorization persistence.

## 15. CTA tap resolution

1. Capture token (tabId, epoch, generation, contentIdentity)
2. Use fresh verified offer if token matches
3. Else join/start bounded `verifyCandidate` (window + ranked HTTP)
4. Re-check token
5. Quality sheet if needed; re-check token
6. Phase 1 enqueue

Unavailable toast only via `toastForResolutionOutcome` → PROVEN_UNSUPPORTED.

## 16. Pause/resume pre-fix architecture

UI → Zustand `pause`/`resume` → `downloadEngine` → worker/HLS → `.part` / `hlsTransfer` → bind-engine → card resolver.

Prior hardening added `resolveDownloadRuntimeActions` but native `DownloadTask.pause()` did not abort OkHttp, pause committed independently of bytes stopping, lock_held was a silent no-op, and late transferring snapshots could undo PAUSED.

## 17. Exact pause/resume root cause

1. Progressive `pause()` called `task.pause()` without `abortController.abort()`; abort only ran when `task` was null.
2. `task.state !== 'active'` returned false → 10×30ms poll or PAUSE_FAILED.
3. `locks.has` returned without joining.
4. Bind-engine allowed PAUSED → DOWNLOADING when `localState === 'transferring'`.

## 18. Authoritative runtime action model

`resolveDownloadRuntimeActions({ status, executionState, workerState, hasActiveTransfer })`

- DOWNLOADING + active transfer → Pause + Cancel
- PAUSED → Resume + Cancel
- FINALIZING → Cancel only
- WAITING_FOR_WIFI / STARTING / QUEUED → Cancel only
- HLS uses the same Pause (not `canResumeProgressive(url)`)

## 19. Transport pause semantics

Set `pauseRequested`, **always abort** the in-flight controller, then native `task.pause()` if present. Do not clear `pauseRequested` on pause throw. Manager waits `waitUntilSettled()` then commits PAUSED. USER vs FAILED remains `pauseRequested`.

## 20. Progressive resume semantics

Resume joins in-flight pause, then transitions **QUEUED** (not instant DOWNLOADING), then scheduler admits one worker. Offset from on-disk `.part`.

## 21. HTTP Range validation

Unchanged: 206 start must equal offset; HTTP 200 never appended; invalid 206 rejected (`range-validation.ts` / `append-range-transfer.ts`).

## 22. HLS pause/resume

HLS worker abort + `userPauseRequested` + `hlsTransfer` checkpoint unchanged. Same pauseOps/resumeOps serialization. One worker. No segment duplication by design.

## 23. Retry / watchdog interaction

Pause still `clearRetryTimer`. Worker `shouldPause` stops stall watchdog publishing. Late retry cannot legally PAUSED → DOWNLOADING without Resume.

## 24. Late event rejection

`canPublishTransferProgress` plus bind-engine: PAUSED + transferring snapshot is `LATE_PROGRESS_REJECTED`. Mapped DOWNLOADING cannot overwrite PAUSED.

## 25. FINALIZING behavior

Execution FINALIZING (catalog still DOWNLOADING) → no Pause. `FINALIZING → PAUSED` remains illegal so near-100% completion wins.

## 26. Concurrent downloads

pauseOps/resumeOps/locks are per `downloadId`. Pausing A does not pause B.

## 27. Process-death behavior

Unchanged Phase 1 recovery: persisted PAUSED does not auto-start. Resume requires safe metadata. Session-bound process death still `SESSION_CONTEXT_LOST`.

## 28. Security / privacy / manual acceptance

No backend, no FFmpeg, no DRM bypass, no blob enqueue, no Cookie/Auth persistence, no full signed CDN in traces (`MEDIA_RESOLVE_TRACE` / `DOWNLOAD_RUNTIME_TRACE`).

Manual plan: `mobile/docs/testing/DOWNLOADABILITY-PAUSE-RESUME-FINAL-REAL-ANDROID-ACCEPTANCE.md` (all `NOT_TESTED`).

## 29. Pause / resume runtime regression (native cancel hang)

Observed on device: Pause stopped bytes, but the job never reached authoritative PAUSED and Resume could not restart.

Cause: `TransferWorker.pause()` called native `DownloadTask.pause()` (which already cancels OkHttp with `isPausing=true`) and then aborted the AbortSignal wired to `DownloadTask.cancel()`. Native `isCancelling` can return from the read loop without resuming the Kotlin coroutine, so `downloadAsync()` never settles, `waitUntilSettled()` hangs, Zustand `mutatingIds` stays true, and PAUSED is never committed.

Fix: do not abort the AbortSignal after a successful native pause. Fetch/HLS/multi-range still abort. Pause settle is bounded; a hung native task is detached so Resume can reclaim the job. `.part` is preserved.
