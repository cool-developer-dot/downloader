# Dynamic video format handoff

## Pre-implementation forensic audit

Audited the working tree before implementation, including existing uncommitted
media/UI changes. Those changes are the baseline and are preserved. Baseline
`npx tsc --noEmit` passed. Expo SDK 57 reference was read before edits:
https://docs.expo.dev/versions/v57.0.0/ . No native build or prebuild was run.

| Stage | Actual implementation / authority |
| --- | --- |
| WebViews | `browser/components/BrowserContainer/{BrowserContainer,MountedTabWebView,BrowserWebView}.tsx`; tab-keyed physical views |
| Tab limits | `browser/tabs/constants.ts`: 8 tabs, 2 mounted WebViews |
| Navigation ownership | `useTabScopedBrowserEngine`, `navigationEpochRef`, `webViewInstanceGenerationRef`; inactive JS messages filtered in `BrowserWebView` |
| JS bridge | `useMediaDetectionBridge` → `parseMediaBridgeMessage` → `MediaDetectionEngine.handleWebViewMessage` |
| Injection | `observers/injected-script.ts`: `buildMediaDetectionBeforeContentScript`, `buildMediaDetectionInjectedScript` |
| DOM | `scanDom`, `mediaFromElement`, MutationObserver, `onLoadedMetadata`, `collectActiveVideoPayload` |
| JS network | fetch response hook, XHR load hook, `observeNetworkUrl`, `observePerfEntry`, PerformanceObserver |
| Frames | `collectVideoElements`, `collectIframePlayerPayload`, `handleActiveIframePlayer`, `general-embedded-player.ts` |
| Native observation | `MediaNetworkBridge.observeRequestFrom`, WebViewClient hook in `scripts/apply-webview-media-hook.js` |
| Service workers | `installServiceWorkerObserver` installs Android `ServiceWorkerClient`, calls the same `observeRequestFrom` |
| Native JS ingress | `native-network.adapter.ts` → `processNativeMediaCandidateEvent` → `observeNativeCandidate` |
| Request classification | `classifyGeneralNetworkResource`, `nativeNetworkPrefilter`, `parseProgressiveMediaUrl` |
| Normalized model | `MediaCandidate`, `DetectedMedia`, `extractFromDomCandidate`, `extractDetectedMedia` |
| URL/MIME | `parsers/extension.parser.ts`, `downloads/analyze/format.ts`, `constants/media.constants.ts` |
| Ingest | `MediaDetectionPipeline.processCandidates/processNetworkUrl` → bounded detection store |
| HLS observation | `parseHlsManifest`, `enrichHlsMedia`, segment URI blocklist |
| Content identity | `generalPageMediaContextStore`, `classifyGeneralContentNavigation`, `buildGeneralCurrentMediaIdentity` |
| Correlation | `correlateGeneralCandidate`, `selectCurrentGeneralMedia`: currentSrc, visibility, ad/preview penalties, iframe/blob evidence |
| Early/late evidence | `observation/candidate-observation-window.ts`: bounded tab/epoch/generation windows |
| Verification | `verifyMediaCandidate`, `probeMediaMime`, `verifySocialSourceCandidate` (also reused by generic source verification) |
| HLS verification | `verifyGeneralSourceCandidate`, engine `parseHlsPlaylist` / `fetchAndParseHlsPlaylist`, `planHlsSegments` |
| Variants | `buildVerifiedGeneralMediaOffer`, `generalOfferToAnalysis`, `buildResourceIdentityKey`, `dedupeVariants`, `verification-session.ts` |
| Quality | `normalizeAnalysisToSelection`, `selectVerifiedStandaloneQualities`, `useQualitySelection`, `QualitySelectionSheet` |
| CTA | `useBrowserMediaAction`, `browserMediaActionService`, `browser-download-presentation.ts`, `BrowserMediaDownloadBar` |
| Handoff | `claimForHandoff`, `beginQualitySelection`, `enqueueBrowserMediaDownload`, `runPreDownloadGate` |
| Queue | `useDownloadsStore.create` → existing `downloadEngine.enqueue`; `AdmissionScheduler`, execution state machine |
| Transfer | `TransferWorker`, HLS worker, multi-range worker; existing resume-decision/range-validation/pause-ack policy |
| Finalization | `validateFinalDownloadFile` → `verifyDownloadedMediaContent` → commit → `verifyCompletedFile` |
| Final identity | `applyCompletedFileIdentity` → `LocalDownloadRecord` persistence → completed event |
| Downloads | `bindDownloadEngineToStore`, catalog persistence, `DownloadsScreen` / `DownloadDetailsScreen` |
| Library | `ensureLibraryCompletionBridge`, `notifyLibraryDownloadCompleted`, `reconcileAvailability`, `assembleCanonicalItems` |
| Offline player | `openPlayer` → `resolvePlaybackSource` / runtime dependencies → managed local URI → `expo-video` |
| Android file actions | `completed-file/action-service.ts`, FileActions, MediaExport Kotlin packages; same file descriptor |
| Diagnostics | general-media/general-source/social-source/automatic-handoff diagnostics; download audit and library diagnostics |
| Tests | existing `scripts/verify-*.ts` contract verifiers, engine smoke fixtures and `docs/testing` device matrices |

### Root causes identified before edits

1. Divergent format tables: WMV missing from generic network extension set;
   analyze and completed-file identity default or collapse valid formats to MP4.
2. Byte validation lacks AVI/ASF WMV and legacy QuickTime evidence. Generic
   verification may accept an unsuccessful signature probe solely on video MIME.
3. Extensionless DOM sources are emitted only if they pass URL/MIME hints, then
   rejected again when no category can be resolved. Octet-stream is rejected early.
4. HLS master children are published without child VOD/encryption/engine checks;
   cached expansion retains only the first variant on subsequent calls.
5. Resource/cache/dedupe identities drop every query parameter and lowercase paths.
   Distinct `?id=` / quality endpoints can collide; signed URL refresh can use stale cache.
6. Native events carry no physical WebView identity; worker events without a page
   default to the active page. Inactive same-URL tabs can contaminate ownership.
7. Generic iframe/blob correlation gives unrelated same-page traffic a medium
   floor without frame association. Current video alternatives lack DOM ownership.
8. Main observer has an unbounded `seen` object and a lifetime 400-message stop;
   reused XHRs accumulate load listeners. Early capture loses initiator metadata.
9. Active-video coalescing omits visibility and DRM fields. SPA handling conflates
   some content changes with query noise and does not consistently reset batches.
10. MIME cache is URL-only (including authenticated failures); probe wait queue
    abort removes the wrong callback, and the queue is not bounded.
11. Download dedupe occurs before selected quality resolution; an invalid selected
    option silently falls back to a different source. Generic refresh may substitute
    a page candidate for the chosen variant.
12. Final size mismatch can be ignored after content validation; identity rename
    is best effort and lacks a final physical-identity check before completion.

## Product contract

Observable, current-content, verified, actionable media from non-YouTube sites
can be offered. Domain membership is not a support criterion. Speculative
candidates remain internal. Runtime certification requires the companion Android
acceptance matrix; static contracts do not establish device success.

## Continuation audit and preserved work

The continuation inspected `git status`, the full tracked diff, and all six
original untracked files. The original tree had 98 tracked paths changed and no
staged changes. The saved audit and original task were recovered before editing.
No reset, clean, checkout/revert, commit, push, prebuild, or native build was used.

The five deleted `src/store/player/*` files are intentional legacy-store removal:
the barrel exports were removed and no consumers remain. Actual playback uses
`src/player/use-player-session.ts`, `src/playback`, and the shared `openPlayer`
navigation helper. The navigation, Library tap behavior, browser direct-download
UX, theme, and Downloads resume-capability work present at continuation are retained.

The original pre-implementation baseline above passed TypeScript. The resumed
tree had one missing `verifyCompletedFile` import in the progressive worker;
that import is restored and the final standalone TypeScript check passes.

| Phase | State at continuation | Remaining work completed |
| --- | --- | --- |
| 0 audit | Complete | Reconciled actual tree and original brief |
| A observation | Implemented | Bind native wrapper tags from real WebView events; remove YouTube-specific global harvesting |
| B formats | Implemented | Reject DRM sample-entry evidence; correct suffix recognition |
| C ownership | Implemented | Preserve resource selectors in page context and separate same IDs on different page hosts |
| D verification | Implemented | Regression coverage of unresolved partial structures and bounded caches |
| E quality | Partly implemented | Use shared identity for quality dedupe and browser fingerprints |
| F handoff | Partly implemented | Reject invalid selected IDs; dedupe selected source; freeze before asynchronous confirm |
| G downloader | Integrated | Preserve selected resource during refresh and selected social variant identity |
| H completion | Implemented with missing import | Fix final-file check import; offer external Open after decoder failure |
| I performance/diagnostics | Implemented | Verify bounds, coalescing, cleanup, hashed diagnostic fields |
| J verification/docs | Unfinished | Focused verifier, regression results, architecture and Android acceptance matrix |

## 1. Supported download formats

`resource/video-resource.ts` is the shared video-format authority used by analyze,
detection hints, structural verification, and completed identity. Supported targets:
MP4, M4V, MOV, WebM, AVI, WMV, standalone fMP4, and clear VOD HLS. Existing audio
and other candidate recognition remains separate; a recognized candidate alone
does not make a supported downloadable video.

| Family | Evidence | Completed identity / playback |
| --- | --- | --- |
| MP4 | ISO BMFF initialization/file and media-data structure | `.mp4`, `video/mp4`; codec dependent |
| M4V | MP4 structure + compatible MIME/suffix evidence | `.m4v`, `video/x-m4v` |
| MOV | QuickTime brand or legacy moov+mdat structure | `.mov`, `video/quicktime`; codec dependent |
| WebM | Bounded EBML signature + noncontradictory metadata | `.webm`, `video/webm`; codec dependent |
| AVI | RIFF AVI signature and credible declared bounds | `.avi`, `video/x-msvideo`; external player may be needed |
| WMV | ASF header + video-stream GUID | `.wmv`, `video/x-ms-wmv`; external player may be needed |
| fMP4 | Initialization + moov + moof + media data | MP4 identity; individual fragments excluded |
| HLS | Clear VOD playlist validated by downloader parser | Actual assembled TS/MP4 identity, never a playlist filename |

## 2. Exclusions

DRM/protected samples, encrypted HLS, unsupported live playlists, mux-required
DASH, isolated init/fragments/chunks, fake HTML/JSON/image responses, unsupported
schemes, and inaccessible sessions cannot produce an actionable offer. No
YouTube-specific extractor or deciphering path is provided. The pre-existing
standalone DASH BaseURL path is retained only for complete muxed files that pass
progressive verification; fragmented DASH remains unsupported.

## 3–4. Observation and normalization

One pipeline receives DOM `currentSrc`/`source`, dynamic mutations, fetch/XHR,
PerformanceObserver/resource replay, metadata/JSON-LD, before-content capture,
native main/child-frame requests and ServiceWorkerClient observations. DOM source
ownership and native request frame/referrer evidence travel with the candidate.
Extensionless video-element and credible network evidence can enter with unknown
container. MIME/extension hints do not prove bytes. Request Accept is never
presented as an observed response Content-Type.

## 5. Iframe and native ownership

React Native binds actual wrapper tags from layout/loading events; the WebView
imperative command ref is not a host-view handle. Kotlin emits physical view IDs,
observation time and safe request-referrer metadata. The existing engine requires
the active tab and navigation epoch. Events predating the binding are rejected.
Cross-origin frame candidates need observable frame association; there is no
cross-origin DOM bypass. Service workers have no WebView parameter and require a
unique registered document match. Ambiguous same-URL tabs or absent referrers stay
unowned. Device ordering and frame/referrer availability require Android testing.

## 6. SPA identity

Page identity preserves meaningful content IDs, distinguishes different page
hosts, and ignores recognized tracking/hash changes. Source identity retains
case-sensitive resource paths and content/quality/codec query selectors. Explicit
credential fields may rotate without replacing the owned resource. URL identities
are internal: diagnostics hash them. Genuine tab, epoch or content-generation
changes invalidate stale ownership/verification/quality confirmations.

## 7–9. Classification and verification outcomes

`resolveVideoFormatHint` normalizes MIME parameters and compatible extension or
Content-Disposition evidence. `resolveVideoResource` combines those hints with
bounded byte structure. Unknown video MIME does not default to MP4. HTML, JSON,
image, DRM, contradictory concrete MIME, init and fragment evidence are rejected.
Missing/incomplete structural evidence remains `TRANSIENT_UNRESOLVED`.

Progressive verification reuses the existing MIME/Range probe and shared signature
classifier. A failed signature cannot pass merely because MIME says video.
Malformed Range-start evidence is rejected; full resource length is distinguished
from a 206 slice. HLS masters expand at most six children, and each child is checked
against the same clear/VOD/transport parser used by the downloader before becoming
downloadable. Cached master results retain all verified alternatives.

`PROVEN_UNSUPPORTED` means positive contradictory/unsupported evidence;
`TRANSIENT_UNRESOLVED` includes delayed metadata, incomplete prefix, unobservable
ownership, network/auth retries and stale work. No runtime success is inferred
from a candidate being observed.

## 10–12. Quality, CTA and handoff

Correlated variants share one offer. Resolution comes from dimensions or manifest
metadata; bitrate orders otherwise comparable options. Unknown resolution stays
`Original Quality`. Container metadata remains visible. Credential-only duplicates
collapse while content/quality selectors remain distinct.

The preserved current UX is a compact `Video available` bar: tap downloads a single
verified source or opens the existing quality sheet for meaningful alternatives.
Playback remains in the webpage, and local Play remains available after download.
The removed browser Play action was a no-op; it is not reintroduced. Observation
does not automatically open a modal.

The service rejects an invalid selected ID instead of falling back. Dedupe runs
against the chosen source. Quality confirmation locks before awaiting verification,
rechecks the frozen generation before creation, and builds refresh identity for
the selected option. Generic refresh may replace only the same resource family.
Both routes use the existing Downloads store create/enqueue API and state machine.

## 13. Request context and privacy

Legitimate current browser Referer/User-Agent/cookie context follows verification,
handoff and transfer. Cached variants strip request-context secrets; authenticated
MIME probes are not reused as global cached evidence. Full executable signed URLs
remain necessary internally, but diagnostics log hashes/categories rather than
secret query values or Cookie/Authorization. No authentication circumvention,
DRM bypass, remote resolver or second detector/downloader is introduced.

## 14–16. Finalization, Downloads and Library

Finalization checks bytes before committing the partial file, then verifies the
physical destination and expected size. A signature does not override a size
mismatch. Completed identity uses actual signature/MIME/container evidence and
corrects the filename within the managed job directory. Rename recovery checks
which file physically exists, including a native move that changed its URI before
throwing. Progressive and HLS workers check the final path before persistence and
completion publication. Existing size tolerance and managed-path checks remain.

The existing local catalog publishes queue entries immediately. Completed records
retain their final path/name/MIME/size; the completion bridge reconciles Library
availability and refreshes its data. No duplicate file catalog or completion path
was added.

## 17. Internal and external playback

Library/Home/history/details still use `openPlayer(mediaId)`. The player resolves
and verifies the managed local file. Download support does not promise a decoder:
MOV/WebM codecs and especially AVI/WMV need device checks. `UNSUPPORTED_MEDIA` or
`PLAYBACK_FAILED` now exposes the existing `openCompletedFile` action with localized
errors. Open/Share/export continue using the same completed-file descriptor.

## 18–19. Performance and security boundaries

Existing eight-tab/two-mounted-WebView limits remain. Observer dedupe is bounded
to 320 entries; native recent entries to 400; MIME wait queue to 48. Verification
coalesces in-flight work and stores bounded alternatives. Observer rate windows
renew, reused XHR load listeners are one-shot, pending timers/listeners are cleaned
up, and metadata probes are cancelled after use. No per-network-request React
state updates or extra engine are introduced.

Signatures are bounded structural checks, not full demux/decode or cryptographic
integrity checks. A large MP4 with metadata/media headers outside the probe window
can remain unresolved. A body that changes after verification can still fail in
the downloader/finalizer. Unrecoverable blob/MSE traffic, opaque frames and
ambiguous workers are observable-platform limits, not promised coverage.

## 20. Verification and acceptance

Run `npx tsc --noEmit` and `npm run verify:dynamic-video-format-handoff`.
The focused script combines production pure-function checks, isolated production
handoff/finalizer calls with native/network seams, and static integration contracts.
The in-memory filesystem is not evidence of actual Android filesystem behavior.

See [real Android acceptance](../testing/DYNAMIC-VIDEO-FORMAT-HANDOFF-REAL-ANDROID-ACCEPTANCE.md)
and the [verification report](../testing/DYNAMIC-VIDEO-FORMAT-HANDOFF-VERIFICATION.md) for commands, results and remaining runtime
checks. All device rows begin `NOT_TESTED`.
