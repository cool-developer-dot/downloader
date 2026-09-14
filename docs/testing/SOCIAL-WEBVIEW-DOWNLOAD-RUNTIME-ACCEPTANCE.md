# Social WebView Download Runtime — Real Android Acceptance

**Status:** all cases `NOT_TESTED` until exercised on physical Android.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

No Maestro / Appium / Detox / OCR / polling automation.

---

## A. TIKTOK OPEN — `NOT_TESTED`

1. Open TikTok inside VidoraX.

Expected:
- stays inside VidoraX
- no native TikTok launch
- no "Can't open url snssdk..." warning
- page continues usable

## B. TIKTOK FIRST VIDEO — `NOT_TESTED`

2. Open first TikTok video.

Expected:
- VidoraX Download CTA appears without needing another scroll
- CTA remains visible
- no "Open TikTok" native launch behavior

## C. TIKTOK 20 VIDEOS — `NOT_TESTED`

3. Swipe through at least 20 videos.

For every supported current video:
- small Download CTA appears
- remains while video current
- old video's CTA does not remain after new strong owner
- no permanent disappearance

## D. TIKTOK DOWNLOAD — `NOT_TESTED`

4. Stop on video N. Tap Download.

Expected:
- current video N is selected
- quality if applicable
- Phase 1 enqueue
- actual current media downloads (never N-1)

## E. TIKTOK APP-AWAKEN — `NOT_TESTED`

5. Tap website UI that previously triggered TikTok app.

Expected:
- native app does not launch
- no LogBox warning
- current page stays
- CTA remains valid

## F. INSTAGRAM FIRST REEL — `NOT_TESTED`

6. Open Instagram Reel.

Expected:
- Download CTA appears on first current Reel
- stays visible

## G. INSTAGRAM 20 REELS — `NOT_TESTED`

7. Scroll through at least 20 Reels.

Expected:
- each supported Reel receives current-video CTA

## H. GENERAL WEBSITE — `NOT_TESTED`

8. Open supported non-social website.

Expected:
- current supported media gets CTA

## I. QUALITY CANCEL — `NOT_TESTED`

9. Download → quality sheet → cancel.

Expected:
- CTA still available

## J. SAME VIDEO DWELL — `NOT_TESTED`

10. Stay on same video: 10s, 30s, 60s, 2min.

Expected:
- CTA remains visible

## K. FAST SCROLL — `NOT_TESTED`

11. A → B → C → D quickly. Stop D.

Expected:
- CTA D only
- Download D → D downloads

## L. TAB SWITCH — `NOT_TESTED`

12. TikTok tab A, Instagram tab B.

Expected:
- active tab's CTA only
- switch back → correct current CTA restored

## M. CONSOLE — `NOT_TESTED`

13. During all tests.

Must NOT show:
- Can't open url: snssdk1233://...
- Can't open url: snssdk1340://...
- raw custom social scheme escaping WebView

## N. PRIVACY — `NOT_TESTED`

14. Logcat inspection.

Must not expose:
- Cookie
- Authorization
- requestContext
- signed query
- password / OTP
