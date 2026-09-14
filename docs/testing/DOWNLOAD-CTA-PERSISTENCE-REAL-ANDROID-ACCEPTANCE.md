# Download CTA Persistence — Real Android Acceptance

**Status:** all cases `NOT_TESTED` until exercised on physical Android.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

No Maestro / Appium / Detox / OCR / polling automation.

---

## A. INSTAGRAM — `NOT_TESTED`

1. Open Instagram → video A → small Download CTA appears and remains.
2. Wait 20–60s on same video → CTA still visible.
3. Pause/play → CTA still visible.
4. Slight scroll same item → no flicker/disappear.
5. Swipe to B → A replaced by B CTA.
6. Swipe C/D/E → each supported current video gets CTA.
7. Continue ≥20 videos → no permanent disappearance.

## B. TIKTOK — `NOT_TESTED`

8. TikTok video A → CTA appears/stays.
9. Watch/buffer/pause/play → CTA stable.
10. Swipe 20+ videos → current CTA continues.
11. Download one → that content consumed.
12. Next video → new CTA appears.

## C. SAME VIDEO SOURCE REFRESH — `NOT_TESTED`

13. Stay long enough for CDN/network refresh if practical → CTA does not vanish merely from signature refresh.

## D. QUALITY SHEET — `NOT_TESTED`

14. Tap Download → open sheet → cancel → same CTA returns/remains.
15. Open again → choose quality → enqueue → consumed only after accepted handoff.

## E. GENERAL WEBSITE — `NOT_TESTED`

16. Ordinary supported site video → CTA appears/stays.
17. Different video in same player → new CTA.

## F. TABS — `NOT_TESTED`

18. Tab A Instagram / Tab B TikTok → each shows only its current CTA.

## G. LONG SCROLL — `NOT_TESTED`

19. 50–100 videos if practical → no permanent disappearance, no wrong-video CTA, no obvious verification storm.

## H. WRONG-VIDEO SAFETY — `NOT_TESTED`

20. Fast A→B→C → tap on C downloads C only.

## I. SESSION MEDIA — `NOT_TESTED`

21. Logged-in supported page → CTA stable; no Cookie persistence.

## J. PROTECTED MEDIA — `NOT_TESTED`

22. DRM/unsupported → no fake sticky Download CTA.

## K. PRIVACY — `NOT_TESTED`

23. Logcat during scroll/verify/download must not expose Cookie, Authorization, signed URL query, requestContext, OTP/password.
