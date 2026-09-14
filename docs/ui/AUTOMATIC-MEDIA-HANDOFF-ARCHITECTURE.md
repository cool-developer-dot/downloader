# Automatic Media Handoff — Architecture

Phase 2 UX/orchestration: browsing automatically detects media, and a compact **Video available** bar appears only after a verified, supported download handoff exists.

## 1. Old Analyze workflow

Previous product surfaces required a user-facing **Analyze Link** step:

- Home / Downloads **Paste link** opened the quality sheet in idle input mode.
- The user pasted a URL and tapped **Analyze link**.
- Formats appeared only after that explicit analyze pass.

Internal on-device analysis (`analyzeMediaUrl`, candidate probes, social/general verification) still exists. It is no longer a required user step.

## 2. Automatic observation

Final flow:

1. User opens or pastes a URL into the Browser omnibox (normal navigation).
2. The existing WebView loads the page. Tab, cookies, and history are unchanged.
3. `MediaDetectionHost` plus social/general engines observe, classify, and correlate in the background.
4. Bounded verification runs for the current content identity (cache, TTL, in-flight join — no polling).
5. Only a verified, supported, standalone source becomes **AVAILABLE**.

Paste actions on Downloads / Home now navigate to Browser instead of opening Analyze.

## 3. Verified-availability definition

**AVAILABLE** means: a verified, supported download handoff exists for the current content identity.

It does **not** mean VidoraX merely saw:

- a `<video>` element
- `blob:`
- MSE / MediaSource clues
- `init.mp4` / fragments / segments
- ads or arbitrary Range responses
- unverified CDN requests

`TRACKING_CURRENT_VIDEO` may exist internally while an owner is known and verification is in flight. That state is **not** shown as a Download-ready control.

## 4. Media bar

A single browser-owned bar: `BrowserMediaDownloadBar`, mounted by `BrowserScreen` directly above the existing toolbar.

- Copy: **Video available**
- Compact, persistent while the current content remains actionable
- Theme tokens only (Light / Logo / Dark). Logo brand red remains `#DC3C2C` via `theme.colors.primary`
- Does not cover the page more than a thin chrome strip
- Does not auto-open a modal
- Does not reload the WebView

## 5. Play

Tap the bar → existing `ActionSheetModal`:

- **Play**
- **Download**

Play dismisses the sheet and returns to the current webpage. VidoraX does not start a download, does not open a new player architecture, and does not reload the WebView. If the page is already playing, playback continues.

## 6. Direct Download

If exactly one verified standalone source/variant exists:

Download → existing `enqueueBrowserMediaDownload` immediately.

No Analyze, Continue, or second confirmation. Downloader `PREPARING` remains an internal engine state.

Success → **CONSUMED** (bar hides for that content). Failure → restore **AVAILABLE** (not consumed).

## 7. Quality selection

If multiple verified, independently downloadable alternatives exist for the same current media (for example 1080p / 720p / 480p):

Download → existing quality sheet → choose one → enqueue.

Fragments, init streams, mux-required DASH tracks, and equivalent URL/quality duplicates are filtered out. Ordering is deterministic (existing quality sort). One remaining option skips the sheet.

## 8. Content identity

Presentation stays tied to the existing current-content identity and generation guards.

- Content A verified → AVAILABLE A
- Navigate/recycle to Content B → suppress A → verify B independently
- Late A verification cannot publish availability on B
- Consumed A does not consume B

No site-specific identity rules were added.

## 9. CTA lifecycle

Existing lifecycle, adapted:

| State | Meaning |
| --- | --- |
| NONE | idle / detecting / not actionable |
| AVAILABLE | verified actionable source |
| HANDOFF_IN_PROGRESS | single-flight enqueue lock |
| CONSUMED | this content was successfully enqueued |

`claimForHandoff` still blocks duplicate taps. Quality-sheet lock is separate so cancel restores AVAILABLE.

## 10. Dismissal / no-spam

- Dismissing Play/Download does **not** consume the bar and does **not** auto-reopen the sheet.
- The bar may remain for the same content until enqueue success or content change.
- No automatic popup loop. No repeated background toasts for unresolved verification.
- New valid media identity may show a new bar after its own verification.

## 11. Unsupported media

Still unsupported unless the current engine already supports it:

DRM, encrypted HLS, mux-required DASH, blob/MSE-only, segments/fragments, unsupported live, inaccessible sources.

These never become AVAILABLE. Explicit user-facing failure copy:

**This video can't be downloaded by VidoraX.**

Technical reasons stay in sanitized diagnostics.

## 12. Session / safety boundaries

Unchanged:

- No credential persistence or interception
- Cookie/session handling not weakened
- No CAPTCHA / paywall / DRM bypass
- No remote resolver, proxy/VPN bypass, or FFmpeg/general muxer
- YouTube is not reintroduced as a promoted download target

## 13. WebView isolation

Unchanged: WebView keys, mounted tab policy, max tabs, cookies, session continuity, history, user agent, navigation policy, intent handling, SSL.

Media availability must not reload the page.

## 14. Downloader isolation

Canonical download states are unchanged (PREPARING → … → COMPLETED / FAILED / CANCELLED).

Range, HLS transfer, retry/watchdog, pause/resume, `.part` handling, finalization, notifications, and file actions are not modified. CTA uses the existing enqueue API.

## 15. Android manual acceptance

See `docs/testing/AUTOMATIC-MEDIA-HANDOFF-REAL-ANDROID-ACCEPTANCE.md`.

Static gate: `npm run verify:automatic-media-handoff`

---

## 16. Generic dynamic-website automatic detection

The pipeline is site-neutral. Any page that exposes an already-supported
format via an observable transport becomes **Video available** the same way:

```
CONTENT IDENTITY
        ↓
VIDEO / PLAYER OBSERVED  (DOM, blob, iframe, MSE clue)
        ↓
MEDIA CANDIDATE OBSERVED (native WebViewClient, JS fetch, JS XHR,
                          PerformanceObserver, DOM extractor)
        ↓
CANDIDATE NORMALIZED + FALSE-POSITIVE FILTERED + DEDUPED
        ↓
CANDIDATE CORRELATED TO CURRENT CONTENT
        ↓
AUTO-VERIFY (bounded, cached, inflight-joined — no user tap)
        ↓
VERIFIED + SUPPORTED
        ↓
Video available  →  Play  /  Download
```

Nothing in this pipeline hardcodes hostnames (Dailymotion / any other
site). The only site-specific rules that remain are the pre-existing
social containment/session paths for Instagram / TikTok, which are
authoritative for those platforms and unchanged here.

## 17. Late / dynamic / SPA media

Media may appear at any time after initial page load. The engine keeps
observing throughout the page lifecycle via:

- MutationObserver → `<video>` / `<source>` / `<iframe>` insertions and
  attribute changes (with element-identity dedupe).
- PerformanceObserver on `resource` entries → covers late fetches
  including SPA route changes and recycled players.
- Native `MediaNetworkBridge.shouldInterceptRequest` → captures requests
  the JS runtime cannot see (MSE-loaded segments, cross-origin iframe
  players, internal player requests).
- SPA navigations without full reload → `page_meta` + `active_video`
  events bump `pageGeneration`, invalidating stale candidates.

No `setInterval`/polling loops are introduced. Candidate collections are
bounded (`DETECTION_TIMING.maxDetectedPerPage`) and old page generations
are dropped when a meaningful SPA transition is detected.

## 18. Iframe / cross-origin player ownership

`generalPageMediaContextStore.playerKind === 'iframe'` promotes a
non-iframe HTTP(S) candidate on the same page from `WEAK` to `MEDIUM`
ownership when it clears segment/thumbnail/blob rejection — allowing
verified media that is served from `player.cdn.example.com` while the
user's page is `example.com/watch/...`. Iframe `src` is treated as the
player document, not the executable media URL.

## 19. Extensionless media URLs

Detection never requires `.mp4` / `.webm` / `.m3u8`. Family classification
uses (in order): the response `Content-Type`, HLS/DASH manifest
signatures on the wire, request/resource type, MIME probe results, and —
last — path/extension heuristics. `MediaNetworkBridge.MEDIA_FAMILY_PATH`
recognises extensionless CDN paths that carry media evidence.

## 20. Blob / MSE

`blob:` URLs are never downloadable and never become `AVAILABLE` on their
own — presentation explicitly rejects them (`isRejectedDownloadTarget`).
When the page's `<video>` uses a `blob:` src, the engine records
`activeVideoIsBlob = true`, which upgrades any correlated non-blob HTTP
candidate on the same page to `MEDIUM` ownership. If a supported
standalone source / VOD HLS manifest is observed under the blob player,
the normal verify path publishes `AVAILABLE`. MSE clues alone never do.

## 21. HLS auto-verify and auth-aware retry

Manifest fetches from React Native use OkHttp — a different network
stack from the WebView. Some CDNs (a Dailymotion-class regression is one
example — the fix is generic) return an HTML interstitial or a 401/403
when the manifest URL is requested outside the WebView cookie context.

`fetchManifestResource` now returns a rich `ManifestFetchOutcome`
including `status`, `contentType`, `authLike`, `htmlLike`,
`unsupportedBody`, and `networkError`. The HLS branch of
`verifyGeneralSourceCandidate` maps 401/403 / login-HTML bodies to a new
`AUTH_REQUIRED` rejection reason (as opposed to `MANIFEST_INVALID`),
which `classifyAuthLikeFailure` treats as `session_required`. That
triggers the existing `maybeBuildSessionRetryContext` cookie-retry path,
which re-issues the fetch with the WebView cookie context. If the retry
succeeds, the manifest parses and the offer is published normally.

DRM, live HLS, and DASH-that-requires-muxing remain `not_auth_like` and
are never retried — they are proven unsupported.

## 22. Sanitized DEV diagnostics

`services/automatic-handoff-diagnostics.ts` emits canonical, DEV-only
events across the pipeline. Every event goes through the sanitizer:
cookies / Authorization / signed query strings are redacted; URLs are
reduced to their hostname with a boolean `Signed` flag when the query
looks token-bound. Never emitted in production builds.

Canonical event names:

| Event | Origin |
| --- | --- |
| `CONTENT_IDENTITY_CHANGED` | `generalPageMediaContextStore` |
| `VIDEO_OWNER_OBSERVED` | `generalPageMediaContextStore` |
| `MEDIA_CANDIDATE_OBSERVED` | `MediaDetectionPipeline.processCandidates` |
| `MEDIA_CANDIDATE_DEDUPED` | `MediaDetectionPipeline.processCandidates` |
| `MEDIA_CANDIDATE_CORRELATED` | `general-correlation.service` |
| `MEDIA_VERIFY_AUTO_STARTED` | `useBrowserMediaAction.verifyCandidate` |
| `MEDIA_VERIFY_JOINED_INFLIGHT` | `buildVerifiedGeneralMediaOffer` |
| `MEDIA_VERIFY_SUPPORTED` | `useBrowserMediaAction` (social + general) |
| `MEDIA_VERIFY_UNSUPPORTED` | `useBrowserMediaAction` (DRM / DASH / live / video-only) |
| `MEDIA_VERIFY_REJECTED` | `useBrowserMediaAction` (transient rejection) |
| `MEDIA_VERIFY_STALE_RESULT_IGNORED` | `useBrowserMediaAction` (both scopes) |
| `MEDIA_CTA_AVAILABLE` | `useBrowserMediaAction` (after handoff) |
| `MEDIA_UNSUPPORTED_PRESENTED` | `useBrowserMediaAction` (once per identity) |

On a real Android build, `adb logcat | grep VidoraHandoff` reconstructs
the exact pipeline stage a given page reached.

## 23. Dailymotion as regression example only

Dailymotion is the reported regression. It is **not** the architecture.
The verifier `verify:automatic-media-handoff` explicitly asserts that
`general-source-reliability.service.ts` and the detection engine do not
contain the string `dailymotion`. The generic HLS auth-retry + rich
manifest outcome fix restores automatic detection for any page whose
HLS manifest was previously being rejected as `MANIFEST_INVALID` when
the true failure was auth-like.

