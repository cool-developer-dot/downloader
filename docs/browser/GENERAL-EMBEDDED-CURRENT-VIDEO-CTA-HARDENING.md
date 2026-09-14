# General Embedded Current-Video CTA Hardening

**Status:** code/static complete — ready for real Android acceptance  
**Reproduction:** `https://dai.ly/xb6huwu` (video visibly playing, Download CTA missing)  
**Scope:** Phase 5 general / embedded player ownership + CTA presentation  
**Not in scope:** TikTok/Instagram Phase 4, Phase 1 transfer, Pause/Resume, Dailymotion API

---

## 1. Real Dailymotion reproduction

On Android, opening `https://dai.ly/xb6huwu`:

1. WebView follows the HTTP redirect to `https://www.dailymotion.com/video/xb6huwu` (internal).
2. The Dailymotion page plays video normally.
3. VidoraX showed **no Download CTA**.

SSR HTML of the final page contains **zero top-level `<video>` tags**. The player is loaded from `https://geo.dailymotion.com/player/xtv3w.js` / `.html` into `#player-wrapper` (initially `visibility:hidden`). The playable `<video>` lives in a **cross-origin iframe** (`geo.dailymotion.com` ≠ `www.dailymotion.com`).

---

## 2. Exact root cause

**H. IFRAME_PLAYER_NOT_OBSERVED → A. CURRENT_VIDEO_NOT_DISCOVERED → B. GENERAL_OWNER_NOT_CREATED → F. CTA_PRESENTATION_SUPPRESSED**

Pre-fix pipeline:

- Injected observer only queried top-document `video` / `audio`.
- MutationObserver did not schedule the active-player flush (only DOM candidate scan).
- `active_video` never fired on Dailymotion.
- `generalPageMediaContextStore.currentMediaIdentity` stayed null.
- CTA shell requires a STRONG/MEDIUM live owner identity (`resolveCtaShellPresentation` → `TRACKING_CURRENT_VIDEO`).
- No owner ⇒ `HIDDEN`. Verified-offer `READY` also did not appear (no correlated executable candidate bound to a current owner).

This is a **generic embedded-player gap**, not a Dailymotion-API gap.

---

## 3. Phase 5 pre-fix pipeline

```
BrowserWebView
  → injected observer (top frame)
  → document.querySelectorAll('video')     ← empty on Dailymotion
  → active_video                           ← never posted
  → applyActiveVideoEvidence               ← never
  → currentMediaIdentity = null
  → liveOwner confidence = null
  → resolveCtaShellPresentation → HIDDEN
```

Network observers (fetch/XHR/PerformanceObserver/native `shouldInterceptRequest`) could still see iframe media URLs, but **presentation does not require a verified offer** — it requires a current owner. Owner creation was the missing edge.

---

## 4. Player structure

Proven from the live `dai.ly` → Dailymotion HTML:

| Candidate | Result |
|---|---|
| A. top-level `<video>` | **No** (0 `<video>` in top document) |
| B. same-origin iframe | **No** (player host is `geo.dailymotion.com`) |
| C. cross-origin iframe | **Yes** — geo player document |
| D. shadow DOM on top page | Not required to explain the miss |
| E. custom div with hidden `<video>` | Placeholder script wrapper only |
| F. MSE/blob inside iframe | Typical for this player; blob stays clue-only |
| G. other | Redirect + hidden wrapper until hydrate |

---

## 5. Iframe behavior

- Injected JS still runs in the **top frame** (no cross-origin DOM read).
- Same-origin iframes: bounded `contentDocument` video collection (try/catch).
- Cross-origin iframes: **geometry + src/allow heuristics + IntersectionObserver**.
- Native `shouldInterceptRequest` already sees **all frames**; `WebView.getUrl()` is the main document, so iframe media requests stay associated with the page URL.

---

## 6. First-video discovery

- One bounded `scanDom()` + `flushActiveVideo()` at observer install.
- `MutationObserver` now also `scheduleActiveVideo()` so a player iframe inserted after hydrate is seen **without polling**.
- IntersectionObserver on iframes fires when the hidden `#player-wrapper` becomes visible.
- No `setInterval` iframe scan. No per-second DOM walk.

---

## 7. General owner model

Ephemeral `GeneralPageMediaContext` (unchanged store; extra fields only):

```
tabId, navigationEpoch, pageGeneration, pageUrl
currentMediaIdentity, ownerStrength
playerKind: 'video' | 'iframe'
frameClass: 'top' | 'same-origin' | 'cross-origin'
iframeIdentity?
active video evidence (blob remains clue-only)
```

Visible current player on the active tab/page generation → STRONG/MEDIUM owner → CTA shell. Verification is **not** required to show the button.

---

## 8. General content identity

Generic public path/query extraction only (not a site table):

- `/video/{id}`, `/watch/{id}`, `/embed/{id}`, `/media/{id}`
- `?video=` / `?v=` when the value looks like a public id (5–32 `[A-Za-z0-9_-]`)
- `/player/{widgetId}` is **not** treated as content id (player chrome)

`https://www.dailymotion.com/video/xb6huwu` → `video:xb6huwu`.  
Signed query and blob URLs are never identity.

---

## 9. MSE / blob handling

Unchanged contract:

- blob `currentSrc` may create/keep a current owner
- blob is never an executable Phase 1 URL
- underlying http(s) candidates may still correlate

Iframe players often use MSE inside the child frame; the top-frame owner is the iframe, not the blob.

---

## 10. Network observation

Unchanged observers: fetch, XHR, PerformanceObserver, native WebView hook, `video.src` / `<source>`.

Iframe media is primarily visible via **native** observation (all frames). Injected fetch/XHR cannot see the cross-origin player’s JS context.

---

## 11. HLS observation

Existing `.m3u8` / mpegurl MIME / `#EXTM3U` verification is unchanged.  
Iframe owner + same-page HLS candidate → MEDIUM correlation floor (iframe `currentSrc` is the player document, not the manifest).

---

## 12. DASH boundary

Unchanged: separate DASH A/V requiring mux is `DASH_UNSUPPORTED`. No FFmpeg. A combined progressive candidate may still win independently.

---

## 13. Multiple-player arbitration

- Displayed non-preview `<video>` still beats iframe.
- Tiny/preview videos are demoted so they do not hide a visible iframe player.
- Hidden / offscreen / tiny preview must not become a strong owner.
- Active tab only; parked WebView cannot apply owner.

---

## 14. Ad / content distinction

Unchanged structural `explicitAdMarker` penalty. Ads are not auto-promoted to current content. If ad vs content cannot be proven, VidoraX does not fake a content download.

---

## 15. CTA presentation

```
current general owner (identity + MEDIUM/STRONG)
  → TRACKING_CURRENT_VIDEO
  → BrowserMediaDownloadBar on next React render
```

`useBrowserMediaAction` already subscribed to `generalPageMediaContextStore`. Owner apply notifies listeners → `ownerRevision` → live owner recalculated.

---

## 16. Presentation vs execution

| Layer | Requirement |
|---|---|
| Presentation | current general owner |
| Execution | verified supported non-DRM source + current token |

Tap captures `tabId` + epochs + `currentMediaIdentity`, ranks current candidates, verifies, re-checks token, then Phase 1 enqueue.

---

## 17. React store propagation

```
applyActiveVideoEvidence / applyActiveIframePlayerEvidence
  → notifyOwnerListeners()
  → generalPageMediaContextStore.subscribe
  → ownerRevision
  → liveOwner + resolveCtaShellPresentation
  → BrowserMediaDownloadBar
```

No component-local fake owner state.

---

## 18. Tab isolation

Inactive tab evidence is ignored (`WRONG_TAB`). CTA uses the active tab’s context only.

---

## 19. No-polling architecture

Event-driven: MutationObserver, IntersectionObserver, media events, navigation hooks, one initial scan. Existing coalesced `setTimeout` flush is debounce, not a 1s watchdog.

---

## 20. Security boundaries

- No cross-origin iframe DOM bypass
- No DRM / encrypted-HLS bypass
- No Dailymotion API / backend / remote resolver
- Iframe `src` posted without query tokens
- Diagnostics hash identities; never log Cookie, Authorization, signed query, OTP, requestContext

---

## 21. Dailymotion manual acceptance

See `mobile/docs/testing/GENERAL-EMBEDDED-CURRENT-VIDEO-CTA-REAL-ANDROID-ACCEPTANCE.md` (all items NOT_TESTED).

---

## 22. Generic general-site acceptance

Any ordinary site whose current player is:

- a top-level visible `<video>`, or
- a same-origin iframe with inner `<video>`, or
- a **visible player-like iframe** (`/embed|/player|/video|/media|/watch/` + size, or large allowfullscreen/autoplay) plus page/player identity

should show the native Download CTA for the current owner. Download still requires a supported source.
