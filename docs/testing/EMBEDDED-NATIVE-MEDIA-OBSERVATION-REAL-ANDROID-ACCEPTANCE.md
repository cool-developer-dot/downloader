# Embedded Native Media Observation — Real Android Acceptance

Package: `com.anonymous.vidorax`  
Platform: Android only  
Reproduction URL: `https://dai.ly/xb6huwu`  
APK: `APK_NOT_BUILT_BY_REQUEST`  
Native: `NATIVE_REBUILD_REQUIRED_FOR_MANUAL_TEST`

Metro-only JS reload is **not** sufficient. Kotlin / WebView observation changes require a rebuilt Android binary.

All items start as **NOT_TESTED**. Record PASS / FAIL / BLOCKED on a real device.

Do not log full media URLs, signed query, Cookie, Authorization, or tokens. Use host class, path class, fingerprint, and boolean flags.

---

## TEST A — Dailymotion load

Open `https://dai.ly/xb6huwu`.

Expected:

- Page stays inside VidoraX
- Cross-origin iframe owner is acquired (`GENERAL_OWNER_ACQUIRED`)
- Download CTA appears (existing behavior; do not regress)

Status: **NOT_TESTED**

---

## TEST B — Playback network trace

Play the current video.

Expected sanitized Metro chain for media-like traffic:

- `GENERAL_NETWORK_TRACE` `stage=RESOURCE_SEEN`
- `GENERAL_NETWORK_TRACE` `stage=NATIVE_EMITTED`
- `GENERAL_NETWORK_TRACE` `stage=JS_RECEIVED`

Same `candidateFingerprintHash` / `resourceFingerprint` may be used to join events. No full URL.

If **no** `RESOURCE_SEEN` appears after playback:

- Record whether `OBSERVER_STARTED` showed `modulePresent=true`
- Record whether any `RESOURCE_REJECTED` reasons appeared (`OBSERVER_DISABLED`, `NO_MEDIA_EVIDENCE`, `SEGMENT`, …)
- Record `observationSource` if present (`webview` vs `service-worker`)
- This is a WebView / Chromium media-stack visibility limit, not a CTA bug

Status: **NOT_TESTED**

---

## TEST C — Candidate

After playback media-like traces exist:

Expected:

- `CANDIDATE_INGESTED`
- `CANDIDATE_CORRELATED` (or `GENERAL_CORRELATION_TRACE`)

Iframe owner must **not** require candidate URL == iframe src.

Status: **NOT_TESTED**

---

## TEST D — Verification

Expected:

- `VERIFY_STARTED`
- then `VERIFY_SUCCEEDED` for progressive / unencrypted VOD HLS

**OR**

- `VERIFY_REJECTED` with an exact supported reason such as `DASH_UNSUPPORTED`

HTML / JSON / image / player document must not verify as media.

Status: **NOT_TESTED**

---

## TEST E — First Download tap

Tap Download **once**.

Expected if a supported source verified:

- Phase 1 enqueue
- `ENQUEUE_ACCEPTED`

Expected if the only observed source is unsupported (for example DASH mux required):

- Professional unsupported message
- Not an endless `NO_FRESH_SOURCE` after media traffic was observed and classified

Expected if media traffic was **not** observed at all:

- `TRANSIENT_UNRESOLVED` / “Still finding a downloadable source” remains valid
- Document TEST B failure as the root cause

Status: **NOT_TESTED**

---

## TEST F — 30 second stability

Stay on the same video.

Expected:

- Same content identity / generation (`SAME_CONTENT_IGNORED` for chrome churn)
- CTA remains
- Correlated candidate remains associated

Status: **NOT_TESTED**

---

## TEST G — Related video

Open a different video B.

Expected:

- New content id
- New owner
- New candidates
- Video A cannot enqueue

Status: **NOT_TESTED**

---

## TEST H — Another general embedded iframe site

Open a non-Dailymotion iframe player site.

Expected:

- Generic observation + correlation still works (not a Dailymotion-only hook)

Status: **NOT_TESTED**

---

## TEST I — Top-frame MP4

Existing general MP4 site remains downloadable.

Status: **NOT_TESTED**

---

## TEST J — Social smoke

TikTok and Instagram:

- Existing CTA / correlation / download behavior unchanged

Status: **NOT_TESTED**

---

## Outcome classification (fill after TEST B–E)

Mark exactly one or more, from device evidence:

- **A.** WebView never exposes playback media to `shouldInterceptRequest` / ServiceWorkerClient
- **B.** Exposed, but native prefilter drops it (`RESOURCE_REJECTED` reason)
- **C.** Native emits, JS never receives (`NATIVE_EMITTED` without `JS_RECEIVED`)
- **D.** JS receives, classifier rejects
- **E.** Candidate created, correlation rejects
- **F.** Correlates, Phase 5B verification rejects
- **G.** Only unsupported DASH / encrypted media observed

Observed playback format (do not guess): progressive / HLS / DASH / encrypted / multiple / unknown

Status: **NOT_TESTED**
