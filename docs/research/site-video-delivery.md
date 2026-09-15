# How major sites deliver video to an Android WebView (2026), and a detection design for VidoraX

## 0. Summary

- **The big social sites (Instagram, Facebook, TikTok, X) put the playable URLs in JSON**, not in the `<video>` tag. The page receives that JSON through GraphQL/API responses or embeds it in the HTML.
  - In each case one of those URLs is a complete progressive MP4 with audio: `video_versions`, `browser_native_hd_url` / `progressive_urls`, `playAddr` / `bitrateInfo`, and X's `video/mp4` variants.
  - What the player actually streams is usually separate video and audio: DASH via MSE on Meta, split-audio HLS on X.
  - So the best strategy is to read the JSON the page already receives, inside the page, rather than sniffing media URLs.
- **VidoraX currently throws that JSON away.**
  - The native filter drops `/api`, `/graphql` and `.json` requests: `MediaNetworkBridge.kt:59-75` and `:221-245`.
  - The injected fetch/XHR hooks record only the URL and content-type, never the body: `src/media-detection/observers/injected-script.ts:516-562`.
  - The MSE hook only flags that a blob exists: `injected-script.ts:564-578`.
- **Many other sites (Reddit, Vimeo, Pinterest, split-audio HLS, generic DASH) need muxing.** FFmpegKit is retired and its binaries were pulled in April 2025. The practical on-device option is Media3's extractors plus `media3-muxer` (`Mp4Muxer`), which has been a standalone module since 1.8.0.
- **YouTube:** plain URL capture no longer works. Playback is SABR (POST requests with a protobuf body, UMP-framed responses) and needs PO tokens. Downloading also breaks YouTube's Terms of Service and is a Google Play policy risk. **Recommendation: refuse YouTube explicitly.**
- **MSE capture** (hooking `SourceBuffer.appendBuffer`) is the only universal fallback for obscured players. Its limits:
  - It needs the video to play through.
  - It gives two tracks that must be muxed.
  - It fails on DRM and on MSE running inside a worker.
  - On Android it needs real document-start, all-frames injection (`WebViewCompat.addDocumentStartJavaScript`) and a binary channel (`addWebMessageListener` with ArrayBuffer). The app has neither today.

---

## 1. Per-site table

"A/V split?" means the best-quality stream has separate audio and video tracks.

| Site | How it's delivered (2026) | Where the URLs live | A/V split? | Headers / cookies / login | Recommended extraction |
|---|---|---|---|---|---|
| **Instagram** (reels, posts, stories) | DASH MPD: video H.264 (VP9 rolling out since Apr 23 2026), audio HE-AAC `mp4a.40.5`. Progressive MP4s also listed in `video_versions`. Player uses MSE (UNVERIFIED for the Android Chrome UA specifically). | GraphQL `/graphql/query` → `xdt_shortcode_media`; `/api/v1/media/{id}/info/` → `items[0].video_versions[]` and `video_dash_manifest` (inline MPD XML); embed page `video_url`; stories via `/feed/reels_media/` or GraphQL. | `video_versions`: usually has audio (yt-dlp sets `acodec: none` only when `has_audio == false`). DASH: always split. | API calls send `X-IG-App-ID: 936619743392459`, `X-ASBD-ID`, `X-FB-LSD`, `X-CSRFToken`. Since Jun 2026, anonymous API calls without a real browser TLS fingerprint are blocked. Stories and private posts need login. CDN URLs are signed (`oh` HMAC, `oe` hex expiry; TTL varies, UNVERIFIED). | Hook fetch/XHR response bodies in the page. Take the largest `video_versions` entry when `has_audio !== false`. Otherwise take best video and best audio from the MPD, download each representation, and mux. MSE capture is the fallback. **Don't replay the API from OkHttp** (fingerprint blocks). |
| **Facebook** (reels, watch, fb.watch) | Progressive (SD/HD, with audio) plus DASH (split) plus some HLS. Meta's player fetches ranges with `bytestart`/`byteend` query params instead of `Range` headers, to avoid CORS preflight. A Facebook engineer described this in 2017; UNVERIFIED that it still holds in 2026. | Legacy: `browser_native_hd_url` / `browser_native_sd_url`, `playable_url`, `playable_url_quality_hd` (`videoDeliveryLegacyFields`). Newer: `videoDeliveryResponseFragment/Result` → `progressive_urls[].progressive_url`, `dash_manifests[].manifest_xml`, `dash_manifest_urls`, `hls_playlist_urls`. Data sits in `<script data-sjs>` (ScheduledServerJS → `__bbox` → `RelayPrefetchedStreamCache`) and in `/api/graphql/` responses. | Progressive: no split (cobalt uses `browser_native_*` without muxing). DASH: split. | Login-walled content fails without a session; most 2026 "Cannot parse data" reports were in fact login-walled. Cookies come for free inside the WebView. | Scan `script[data-sjs]` and hook `/api/graphql/` bodies. Prefer HD progressive; use DASH plus mux only when progressive is missing or lower quality. |
| **TikTok** (mobile web) | Progressive MP4 on `v16/v19-webapp-prime.tiktok.com`. Some web playback reportedly goes through `blob:` / MSE (UNVERIFIED how much). | `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">` → `__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.video`: `playAddr`, `downloadAddr`, `bitrateInfo[].PlayAddr.UrlList` with `CodecType` / `DataSize`. Feed pages load the same item structure over XHR (exact 2026 endpoint names UNVERIFIED). | No | The CDN URL carries `tk=tt_chain_token`, and the download **requires the `tt_chain_token` cookie** set during page load (per a yt-dlp maintainer). Send Referer (page) and the same UA. `downloadAddr` is watermarked; `playAddr` / `bitrateInfo` are not. `bytevc2` is unplayable. Since Aug–Sep 2026 TikTok serves JS challenges and blocks some TLS fingerprints. | Parse the rehydration JSON and hook item-list API bodies. Choose h264 at the highest bitrate (h265 if the device decodes it). Download natively with the WebView's cookies for that URL, Referer and UA. |
| **X / Twitter** | `video_info.variants[]` lists complete MP4s (`video/mp4`, with audio, with `bitrate`) and an HLS master (`application/x-mpegURL`). The HLS uses separate `EXT-X-MEDIA TYPE=AUDIO` renditions with fMP4/CMAF segments (`EXT-X-MAP`). The player streams HLS. | GraphQL `TweetDetail` / `TweetResultByRestId` (also timelines) → `extended_entities.media[].video_info.variants`; `cdn.syndication.twimg.com/tweet-result` is a fallback. | MP4 variants: no. HLS: yes. | Guest token plus bearer for anonymous API use. NSFW / age-restricted needs login. | Hook GraphQL response bodies and take the highest-bitrate `video/mp4` variant (no mux). Use HLS plus audio mux only if no MP4 exists. cobalt still uses MP4 variants in 2026. |
| **YouTube** (m.youtube.com) | SABR: POST to `serverAbrStreamingUrl` with a protobuf `VideoPlaybackAbrRequest`; response is UMP (`application/vnd.yt-ump`) with audio and video frames interleaved. The web client lost `adaptiveFormats` URLs in Feb 2025; `mweb` / `web_embedded` became SABR-only for some sessions in Sep 2026. | Not in usable URLs. HTTPS formats for `web`, `mweb`, `android`, `ios` need a GVS PO token. `android_vr` formats return 403 since 2026-08-17. | Yes (separate itags) | Session-bound PO tokens, signature / `n` JS challenges. Terms of Service forbid downloading. | **Refuse.** `shouldInterceptRequest` can't read POST bodies and UMP isn't a file. MSE capture would technically work for non-DRM videos but breaks YouTube's terms and risks Play policy. |
| **Reddit** (v.redd.it) | DASH (`DASHPlaylist.mpd`) and HLS (`HLSPlaylist.m3u8`). | Post JSON → `secure_media.reddit_video.{fallback_url, dash_url, hls_url}`. Audio at `CMAF_AUDIO_128.mp4` / `CMAF_AUDIO_64.mp4`; older posts use `DASH_AUDIO_*.mp4` or `audio.mp4`. | **Yes, always.** `fallback_url` is video-only. | None needed for public posts (NSFW needs `over18` / session). | Hook or fetch the post JSON (the app currently skips `.json`). Parse the MPD, download best video and audio, mux. |
| **Vimeo** | HLS on `vod-adaptive-ak.vimeocdn.com` / `skyfire.vimeocdn.com` with audio `GROUP-ID` renditions; segmented DASH (`master.json` / `playlist.json` with base64 init). Progressive often absent (UNVERIFIED how often). | `player.vimeo.com/video/{id}/config` or `window.playerConfig` → `request.files.{progressive,hls,dash}.cdns.{akfire_interconnect_quic,fastly_skyfire}.url`. | HLS/DASH: yes | The API needs login for yt-dlp again (Aug 2026), but in-browser playback works and grabbing the m3u8 from the network is the accepted workaround. Domain-restricted embeds need the embedding page as Referer. Unlisted videos need the `h=` hash. | Network-capture `playlist.m3u8` from the `player.vimeo.com` iframe, or read the config JSON inside the iframe. Run the HLS downloader and mux audio. Send the iframe's parent URL as Referer. |
| **Dailymotion** | HLS (fMP4); progressive `H264-WxH` URLs sometimes. | `/player/metadata/video/{xid}` → `qualities.auto[]` (`application/x-mpegURL`), fetched by the player iframe. | Reportedly muxed (UNVERIFIED) | Tokenised URLs; yt-dlp needs impersonation for m3u8 (anti-bot), so use the WebView's UA and cookies. | Capture the manifest from network requests or the metadata body; HLS downloader. |
| **Twitch** | Clips: progressive MP4. VODs: HLS via `usher.ttvnw.net/vod/{id}.m3u8?sig=…&token=…`. | GQL `gql.twitch.tv/gql` (Client-ID): clips `videoQualities[].sourceURL` plus `playbackAccessToken` sig/token; VODs `VideoPlaybackAccessToken`. | Clips: no. VODs: muxed TS, plus a separate `audio_only` variant; HEVC/AV1 fMP4 variants UNVERIFIED. | Subscriber-only VODs need login. | Capture the usher m3u8 from the network (the player fetches it) → HLS. Clips: take `sourceURL` + sig/token from the GQL body or the media request. |
| **Pinterest** | MP4 (`V_720P`) and HLS (`V_HLSV4`, `V_HLSV3_MOBILE`) on `v1.pinimg.com`. | `/resource/PinResource/get/` → `videos.video_list`, `story_pin_data.pages[].blocks[].video.video_list`. | HLS reportedly has a separate `_audio.m3u8` (UNVERIFIED, weak source). | None for public pins. | Prefer the `V_720P` MP4 from the JSON body; otherwise HLS plus mux. |
| **LinkedIn** | Progressive MP4 on `dms.licdn.com`; HLS UNVERIFIED. | `<video data-sources='[{src,type}]'>`, captions in `data-captions-url`. | No | Many posts need login (`li_at`). | DOM scan of `video[data-sources]` plus network capture. |
| **Snapchat Spotlight** | Progressive MP4. | `<script id="__NEXT_DATA__">` → `props.pageProps.spotlightFeed.spotlightStories[].story.snapList[].snapUrls.mediaUrl`. | No | No login. | Embedded-JSON scan. |
| **Generic HTML5** | Progressive MP4/WebM with `Range`. | `<video src>`, `<source>`, `og:video(:secure_url)`, JSON-LD `VideoObject.contentUrl`, `<link rel=preload as=video>`. | No | Referer or cookies sometimes. | DOM scan plus native `shouldInterceptRequest`. |
| **JW Player** | HLS / MP4 / DASH | `jwplayer().getPlaylistItem().sources[].file`; Delivery API `cdn.jwplayer.com/v2/media/{id}` JSON. | Depends | none | Player API probe or capture the Delivery API JSON body. |
| **Video.js / hls.js / dash.js / Shaka** | HLS / DASH via MSE | hls.js `hls.url`, `hls.levels`, `hls.audioTracks`; Shaka `player.getAssetUri()`; video.js `currentSrc()`; dash.js `getSource()` (UNVERIFIED). Instances are often closure-scoped, so hook `Hls.prototype.loadSource` / `shaka.Player.prototype.load` at document start. Bundled or minified copies are not hookable. | Depends | Depends | Best: sniff manifests by content-type or body (`#EXTM3U`, `<MPD`). Player hooks enrich. MSE capture is the fallback. |
| **Cross-origin iframe embeds** | Whatever the embed uses. | Inside the iframe's own document and network traffic. | — | Referer = embedding page | `shouldInterceptRequest` sees iframe traffic, but Android RN injection is main-frame only. You need `addDocumentStartJavaScript(…, setOf("*"))`, which runs in every frame that matches the origin rules. |

**Other notes, by site**

- **Instagram:**
  - yt-dlp issue #16327 (Mar 2026): some logged-in accounts get reels whose progressive files lack music. So always check the `has_audio` flag and probe the result.
  - Stories: cobalt treats cookies as mandatory.
- **TikTok:** download `playAddr` or `bitrateInfo` URLs using the cookies set in that same WebView session; yt-dlp maintainers confirmed this in issues #13771 and #9997.
- **X:** GIFs are `tweet_video` MP4s. Host path patterns are from common knowledge (UNVERIFIED).
- **HLS on older WebViews:** Chrome/WebView 147 added built-in HLS on Android. Earlier Android builds played `<video src=*.m3u8>` through Android's `MediaPlayer`. Whether those segment requests bypass Chromium's network stack, and so `shouldInterceptRequest`, is UNVERIFIED.

---

## 2. Muxing, AES-128 and DRM matrix

| Needs A+V mux | No mux | May need HLS AES-128 decryption | DRM — must refuse |
|---|---|---|---|
| Instagram DASH (or `has_audio: false`) | Instagram `video_versions` (with audio) | Generic HLS sites with `#EXT-X-KEY:METHOD=AES-128`. Whole-segment AES-128-CBC with PKCS7. If `IV` is absent, the IV is the media sequence number, big-endian, left-padded to 16 bytes (RFC 8216 §4.3.2.4). Fetch the key URI with the same cookies and Referer. | EME / Widevine anywhere: `navigator.requestMediaKeySystemAccess` or `setMediaKeys` called |
| Facebook DASH-only cases | Facebook `browser_native_*` / `progressive_urls` | None of the named major platforms were verified to use AES-128 for public video (UNVERIFIED). | HLS `METHOD=SAMPLE-AES` or `KEYFORMAT` other than `identity` (e.g. Widevine `urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`) |
| Reddit (always) | TikTok `playAddr` | | DASH `<ContentProtection>` with a Widevine/PlayReady UUID; `pssh` / `tenc` / `encv` / `enca` boxes in init segments |
| X HLS (only if no MP4 variant) | X MP4 variants | | Android WebView plays Widevine only if the app grants `RESOURCE_PROTECTED_MEDIA_ID` in `onPermissionRequest`. Deny it and treat the request as a DRM signal. |
| Vimeo HLS/DASH, Pinterest HLS (likely), generic DASH | Twitch clips and VODs, Snapchat, LinkedIn, Dailymotion (reportedly) | | Paid streaming services |
| **Every MSE capture** (separate SourceBuffers) | Generic progressive | | |

**Mux engine.** FFmpegKit is retired (binaries pulled from Maven in April 2025). Use Media3 instead:

- **Parsing inputs:** Media3 extractors — `Mp4Extractor` / `FragmentedMp4Extractor` for fMP4/CMAF, `TsExtractor` for HLS TS, `MatroskaExtractor` for WebM.
- **Writing output:** `androidx.media3:media3-muxer` `Mp4Muxer`, copying samples without re-encoding. It accepts H.264, H.265, AV1 and VP9 video and AAC and Opus audio. `WebmMuxer` has existed since 1.9.0. Latest Media3 stable is 1.11.1 (2026-09-10).
- **Not Transformer:** its docs don't list HLS/DASH as inputs (UNVERIFIED), so don't depend on it.

---

## 3. Universal techniques, ranked by how many real downloads they produce

| Rank | Technique | What it covers | Main limits |
|---|---|---|---|
| 1 | **In-page response-body hooks plus embedded-JSON scanners** (b, d) | Instagram, Facebook, TikTok, X, Reddit, Pinterest, Snapchat, Twitch clips, Vimeo config, JW Delivery API. Best quality, audio included, no playback needed. | Needs a per-site adapter (a small pure function you can test with fixtures). Key names are fairly stable. Must run at document start in every frame. |
| 2 | **Native network observation** (a) plus an HLS/DASH downloader | Generic progressive files, manifests with obvious extensions or content types, Vimeo, Dailymotion, Twitch VOD HLS, iframe embeds | URL only: no request body, no response body, no response headers. Not called for `blob:` or `javascript:`, and only for the first URL of a redirect. Blind to SABR, POST APIs and URLs that only appear in JSON. |
| 3 | **MSE / SourceBuffer capture** (c) | Any non-DRM MSE player, however obscured (Meta byte-range DASH, custom manifests). The universal fallback. | Must play through; two tracks to mux; memory and IPC load. Fails with EME, with MSE inside a worker (Chrome 108+ `MediaSourceHandle`), and on `changeType` codec switches. Adaptive quality switches split the capture. |
| 4 | **DOM scraping** (d) | Simple sites, `og:video`, JSON-LD, `data-sources`, `__NEXT_DATA__` | Modern players show a `blob:` src, so there's nothing to scrape. |
| 5 | **Player-library APIs** | JW Player / hls.js / Shaka / video.js sites | Instances are rarely global; mostly adds detail to what rank 2 already finds. |

### (a) `shouldInterceptRequest`: what it sees

- **Seen:**
  - Frame navigations (only the initial URL of a redirect chain).
  - Subresources, including cross-origin iframe subresources (`isForMainFrame=false`).
  - Page `fetch` and XHR.
  - `<video>` progressive requests with a `Range` header. This is why Cordova had to add Range handling for seekable local video.
  - It is called on a non-UI thread, and for `data:` and `file:` URLs as well.
- **Not seen:**
  - `blob:`, `javascript:`, `file:///android_asset`; Chromium marks `blob:` as won't-fix.
  - WebSockets.
  - Requests made by service workers. Those go to the process-wide `ServiceWorkerClient.shouldInterceptRequest`, which has no WebView reference, so you can't tell which tab they came from.
- **Unknown:**
  - Requests from dedicated workers (UNVERIFIED).
  - Whether `getRequestHeaders()` includes `Cookie`. Cookies are probably added later in the network stack, so it likely doesn't (UNVERIFIED).
- **No body access:** there are no request bodies. Reading a response body means proxying the request yourself, which doubles traffic and breaks streaming. **Treat this hook as passive URL observation only.**

### (b) Fetch/XHR body hooks

- **Fetch:** wrap `window.fetch` and call `res.clone()` only when one of these matches:
  - the URL is on an allowlist (`/graphql`, `/api/`, `item_list`, `tweet-result`, `.json`, `config`), or
  - the content type is `json`, `mpegurl` or `dash+xml`.

  Cap body reads at around 5 MB and parse off the hot path with `requestIdleCallback`.
- **XHR:** read `responseText` or `response` on `load`.
- **Sniffing:** check bodies for `#EXTM3U` and `<MPD`.
- **Timing:** hooks must be installed before page scripts run, or the page keeps its own reference to the original `fetch`. On Android, react-native-webview's `injectedJavaScriptBeforeContentLoaded` is documented as not 100% reliable.

### (c) MSE capture, done the way browser extensions do it

- **Hooks:** patch `MediaSource.prototype.addSourceBuffer` (record mime and codecs) and `SourceBuffer.prototype.appendBuffer`.
  - **Copy every chunk.** Players reuse their buffers, so keeping the reference saves only the last segment.
  - Also hook `changeType`, `remove`, `abort`, the `timestampOffset` setter and `endOfStream`.
- **Injection:** do it at document start in the page's own JS context. That's how blob-downloader works (MAIN world, `document_start`).
- **Output:** one file per SourceBuffer; mux them afterwards.
- **Forcing buffering:**
  - Mute and set `playbackRate` to 16. That's Chrome's maximum; values above 16 throw `NotSupportedError`.
  - Autoplay (`mediaPlaybackRequiresUserAction={false}`), seek to 0 and let it run.
  - Chrome's SourceBuffer quota is roughly 150 MB video / 12 MB audio on desktop and lower on low-memory devices. Players evict data, so capture must copy on append, not read the buffer later.
  - Split the capture at each new init segment (a quality switch) and keep the highest-quality complete run.
  - Where possible, pin top quality through the player API (hls.js `currentLevel`, Shaka `selectVariantTrack`); UNVERIFIED as a general technique.
- **Getting bytes out of the WebView:**
  - **Best:** `WebViewCompat.addWebMessageListener` with ArrayBuffer (androidx.webkit 1.8.0+, feature `WEB_MESSAGE_ARRAY_BUFFER`). No base64, so about a third less memory. Listener injection respects origin rules and reports `isMainFrame`.
  - Chunk to 1–2 MB and gate on native acks through `JavaScriptReplyProxy` (chunk size is a conservative choice; IPC limits UNVERIFIED).
  - **Avoid `addJavascriptInterface`:** strings only (base64), synchronous, exposed to every frame with no origin checks.
  - **Avoid the React Native bridge:** strings only, and it goes through the RN JS thread.
  - **Don't use a localhost HTTP sink:** Private/Local Network Access rules may block it (UNVERIFIED).
- **Hazard:** react-native-webview registers its own `ReactNativeWebView` listener for all origins and calls `message.getData()` (`node_modules/react-native-webview/.../RNCWebView.java:256`, origins at `:262`). `getData()` throws `IllegalStateException` on an ArrayBuffer message. **Binary data must go to a separate listener object**, or the app risks crashing.

### (d) DOM scraping

Covered well by the existing observer (`og:video`, JSON-LD, preload links). Add:
- `__UNIVERSAL_DATA_FOR_REHYDRATION__`
- `__NEXT_DATA__`
- `script[data-sjs]`
- `video[data-sources]`
- re-scanning on `history.pushState` / `popstate`, because the social sites are single-page apps

### (e) Injecting into every frame on Android

- In react-native-webview, `injectedJavaScriptForMainFrameOnly=false` is iOS/macOS only per its docs.
- Its Android code stores the flag but never reads it (`RNCWebView.java:66-67`).
- `injectedJavaScriptBeforeContentLoaded` is run by `evaluateJavascript` from `onPageStarted` (`RNCWebViewClient.java:~86-91`, `RNCWebView.java:311-317`). That is main-frame only and races the page's scripts.
- The fix is `WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))`:
  - runs before any page script;
  - runs in any frame whose origin matches, including cross-origin iframes;
  - must be called before the first `loadUrl`;
  - does not reach workers.

---

## 4. Proposed detection architecture for VidoraX

### 4.1 Current state (from the code)

1. **The JSON sources are thrown away.**
   - `API_PATH` rejects `api|graphql|metadata` (`MediaNetworkBridge.kt:71-75`, `:242-245`).
   - `SKIP_PATH` rejects `.json` (`:59-63`, `:221-223`).
   - The JS hooks never read bodies (`injected-script.ts:516-562`).

   The app therefore can't see Instagram, Facebook, TikTok, X or Reddit metadata. **Rewrite this part.**
2. **Meta CDN URLs are emitted raw.**
   - `instagramLooksMedia` accepts `/v/t` paths on `fbcdn` / `cdninstagram` (`:386-397`).
   - `canonicalizeObservedUrl` only rewrites YouTube `videoplayback` URLs (`:421-444`).
   - If Meta's player uses `bytestart`/`byteend`, those candidates are partial byte ranges. Even when complete, they're a single video-only or audio-only track, giving truncated or silent downloads (UNVERIFIED on a device).
3. **YouTube heuristics exist**: `itag=` in `:408-409`, `videoplayback` param stripping in `:425-428`. Remove them for policy reasons.
4. **Performance on WebView network threads.**
   - The postinstall patch does `Class.forName` + `getMethod` on **every** request (`scripts/apply-webview-media-hook.js:27-29`).
   - `observeRequestFrom` is `@Synchronized` (`MediaNetworkBridge.kt:132`), so every network thread queues behind one lock.
   - `instagramLooksMedia` compiles a new `Regex` on every call (`:392`).
   - Heavy feeds make hundreds of requests, so this slows page loads.
5. **Attribution gaps.**
   - Service-worker candidates pass `view=null` (`:356`) and get `webViewId = -1` (`:298`), so they can't be tied to a tab.
   - `pageUrl` is always null (`:297`).
6. **Injection** relies on `injectedJavaScriptBeforeContentLoaded` (`src/browser/components/BrowserContainer/BrowserWebView.tsx:636`): main-frame only and unreliable, as described in 3(e).

**Worth keeping:**
- The idea of an observe-only native hook.
- The ServiceWorkerClient observer.
- The DOM, `og:video` and JSON-LD scanners in `injected-script.ts`.
- Its active-video tracking.

### 4.2 Target design

```
WebView creation (one reflection call, not per request)
 ├─ addDocumentStartJavaScript(detector.js, ["*"])       // all frames, before page JS
 ├─ addWebMessageListener("__vdx", ["*"])                // JSON strings + ArrayBuffer chunks
 ├─ shouldInterceptRequest → lock-free enqueue(tabId, url, method, range?, isMainFrame, referer)
 ├─ ServiceWorkerClient    → enqueue(tab = match Referer/Origin to the tab's current origin)
 └─ onPermissionRequest(PROTECTED_MEDIA_ID) → deny + mark tab "DRM"

detector.js (per frame)
 ├─ NavTracker: pushState/replaceState/popstate → pageEpoch
 ├─ BodyTaps: fetch clone / XHR load on allowlist or json|mpegurl|dash+xml; sniff #EXTM3U/<MPD
 ├─ EmbeddedJson: rehydration / __NEXT_DATA__ / data-sjs / ld+json / og:video / data-sources
 ├─ SiteAdapters (pure fns, fixture-tested): ig, fb, tiktok, x, reddit, twitch, pinterest,
 │     snapchat, vimeo(config), jw(delivery) → MediaCandidate[]
 ├─ VideoTracker: <video> currentSrc (non-blob), MediaSource ↔ element map (createObjectURL/srcObject)
 ├─ DrmGuard: requestMediaKeySystemAccess / setMediaKeys → session.drm = true
 └─ MseCapture (only on user "Capture" or no-URL fallback, active video only):
       addSourceBuffer/appendBuffer/changeType/remove copies → __vdx ArrayBuffer chunks w/ ack window

Native Resolver (Kotlin, single worker thread)
 ├─ Candidate store per (tabId, pageEpoch); merge URL observations with adapter metadata
 ├─ Group → MediaItem{ variants: Progressive(AV) | Progressive(V)+Audio | HLS | DASH | MseCapture }
 ├─ Rank: progressive-with-audio (max res) > HLS/DASH best V + best A (mux) > MSE capture
 └─ Policy: refuse DRM, SAMPLE-AES/non-identity KEYFORMAT, youtube.com / googlevideo.com

Download engine (foreground service / WorkManager)
 ├─ Request = WebView UA + Referer(page or embedding frame) + CookieManager.getCookie(url)
 │    (TikTok: tt_chain_token must be present; never replay IG/TikTok APIs natively)
 ├─ Progressive: resumable ranged download (strip Meta bytestart/byteend — UNVERIFIED)
 ├─ HLS: master → variant + EXT-X-MEDIA audio; TS or fMP4 (EXT-X-MAP); BYTERANGE; AES-128
 ├─ DASH: SegmentBase (Meta/Reddit single file), SegmentTemplate $Number$/$Time$, SegmentList (Vimeo)
 ├─ Mux: Media3 extractors → media3-muxer Mp4Muxer (sample copy) → .mp4
 └─ Verify: re-extract output; duration > 0, video track present, audio if expected, else fail with reason
```

**MediaCandidate fields:**
- `tabId`, `pageEpoch`, `frameOrigin`, `isMainFrame`
- `site`, `assetId`
- `kind` (progressive / hls / dash / mse)
- `url`, `audioUrl?`
- `width`, `height`, `bitrate`, `codec`
- `hasAudio` (true / false / unknown)
- `watermarked`
- `drm` (none / suspected / confirmed)
- `expiresAt?`
- `requestContext` (referer, cookie domain)
- `provenance` (adapter / network / dom / mse)

### 4.3 Build order

1. **P0:**
   - Install at WebView creation (document-start script, `__vdx` listener, cached-method intercept hook with no lock).
   - Adapters for Instagram, Facebook, TikTok, X and Reddit, plus DOM/embedded-JSON scanners.
   - Progressive downloader with cookies, Referer and UA.
   - DRM and YouTube refusal.
2. **P1:** HLS/DASH downloader (including AES-128) and the Media3 mux path. This covers Reddit, Vimeo, X-HLS, Pinterest, Twitch VODs and generic DASH.
3. **P2:** MSE capture, user-triggered on the active video, binary chunks through `__vdx`, muxed on completion.
4. **P3:** Player-API probes (JW, hls.js, Shaka, video.js).

**Testing:** save anonymised JSON, MPD and m3u8 fixtures per site. Adapters, playlist parsers and the resolver should be pure and unit-testable with those fixtures, replacing the 130 `verify-*.ts` scripts. Keep one end-to-end smoke test per site on a device.

---

## Sources

**Extractor code**
- yt-dlp extractors: [instagram.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py), [tiktok.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/tiktok.py), [twitter.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py), [facebook.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/facebook.py), [reddit.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/reddit.py), [vimeo.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/vimeo.py), [dailymotion.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/dailymotion.py), [twitch.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitch.py), [pinterest.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/pinterest.py), [linkedin.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/linkedin.py), [youtube/_base.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py)
- cobalt services: [instagram.js](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/instagram.js), [tiktok.js](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/tiktok.js), [twitter.js](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/twitter.js), [facebook.js](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/facebook.js), [reddit.js](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/reddit.js)

**yt-dlp issues**
- YouTube SABR and PO tokens: [#12482](https://github.com/yt-dlp/yt-dlp/issues/12482), [#17666](https://github.com/yt-dlp/yt-dlp/issues/17666)
- TikTok cookies and 2026 blocks: [#13771](https://github.com/yt-dlp/yt-dlp/issues/13771), [#9997 comment](https://github.com/yt-dlp/yt-dlp/issues/9997#issuecomment-2124861144), [#17393](https://github.com/yt-dlp/yt-dlp/issues/17393), [#17604](https://github.com/yt-dlp/yt-dlp/issues/17604)
- Instagram: [#17074](https://github.com/yt-dlp/yt-dlp/issues/17074), [#16327](https://github.com/yt-dlp/yt-dlp/issues/16327), [#14241](https://github.com/yt-dlp/yt-dlp/issues/14241)
- X, Facebook, Snapchat, Vimeo: [#17058](https://github.com/yt-dlp/yt-dlp/issues/17058), [#17583](https://github.com/yt-dlp/yt-dlp/issues/17583), [#15155](https://github.com/yt-dlp/yt-dlp/issues/15155), [#15281](https://github.com/yt-dlp/yt-dlp/issues/15281)

**Site delivery articles and tools**
- [Instagram DASH manifest walkthrough (dev.to, Jul 2026)](https://dev.to/ai_ai_c7d6c56f61323774fca/inside-instagrams-dash-manifest-from-mpd-to-segment-to-stitched-mp4-118e)
- [Facebook bytestart/byteend explanation (W3C list, 2017)](https://lists.w3.org/Archives/Public/public-webapps-github/2017Oct/1491.html)
- [X/Twitter video in 2026 (dev.to)](https://dev.to/jamesmitchell_dev/twitterx-video-downloads-in-2026-tools-apis-and-what-actually-works-2h81), [sniff-hls (X split-audio HLS)](https://github.com/nuoyax/sniff-hls)
- [tiktok-download-buttons](https://github.com/sixem/tiktok-download-buttons)
- [Reddit CMAF audio rename (ReVanced #6264)](https://github.com/revanced/revanced-patches/issues/6264)
- [YouTube SABR explainer (Medium, Jul 2026)](https://medium.com/@vlastimil.koudela/how-to-download-from-youtube-in-2026-and-why-the-old-browser-trick-died-b44474d7e350), [LuanRT/googlevideo](https://github.com/LuanRT/googlevideo)
- [YouTube Terms of Service](https://www.youtube.com/static?template=terms), [Google Play Intellectual Property policy](https://support.google.com/googleplay/android-developer/answer/9888072)
- Weak sources (treat as UNVERIFIED): [Dailymotion gist](https://gist.github.com/devinschumacher/b2245da6b36e2e439513db8a0aafdec1), [Pinterest downloader listing](https://apify.com/khadinakbar/pinterest-video-downloader), [Twitch Enhanced Broadcasting](https://blog.twitch.tv/en/2024/01/08/introducing-the-enhanced-broadcasting-beta/)

**Android WebView and react-native-webview**
- [WebViewClient.shouldInterceptRequest docs (MS Learn mirror)](https://learn.microsoft.com/en-us/dotnet/api/android.webkit.webviewclient.shouldinterceptrequest), [ServiceWorkerClient](https://learn.microsoft.com/en-us/dotnet/api/android.webkit.serviceworkerclient.shouldinterceptrequest)
- Chromium issues: [blob: URLs not intercepted](https://issues.chromium.org/issues/41377198), [WebView request proxying](https://issues.chromium.org/issues/493074976)
- [Android JS bridge guide](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge), [WebViewCompat source](https://github.com/androidx/androidx/blob/androidx-main/webkit/webkit/src/main/java/androidx/webkit/WebViewCompat.java), [WebMessageCompat source](https://github.com/androidx/androidx/blob/androidx-main/webkit/webkit/src/main/java/androidx/webkit/WebMessageCompat.java), [androidx.webkit release notes](https://developer.android.com/jetpack/androidx/releases/webkit)
- [react-native-webview Reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)
- [X-Requested-With header change](https://android-developers.googleblog.com/2023/02/improving-user-privacy-by-requiring-opt-in-to-send-x-requested-wih-header-from-webview.html)
- [WebView DRM permission (android-components #1128)](https://github.com/mozilla-mobile/android-components/issues/1128)
- [CookieManager and HttpOnly cookies (react-native-cookies #76)](https://github.com/react-native-cookies/cookies/issues/76)
- [Chrome 147 native HLS on Android (hls.js #7827)](https://github.com/video-dev/hls.js/issues/7827)

**MSE, players and HLS spec**
- [blob-downloader](https://github.com/aeroxy/blob-downloader)
- [MediaSourceHandle / MSE in workers (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaSourceHandle)
- [Chrome MSE quota](https://developer.chrome.com/blog/quotaexceedederror), [Chrome playbackRate limits](https://developer.chrome.com/blog/media-updates-in-chrome-63-64)
- [RFC 8216 §4.3.2.4 (EXT-X-KEY)](https://www.rfc-editor.org/rfc/rfc8216#section-4.3.2.4)
- [hls.js API](https://github.com/video-dev/hls.js/blob/master/docs/API.md), [Shaka Player API](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html), [JW Player Delivery API](https://docs.jwplayer.com/platform/reference/delivery-api-getting-started)

**Muxing**
- [Media3 Transformer supported formats](https://developer.android.com/media/media3/transformer/supported-formats), [Media3 release notes](https://github.com/androidx/media/blob/release/RELEASENOTES.md), [Mp4Muxer source](https://github.com/androidx/media/blob/release/libraries/muxer/src/main/java/androidx/media3/muxer/Mp4Muxer.java)
- [FFmpegKit retirement](https://tanersener.medium.com/saying-goodbye-to-ffmpegkit-33ae939767e1)