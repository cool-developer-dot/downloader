# TikTok MSE / blob source correlation

## Real Android evidence

TikTok `/foryou` stayed in VidoraX. Native-app schemes were blocked. The Download CTA appeared. Logs showed:

- `contentType = tiktok_feed_video`
- `contentIdHash = null`
- `isBlob / mseBlob = true`
- `candidateFingerprintHash = null`
- `[IGRuntime:playback] mseBlob`
- `[PageFlow:timeout]`
- CTA tap: “This video isn't available to download.”

## Why contentIdHash was null

`extractTikTokContentIdentity` only reads the **top-level URL**. `/foryou` is a feed surface, not `/@user/video/{id}`, so `canonicalContentId` stayed null. Diagnostics hashed only `canonicalContentId`. Feed-item `/video/{id}` links were under-walked in the injected observer (depth 8, no self-`<a href>`).

`syncFromPageUrl` on CTA verify re-applied `/foryou` identity and **wiped** a stronger item id already bound from the player.

## Why candidateFingerprintHash was null

**B. Requests observed at WebView but rejected too early.**

TikTok MSE uses extensionless CDN URLs (`/video/tos/…`, Range). 

- Injected `looksMedia` required `.mp4`/`.m3u8`/…
- `MediaNetworkBridge` required `.mp4` **or** `Accept: video/`
- `parseProgressiveMediaUrl` / `isSupportedMediaUrl` required an extension or media MIME

Those gates dropped the actual playback objects. Blob `currentSrc` is a clue only and never a candidate — so correlation had **nothing HTTP to attach**.

## PageFlow timeout

`PageFlow:timeout` is the **paste/page-resolution watcher** waiting for a verified offer. It fired because no executable candidate was ingested — not because the timeout was too short. Fix is ingest + identity, not a longer timer.

## IGRuntime on TikTok

Shared/legacy logger name (`logIgRuntime`) used for all WebView playback/network events. Not Instagram-specific routing of TikTok. Payload now notes `logger: 'shared'`.

Fixes: deeper DOM `/video/{id}` extraction; preserve feed item identity across `/foryou` sync; observe TikTok CDN/Range/tos URLs in JS + native; parse extensionless tos objects; demote late blob-era CDN fetches as preload; do not clear detections on identity upgrade; CTA tap correlates HTTP store candidates instead of handing `blob:` to Phase 1.
