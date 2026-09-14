# Browser + Social Runtime Hardening — Real Android Acceptance

**Platform:** Android only  
**Scope:** Infinite spinner, Back/Forward/Home, Instagram/TikTok CTA after scroll  

All cases remain **NOT_TESTED** until a human runs them on a real device/APK.

Do not mark production-ready from static verification alone.

---

## A. SPINNER

| # | Case | Result |
|---|------|--------|
| 1 | google.com → spinner stops | NOT_TESTED |
| 2 | Instagram → spinner stops | NOT_TESTED |
| 3 | TikTok → spinner stops | NOT_TESTED |
| 4 | media-heavy site → spinner stops while background requests continue | NOT_TESTED |
| 5 | redirect page → spinner stops | NOT_TESTED |
| 6 | failed URL → spinner stops + error UI | NOT_TESTED |

## B. NAVIGATION

| # | Case | Result |
|---|------|--------|
| 7 | Open A → B → C → Back → B → Back → A → Forward → B | NOT_TESTED |
| 8 | Home → browser Home | NOT_TESTED |
| 9 | Two tabs → Back/Forward control only active tab | NOT_TESTED |

## C. INSTAGRAM

| # | Case | Result |
|---|------|--------|
| 10 | Reel/feed video A → CTA appears | NOT_TESTED |
| 11 | swipe to B → B CTA appears | NOT_TESTED |
| 12 | swipe C/D/E → each supported current video gets CTA | NOT_TESTED |
| 13 | Download B → exactly B downloads | NOT_TESTED |
| 14 | continue scrolling → C/D still get CTA | NOT_TESTED |

## D. TIKTOK

| # | Case | Result |
|---|------|--------|
| 15 | Video A CTA | NOT_TESTED |
| 16 | swipe B CTA | NOT_TESTED |
| 17 | swipe C CTA | NOT_TESTED |
| 18 | download C | NOT_TESTED |
| 19 | continue through ≥10 videos | NOT_TESTED |
| 20 | CTA remains current-video-specific | NOT_TESTED |

## E. LONG SCROLL

| # | Case | Result |
|---|------|--------|
| 21 | Scroll 30–100 videos if practical | NOT_TESTED |

Expected: no permanent CTA disappearance, no wrong-video CTA, no slowdown, no duplicate-download storm, no verification storm.

## F. TABS

| # | Case | Result |
|---|------|--------|
| 22 | Instagram Tab A | NOT_TESTED |
| 23 | TikTok Tab B | NOT_TESTED |
| 24 | CTA correct independently | NOT_TESTED |
