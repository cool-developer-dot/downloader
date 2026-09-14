# Phase 2 — Media Discovery Manual Test Matrix

| ID | Case | Expect |
|---|---|---|
| UI-01 | Navigate to page with MP4 `<video>` | Floating card slides up; title/format shown |
| UI-02 | Page with MP3 audio | Audio badge + format chip |
| UI-03 | HLS master playlist | HLS badge; qualities appear after enrich |
| UI-04 | Encrypted HLS | DRM/Encrypted/Unsupported; Download disabled |
| UI-05 | Live HLS | LIVE badge |
| UI-06 | Dismiss card | Exit animation; card gone; browsing continues |
| UI-07 | Navigate away | Card clears; no stale media |
| UI-08 | Home | Overlay hidden |
| UI-09 | Multiple media | Count caption; hero prefers video |
| UI-10 | Details expand | Metadata rows; unknown fields hidden |
| UI-11 | Reduce Motion | Instant appear/disappear, no pulse |
| UI-12 | Screen reader | Live announcement on detect |
| UI-13 | Touch WebView behind card | Scrolling works (`box-none`) |
| UI-14 | Thumbnail missing | Placeholder icon |
| UI-15 | Unsafe thumbnail URL | Rejected; placeholder |
| UI-16 | Download CTA | Announces coming soon — no download starts |
