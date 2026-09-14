# Phase 5A — General Website Media Discovery, Ownership & False-Positive Filtering

**Status:** code/static complete — ready for manual Android device test  
**Owns:** which media on an ordinary website belongs to the current page/player the user means  
**Does not own:** downloadability proof, HEAD/Range verification, HLS parsing, quality ranking, CTA redesign, Phase 1 download (Phase 5B / existing layers)

---

## Audit findings (pre-implementation)

### Existing pipeline

```
DOM / fetch / XHR / PerformanceObserver / native observe
  → candidate detection (mediaDetectionPipeline)
  → scoreMediaCorrelation / pickBestCorrelatedMedia   ← generic pages (pre-5A)
  → Phase 4A social ownership                          ← IG/TT only
  → verify / CTA
```

### Answers to audit questions

| # | Question | Finding |
|---|---|---|
| 1 | Observers for ordinary sites? | Yes — DOM, fetch, XHR, PerformanceObserver, native, blob indicator, active_video (all pages) |
| 2 | Social-specific? | Content identity, socialPageContextStore, correlateSocialCandidate, 4B offer path |
| 3 | Reusable? | Observers, pipeline, dedupe, FP filters, ActiveVideoEvidence, epoch guards |
| 4 | Ownership today? | Social → 4A; else score/size/network via pickBestCorrelatedMedia |
| 5 | Latest/largest on general? | **Yes** — score boosts size/dims/network |
| 6 | Poster/image filter? | MIME/ext FP + social thumbnail helpers; not ownership-ranked on general |
| 7 | `.ts`/`.m4s`? | Upstream `isLikelyMediaSegment` / FP filter |
| 8 | Blob? | Indicator / MSE only — never downloadable |
| 9 | Preload steal CTA? | **Yes on general** (pre-5A); suppressed on social |
| 10 | Ads steal ownership? | **Yes on general** (pre-5A); partial structural markers on social |
| 11 | Same element new source? | MutationObserver + social recycled bump; general lacked generation |
| 12 | SPA history? | Chrome + media injectors; social content-id clear; general path weak |
| 13 | Tab isolation? | Parked `isActive` gate; social Map; media store global |
| 14 | Stale async? | navigationEpoch; social contextGeneration |
| 15 | Bounded maps? | Yes (80/page, 8 social tabs, etc.) |
| 16 | Polling? | PerfObserver fallback interval only; active_video debounced |

### Root ownership risks (general pages)

1. High-scoring preload / network candidate could beat visible player  
2. Poster/thumbnail could compete if miscategorized  
3. Ad autoplay could win by size/recency  
4. Tiny muted background loops could outrank paused main player  
5. SPA article/player changes lacked pageGeneration invalidation  
6. Active-video evidence collected but ignored outside social hosts  

---

## Final Phase 5A architecture

```
EXISTING OBSERVERS (unchanged pipeline ingest)
        ↓
COMMON CANDIDATE MODEL (DetectedMedia)
        ↓
PAGE/PLAYER OWNERSHIP CORRELATION (Phase 5A)
        ↓
CurrentGeneralMediaContext + CorrelatedGeneralMediaCandidateSet
        ↓
(Phase 5B later: is it downloadable?)
```

**Not created:** parallel detector, separate media store, website mega-detector.

Social Phase 4A remains the specialized adapter for Instagram/TikTok.  
Phase 5A is the platform-neutral ownership layer for ordinary websites.

### Modules

| Module | Role |
|---|---|
| `general-media/types.ts` | `GeneralPageMediaContext`, confidence, rejection reasons |
| `general-media/general-page-context.ts` | Ephemeral tab-scoped context + `pageGeneration` |
| `general-media/general-correlation.service.ts` | Ownership ranking + FP policies |
| `general-media/general-media-diagnostics.ts` | Safe `[GeneralMedia]` DEV logs |
| Engine wiring | Sync/clear/SPA + active_video → general store |
| `useMediaDiscovery` | Non-social → `selectCurrentMediaForActiveGeneralTab` |

---

## General page media context

```ts
GeneralPageMediaContext {
  tabId
  navigationEpoch
  pageGeneration
  pageUrl
  activeMediaElementIdentity?
  activeMediaResourceIdentity?
  currentMediaIdentity?
  activeVideo* evidence fields
  userInteractionSignal
  explicitAdMarker
  observedAt
}
```

- In-memory only (never MMKV / SQLite / disk / backend)  
- Per-tab, max 8 tab contexts (LRU evict non-active)  
- One previous generation snapshot per tab  

---

## Page / media generation model

| Event | Effect |
|---|---|
| Full navigation (`navigationEpoch` change) | Bump `pageGeneration`, clear active ownership |
| SPA path change (same epoch) | Bump generation, clear ownership, clear page detections |
| Recycled `<video>` new resource path | Bump generation |
| Signed query refresh same path | **No** bump |
| Duplicate active_video | Deduped in page; selection stable |

Old callbacks capture `tabId` + `navigationEpoch` + `pageGeneration` — stale work is ignored.

---

## Active player evidence

Reuses injected Phase 4A signals (generic on all pages):

- `currentSrc` / `src`  
- play / playing / pause / loadeddata (not `timeupdate`)  
- IntersectionObserver (single shared observer, bounded tracked videos)  
- viewport distance, displayed/visibility  
- muted, intrinsic width/height  
- explicit structural ad markers  
- recent-play window  

Tiny muted loops receive a soft score penalty in `pickBestActiveVideo` so they do not outrank a main player.

---

## Visibility / intersection model

- Shared `IntersectionObserver` with thresholds `[0, 0.25, 0.5, 0.75, 1]`  
- Ratio ≥ 0.35 supports visible ownership  
- Ratio < 0.15 + paused + non-matching src → hidden/preload penalties  
- Intersection is evidence, not sole criterion  

---

## User interaction evidence

- `recentlyPlayed` / non-paused + displayed → `userInteractionSignal`  
- Strengthens STRONG rank when matching currentSrc  
- Observation only — does not intercept site controls  

---

## Candidate confidence model

| Band | Meaning |
|---|---|
| **STRONG** | Tab+epoch OK, currentSrc match, visible/active |
| **MEDIUM** | Page match + visibility/src or blob→network clue |
| **WEAK** | Same page without strong ownership; tiny preview capped here |
| **REJECTED** | Wrong tab, stale, poster, thumb, segment, blob-only, ad, preload, scheme |

Legacy `scoreMediaCorrelation` folds lightly into rank **inside** a band — never sole winner.

---

## Current-media promotion policy

1. Prefer STRONG > MEDIUM > WEAK  
2. WEAK never displaces STRONG/MEDIUM  
3. Same band → ownership-weighted rank (not size alone)  
4. Latest URL / largest Content-Length / highest resolution **never** win alone  

---

## Poster / image policy

Reject final ownership for:

- `image/*` MIME  
- jpg/jpeg/png/webp/gif/avif/svg/ico/bmp  
- path heuristics: poster, thumb, sprite, preview_image  

Poster may remain supporting metadata (`thumbnailUrl`) — never current video.

---

## Thumbnail policy

Reject thumbnail CDN / path patterns and social thumbnail helpers when used as candidates.

---

## Preload policy

When an active visible player exists with a known non-blob currentSrc, other resources are treated as preload/neighbor (`OFFSCREEN_PRELOAD`) and cannot replace STRONG current media.

---

## Tiny preview policy

**No** `duration < 5s → reject`.

Combined evidence required:

- Small intrinsic or rendered dimensions  
- Muted autoplay / low interaction  
- Weak intersection  

→ Cap at WEAK (`TINY_PREVIEW`), never STRONG.

---

## Advertisement policy

**No** giant hardcoded ad-domain list.

Uses explicit/structural `explicitAdMarker` from DOM heuristics (aria/sponsored/ad wrappers).  
Ads cannot win by size or recency alone. Uncertain ad status → no fabricated certainty.

---

## Segment policy

`.ts` / `.m4s` / `.cmfv` / chunk/segment path heuristics → `SEGMENT_RESOURCE` / non-final.  
May later clue Phase 5B stream correlation — never current downloadable media in 5A.

---

## Blob policy

`blob:` never final execution URL.  
Blob active player + http(s) observations → correlate as clue (MEDIUM floor).  
Never sent to Phase 1 as download URL.

---

## SPA navigation

Injected: `pushState` / `replaceState` / `popstate` → rescan + active_video.  
Engine: same-origin SPA path updates sync general context, bump generation, clear stale detections.  
No full DOM `querySelectorAll` every second.

---

## Recycled player handling

Same `elementIdentity` + different host+pathname currentSrc → ownership change + generation bump.  
Query-only signed CDN refresh → same media identity.

---

## Source mutation handling

MutationObserver on `src`/`type`/`poster`, emptied/loadstart via media events, play/loadeddata.  
No continuous polling of `currentSrc`.

---

## Stale callback safety

Guards: wrong tab, wrong `navigationEpoch`, `isStaleGeneration`, closed-tab no-op (does not recreate).  
Async enrichment already epoch-gated in the engine.

---

## Tab isolation

Contexts keyed by `tabId`. Selection requires matching `tabId`.  
Parked WebViews still drop media `onMessage` when inactive.  
Callbacks never re-resolve ownership via `getActiveTabId()` at completion.

---

## Tab close

`cleanupClosedTab` → `generalPageMediaContextStore.clearTab`  
Late evidence → no-op.

---

## Navigation clearing

New document URL → clear detections + sync context (generation bump).  
Back navigation rediscovers from fresh observations — no blind re-inject of stale A.

---

## Home / error clearing

`onGoHome` / `onBrowserError` → clear general (and social) tab context + page detections.

---

## Dedupe

- Injected `lastActiveVideoKey` skips duplicate active_video posts  
- Pipeline `dedupeUpsert` for candidates  
- Selection stable across duplicate observer events  

---

## Memory bounds

| Bound | Value |
|---|---|
| Tab general contexts | 8 |
| Previous generations / tab | 1 |
| Detected media / page | 80 (`DETECTION_TIMING`) |
| Tracked videos in page | 12 |
| Injected post budget | 400 |

---

## Performance

- Event-driven (IO, media events, MutationObserver, history hooks)  
- Debounced/coalesced active_video flush  
- No Phase 5A `setInterval`  
- No network verification storm in 5A  

---

## Security

- No credential interception/storage  
- Diagnostics hash/sanitize URL identities  
- Never log cookies, Authorization, signed query strings  
- No backend / proxy / DRM / paywall bypass  

---

## Known limitations

1. Without any active_video evidence yet, ownership falls to WEAK page-level candidates  
2. Ambiguous multi-player pages without clear visibility may need user focus (`focusedMediaId`)  
3. Ad detection is structural-marker only — uncertain ads are not claimed  
4. Phase 5A does not prove the URL is downloadable  
5. MSE/blob sites still need Phase 5B for executable http(s) selection  

---

## Manual acceptance plan

Mark **NOT_TESTED** unless manually run on device.

| # | Scenario | Expected | Status |
|---|---|---|---|
| 1 | Simple HTML5 MP4 page | Visible playing video → current media STRONG | NOT_TESTED |
| 2 | Multiple `<video>` elements | Meaningful/visible player wins | NOT_TESTED |
| 3 | Main video + thumbnail cards | Thumbnails never current video | NOT_TESTED |
| 4 | Autoplay background video | Tiny muted loop does not beat main | NOT_TESTED |
| 5 | Preload next video | Preload does not steal CTA | NOT_TESTED |
| 6 | HLS segment traffic | `.ts`/`.m4s` not final current media | NOT_TESTED |
| 7 | Blob-backed player | Blob clue only; http(s) correlated | NOT_TESTED |
| 8 | SPA player A→B | Generation bump; stale A ignored | NOT_TESTED |
| 9 | Carousel reused player A→B→C | Ownership follows currentSrc path | NOT_TESTED |
| 10 | Cross-tab two video sites | Tab isolation; no cross-assign | NOT_TESTED |

---

## Phase 5B handoff

Phase 5A outputs:

- `GeneralPageMediaContext`  
- `CorrelatedGeneralMediaCandidateSet` (owned candidate ids + confidence)

Phase 5B should consume that set to answer:

> “Which owned URL is actually downloadable?”

…via HEAD/Range, MIME/container, HLS/DASH top-level proof, freshness — **without** reopening ownership ranking.

---

## Verifier

```bash
cd mobile
npm run verify:phase5a-general-media-discovery
```

Script: `scripts/verify-phase5a-general-media-discovery.ts`
