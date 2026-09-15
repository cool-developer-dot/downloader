# VidoraX v2 end-to-end test matrix (verified live 2026-09-15)

Every case must end as one file that plays with audio in the in-app player.

| # | Case | URL | Exercises |
|---|------|-----|-----------|
| 1 | Progressive MP4 (10 s, 1 MB) | https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4 | fast path (no remux), Range resume |
| 2 | HTML5 page with `<source>` | https://www.w3schools.com/html/html5_video.asp | DOM detection, relative URL resolution |
| 3 | HLS MPEG-TS, muxed audio | https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8 | TS -> MP4 remux, variant selection |
| 4 | HLS MPEG-TS (Mux) | https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 | 720p TS; HE-AAC (mp4a.40.5) in the low variant |
| 5 | HLS fMP4 + separate audio rendition | https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8 | EXT-X-MAP, EXT-X-MEDIA TYPE=AUDIO mux |
| 6 | HLS AES-128 | https://playertest.longtailvideo.com/adaptive/oceans_aes/oceans_aes.m3u8 | key fetch (URI="oceans.key"), CBC decrypt, IV from media sequence |
| 7 | DASH SegmentTemplate | https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd | $Number$ segments; 10.5 min, pick a low quality |
| 8 | DASH SegmentBase, separate video + audio files | https://storage.googleapis.com/wvmedia/clear/h264/tears/tears.mpd | whole-file representations + A/V mux (Instagram/Facebook pattern); 12 min |
| 9 | Vimeo public video | https://vimeo.com/76979871 | cross-origin player iframe, config JSON / HLS |

Dead: https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4 (403).

Also on device: a public TikTok video, a public Reddit video post, a public Instagram reel (logged out), an X post with
video — find current URLs in the emulator browser; never sign in or enter credentials.

Per case check: download button appears for the right video; qualities listed; progress/pause/resume; completes after
backgrounding the app; library item has thumbnail, duration, resolution; plays with audio; seek works.
