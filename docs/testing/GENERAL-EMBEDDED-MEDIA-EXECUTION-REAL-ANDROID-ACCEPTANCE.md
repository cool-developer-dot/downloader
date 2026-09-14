# General Embedded Media Execution — Real Android Acceptance

Package: `com.anonymous.vidorax`  
Platform: Android only  
Reproduction URL: `https://dai.ly/xb6huwu`  
APK: `APK_NOT_BUILT_BY_REQUEST`

All items start as **NOT_TESTED**. Record PASS / FAIL / BLOCKED on a real device.

## TEST A — Exact Dailymotion URL

Open `https://dai.ly/xb6huwu`.

Expected:

- Redirect stays inside VidoraX
- Iframe owner appears
- Download CTA appears

Status: **NOT_TESTED**

## TEST B — First Download tap

Tap Download once.

Expected:

- No silent no-op
- Current token captured
- Media candidate resolution begins/joins
- Valid current media candidate correlates
- Verification runs
- Current video enqueues if supported

Status: **NOT_TESTED**

## TEST C — Terminal logs

Expected conceptual sequence:

- `GENERAL_OWNER_ACQUIRED`
- `GENERAL_RESOURCE_OBSERVED` / `GENERAL_NETWORK_TRACE`
- `GENERAL_CANDIDATE_INGESTED`
- `GENERAL_CANDIDATE_CORRELATED`
- `GENERAL_VERIFY_STARTED`
- `GENERAL_VERIFY_SUCCEEDED`
- `GENERAL_OFFER_READY`
- `GENERAL_DOWNLOAD_ENQUEUE_ACCEPTED`

Do not require exact event naming if architecture differs.

Status: **NOT_TESTED**

## TEST D — Same video stability

Remain on the same Dailymotion video for 10s / 30s / 60s.

Expected:

- Same content identity
- No harmful `generation_changed(reason=spa_path)` churn
- CTA remains
- First Download tap still works

Status: **NOT_TESTED**

## TEST E — Related video

Tap another Dailymotion related video B.

Expected:

- Real content change
- New generation/identity
- CTA B
- B candidate
- B downloads
- A cannot enqueue

Status: **NOT_TESTED**

## TEST F — Fast A→B→C

Navigate quickly. Stop on C. Tap Download.

Expected: C only.

Status: **NOT_TESTED**

## TEST G — HLS

If the player exposes supported unencrypted VOD HLS:

Expected: Phase 5B verify + existing HLS handoff.

Status: **NOT_TESTED**

## TEST H — Unsupported DASH

If only separate DASH A/V exists:

Expected: professional unsupported. No fake file.

Status: **NOT_TESTED**

## TEST I — General embedded site

Test another iframe-based general video site.

Expected: same generic architecture. No Dailymotion-only dependency.

Status: **NOT_TESTED**

## TEST J — General top-frame video

Test a standard HTML5 MP4 page.

Expected: existing behavior unchanged.

Status: **NOT_TESTED**

## TEST K — Multiple media

Main video + related previews/ad traffic.

Expected: main current video wins.

Status: **NOT_TESTED**

## TEST L — Tab isolation

Dailymotion tab A, another general tab B.

Expected: active tab media/CTA only.

Status: **NOT_TESTED**

## TEST M — TikTok / Instagram smoke

Manual smoke only.

- TikTok still works as before
- Instagram still works as before

Status: **NOT_TESTED**

## TEST N — Privacy

No logs containing:

- Cookie values
- Authorization
- signed query
- full media URL
- password
- OTP
- requestContext secrets

Status: **NOT_TESTED**
