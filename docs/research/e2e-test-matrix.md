# VidoraX v2 end-to-end test matrix (verified live 2026-09-15)

## Supported — must download successfully

| # | Case | URL | Exercises |
|---|------|-----|-----------|
| 1 | Progressive MP4 (10 s, 1 MB) | https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4 | fast path (direct to disk, no remux), Range resume |
| 2 | HTML5 page with `<source>` | https://www.w3schools.com/html/html5_video.asp | DOM detection, relative URL resolution |
| 3 | HLS MPEG-TS, muxed audio | https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8 | TS segment concatenation, variant selection |
| 4 | HLS MPEG-TS (Mux) | https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 | 720p TS; HE-AAC (mp4a.40.5) in the low variant |
| 9 | Vimeo public video | https://vimeo.com/76979871 | cross-origin player iframe, config JSON / HLS |

Per case check: download button appears for the right video; qualities listed; progress/pause/resume; completes after
backgrounding the app; library item has thumbnail, duration, resolution; plays with audio; seek works.

## Must reject cleanly — unsupported by contract

These cases must be detected and rejected with a clear user-facing reason. They must NOT attempt to download.

| # | Case | URL | Expected rejection reason |
|---|------|-----|---------------------------|
| 5 | HLS fMP4 + separate audio rendition | https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8 | Separate audio/video muxing not supported |
| 6 | HLS AES-128 | https://playertest.longtailvideo.com/adaptive/oceans_aes/oceans_aes.m3u8 | Encrypted HLS not supported |
| 7 | DASH SegmentTemplate | https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd | Segmented DASH not supported (UNSUPPORTED) |
| 8 | DASH SegmentBase, separate video + audio | https://storage.googleapis.com/wvmedia/clear/h264/tears/tears.mpd | Separate audio/video DASH not supported (UNSUPPORTED) |

## Edge cases to verify on device

Also on device: a public TikTok video, a public Reddit video post, a public Instagram reel (logged out), an X post with
video — find current URLs in the emulator browser; never sign in or enter credentials.

Note: some social-site videos may only be available as separate audio/video streams (HLS with alternate audio
renditions, or DASH). These are legitimately out of scope and should reject cleanly with a reason the user can
understand.

Dead: https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4 (403).

## Research reference (OUT OF CURRENT PRODUCT SCOPE)

The broader DASH/AES-128/separate-A/V research in `docs/research/android-native-media.md` and
`docs/research/site-video-delivery.md` is preserved for future reference but does NOT define the current
download contract. See `docs/ARCHITECTURE.md` §1 for the authoritative scope.
