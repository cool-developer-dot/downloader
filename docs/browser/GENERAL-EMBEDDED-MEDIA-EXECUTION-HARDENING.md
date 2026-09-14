# General Embedded Media Execution Hardening

Generic Phase 5 architecture. Dailymotion (`https://dai.ly/xb6huwu`) is the reproduction case, not a special downloader.

## 1. Real Dailymotion runtime evidence

After current-video CTA hardening:

- Cross-origin iframe discovered (`geo.dailymotion.com` player)
- `ownerStrength = STRONG`
- `GENERAL_OWNER_ACQUIRED`
- Download CTA visible

But:

- `candidateFingerprintHash = null` on owner/correlation traces
- Repeated `generation_changed` `reason = spa_path`
- `BrowserCTA` `navigation_invalidated` while remaining on `/video/...`
- Download tap produced no offer and no Phase 1 enqueue

## 2. Owner vs candidate distinction

The iframe owner is the **visible player document**, not the executable media URL.

- Owner identity: page video id (`video:xb6huwu`) + iframe geometry
- Candidate: native-observed progressive/HLS/DASH resource
- Iframe `src` / `currentSrc` is HTML player chrome and must never be treated as downloadable media

## 3. Exact candidate-ingest root cause

**A. Native observer filtered extensionless iframe media before JS.**

`MediaNetworkBridge` previously emitted only when:

- path had a media extension (`.mp4`, `.m3u8`, …), or
- `Accept` looked like video/audio/mpegurl/dash, or
- TikTok CDN heuristics

`hasRange` was computed but used only for TikTok. Cross-origin player requests with `Accept: */*` and extensionless CDN paths were dropped on the WebView thread. JS never saw them, so fingerprints stayed null.

**B. Same-content SPA path churn cleared owner/candidates.**

`syncFromPageUrl` bumped `pageGeneration` on raw host+pathname inequality. Cosmetic/locale/player path noise on the same `/video/{id}` produced `spa_path` bumps, cleared owner fields, and `useBrowserMediaAction` called `resetForNavigation` via `isSameDocumentUrl`.

**C. Download tap silent no-op.**

With no correlated HTTP candidate, `download()` called `classifyMediaResolutionOutcome({ hasCandidates: false })` (`TRANSIENT_UNRESOLVED`). `toastForResolutionOutcome` returns null for transient, so the tap did nothing visible.

## 4. Cross-origin network observation

Top-frame JS fetch/XHR hooks cannot see child-frame player traffic. Native `shouldInterceptRequest` is the legitimate observer. No cross-origin DOM bypass.

## 5. Native observer path

`WebViewClient.shouldInterceptRequest` → `MediaNetworkBridge.observeRequest` (never replaces the response) → RN event `VidoraMediaNetworkCandidate` → `native-network.adapter` → `mediaDetectionEngine.observeNativeCandidate` → `parseProgressiveMediaUrl` / MIME probe → store → general correlation → Phase 5B.

`WebView.getUrl()` is the main page URL. That is acceptable for page ownership. Android `WebResourceRequest` does not expose the initiating iframe URL. Correlation uses `isForMainFrame`, Range, MIME/path family, page identity, and generation — not iframe document URL equality.

## 6. Extensionless media handling

Candidates may ingest without `.mp4` / `.m3u8` when evidence exists:

- video / MPEGURL / DASH MIME
- Range + media-family path (`hls|manifest|playlist|stream|vod|video`)
- HLS/DASH path shape

Arbitrary extensionless API/HTML/JSON remains rejected.

## 7. Range handling

HTTP Range is media evidence, not proof of a complete file. Phase 5B still verifies. Isolated fragments (`.m4s` / segment paths) stay rejected.

## 8. HLS detection

Recognized by `.m3u8`, MPEGURL MIME, or `/hls|/playlist` path family, then parsed (`#EXTM3U`). Encrypted HLS / live HLS remain unsupported. HLS worker unchanged.

## 9. DASH boundary

MPD / `application/dash+xml` / `/dash` path → DASH candidate. Separate A/V stays `DASH_UNSUPPORTED`. No FFmpeg, no mux. A parallel progressive/HLS rendition can still win via bounded multi-candidate verify.

## 10. Iframe correlation

`playerKind === 'iframe'` does **not** require `candidate URL == iframe src`. Correlation uses tab, navigation epoch, page generation, current page, visibility, and media-family evidence. Iframe src mismatch is `null`, not a hard reject.

## 11. Candidate ranking

`activeCandidateIds` holds up to 6 ranked current-generation candidates so #2/#3 can verify after #1 fails (DASH → fragment → valid HLS/progressive).

## 12. Ad / preload handling

Existing `explicitAdMarker`, poster/thumbnail/segment filters remain. Ad path markers (`vast|vmap|ima|sponsor`) reject classification. No latest-request-wins. No hardcoded Dailymotion ad-host table.

## 13. Early-network / late-owner race

Existing bounded candidate observation window (`tabId + navigationEpoch + generation + platform`) retains early HTTP candidates. Owner acquisition re-runs `selectCurrentGeneralMedia`. No Dailymotion-specific history. No timers.

## 14. Late-network / early-owner race

Owner first, candidate later: store ingest triggers correlation and the existing verify effect. Download tap also merges window + store so the first tap can resolve without reload.

## 15. Same-content generation stability

Generation follows canonical content identity (`video:{id}` when present), not raw pathname strings. Tracking query, fragment, and same-id embed/video path aliases do not bump. `/video/A` → `/video/B` does bump.

## 16. SPA path normalization

`canonicalizeGeneralContentKey` ignores fragment and tracking prefixes (`utm_`, `share`, `fbclid`, …) but still treats content query `v` / `video` as identity.

## 17. Stale token safety

Token remains `tabId + navigationEpoch + pageGeneration + currentMediaIdentity`. Same content keeps the token. New content / real navigation epoch change invalidates it. Guards were not removed.

## 18. Download tap result contract

| Outcome | User-visible result |
| --- | --- |
| Verified offer | Phase 1 enqueue |
| In-flight verify | Preparing / busy toast |
| `TRANSIENT_UNRESOLVED` | CTA stays; “Still finding a downloadable source…” |
| `NETWORK_FAILURE` | Network message |
| `PROVEN_UNSUPPORTED` | Unavailable message |
| Stale because user changed video | Abort; rebind new owner |

Auto-verify still uses silent transient mapping (`toastForResolutionOutcome` = null).

## 19. Wrong-video protection

Stale generation, wrong tab, and A→B identity mismatch still reject verify/enqueue. Related previews cannot own the current CTA.

## 20. Security / privacy

DEV traces log host class, path shape, MIME class, Range boolean, hashes — never Cookie, Authorization, signed query, or full media URLs.

## 21. Dailymotion acceptance

See `mobile/docs/testing/GENERAL-EMBEDDED-MEDIA-EXECUTION-REAL-ANDROID-ACCEPTANCE.md`.

## 22. Generic embedded acceptance

The same classifier/correlation/generation/tap contract applies to any iframe-based general site. No Dailymotion API, no host allowlist, no site-specific downloader.
