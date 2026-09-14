# Phase 4A — Social Correlation (TikTok + Instagram)

**Status:** code/static complete — ready for manual Android device test  
**Owns:** current social content identity, active-video ownership, candidate correlation  
**Does not own:** download reliability, signed URL recovery, quality redesign, CTA redesign, Phase 1 worker

---

## Audit findings (pre-implementation)

### Existing pipeline

```
DOM / fetch / XHR / PerformanceObserver / native observe
  → candidate detection (mediaDetectionPipeline)
  → scoreMediaCorrelation / pickBestCorrelatedMedia
  → verifyMediaCandidate
  → browserMediaActionService CTA
```

### Gaps that caused wrong-media risk

| Question | Finding |
|---|---|
| Content ID for IG/TT? | **Missing** — adapters only set `isPublicContentPath` |
| Active/visible `<video>` evidence? | **Missing** — DOM sent src/dims only |
| Social context generation? | **Missing** — only global `navigationEpoch` |
| Ranking rule? | Score boosts size/dims/network → preload could win |
| TabId on observations? | **No** — global engine; parked tabs drop `onMessage` via `isActive` |
| SPA awareness? | Chrome `spa_navigation` + injected history hooks; media cleared on path change |
| Ads distinguishable? | **No** reliable markers |
| Blob | Indicator only; rejected as downloadable (Phase 3E preserved) |
| `.ts` / `.m4s` | Rejected upstream (`false-positive.filter`) |
| Latest URL wins? | Possible via score + insert order before 4A |

### Phase 3 invariants preserved

- Max 8 tabs / max 2 mounted WebViews  
- Parked WebView `isActive` media gate  
- Desktop per-tab  
- BrowserFailure / Home CTA clear  
- Consumed fingerprint suppression  
- Blob-only never downloadable  

---

## Final architecture

```
CURRENT SOCIAL CONTENT (route / DOM id)
        ↓
ACTIVE / VISIBLE PLAYER (bounded active_video evidence)
        ↓
CORRELATED MEDIA OBSERVATIONS (ownership confidence)
        ↓
CURRENT CANDIDATE GROUP → existing verify → CTA
```

**Not:** latest MP4 / largest file / highest bitrate as sole selection.

### Modules

| Module | Role |
|---|---|
| `social/instagram-content-identity.ts` | `/reel/`, `/p/`, `/tv/` shortcodes; feed without fabricated id |
| `social/tiktok-content-identity.ts` | `/@user/video/{id}` |
| `social/social-page-context.ts` | Ephemeral tab-scoped context + generation |
| `social/social-correlation.service.ts` | Platform-neutral ownership ranking |
| Injected `active_video` | Cheap visibility / play / currentSrc evidence |

---

## Content identity vs resource identity

- **Content identity:** `instagram:instagram_reel:ABC123` or `tiktok:tiktok_video:7123…`  
- **Resource identity:** CDN URL / manifest / progressive MP4  
- Same Reel + refreshed signed CDN URL → **same content identity**  
- New Reel/video id → **new context generation**

---

## Instagram rules

| URL | contentType | canonicalContentId |
|---|---|---|
| `/reel/{code}` | `instagram_reel` | `{code}` |
| `/p/{code}` | `instagram_post` | `{code}` |
| `/` or `/reels/` | `instagram_feed_video` | `null` (ephemeral if needed) |

Never: host-alone → “always Reel”; never CDN/poster as identity.

---

## TikTok rules

| URL | contentType | id |
|---|---|---|
| `/@user/video/{id}` | `tiktok_video` | `{id}` |
| FYP / profile without id | `tiktok_feed_video` | `null` |

SPA pushState/replaceState + `active_video` can bump `contextGeneration` without full reload.

---

## Confidence model

| Level | Meaning |
|---|---|
| **STRONG** | Tab/nav match + active visible `currentSrc` match |
| **MEDIUM** | Visible/active player or blob-player + underlying http(s) |
| **WEAK** | Same page network-only |
| **REJECTED** | Wrong tab/nav, preload neighbor, hidden, image, segment, blob-only, ad |

**Policy:** WEAK never replaces STRONG/MEDIUM.

---

## Preload / neighbor / recycle / ads / blob

- Neighbor CDN observed while A is visible/active → `OFFSCREEN_PRELOAD` / reject for current  
- Same DOM node + new `currentSrc` path → ownership update + generation bump  
- Explicit Sponsored/aria ad markers → cannot replace organic without content transition  
- Blob = active player **clue only**; never final download source  

---

## Tab isolation & parked WebViews

- Context keyed by `tabId`  
- Active tab bound via `mediaDetectionEngine.setActiveTab`  
- Parked WebViews: `BrowserWebView` drops media messages when `!isActive`  
- Tab close → `socialPageContextStore.clearTab`  
- Home / BrowserFailure → social context cleared  

---

## Memory / performance / security

- Max 8 tab contexts; 1 previous generation snapshot  
- No MMKV/SQLite/disk persistence of social context or signed URLs  
- Event-driven (MutationObserver / IntersectionObserver / play / SPA) — no 1s polling, no timeupdate flood  
- WebView payloads validated (types, lengths, schemes)  
- Diagnostics: `[SocialCorrelation]` — hashes only, never cookies/Authorization/full signed URLs  

---

## Known limitations

1. Feed surfaces without route id rely on ephemeral + active-video evidence (lower confidence).  
2. Ad detection is explicit-marker only — not a CDN blocklist.  
3. Global detection store still rebuilds on tab switch (Phase 3 behavior).  
4. Signed URL expiry recovery is **Phase 4B**.  
5. Final TikTok/Instagram download success is **not** claimed by 4A.

---

## Manual acceptance plan

| # | Case | Expected |
|---|---|---|
| 1 | Open `/reel/A` | Content id A; correlated current video |
| 2 | Swipe A→B | Context generation advances; B current |
| 3 | A visible, B preload | B not current |
| 4 | TikTok `/@u/video/123` | Content id 123 |
| 5 | TikTok 123→456 | 456 current |
| 6 | IG tab + TT tab | No cross-leak |
| 7 | Same item, new CDN URL | Same content id |
| 8 | Extra video request while watching | Current item remains owner |

Do not mark device PASS without real APK testing.

---

## Verifier

```bash
cd mobile
npm run verify:phase4a-social-correlation
```
