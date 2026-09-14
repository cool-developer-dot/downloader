# Unified Browser Phase 1 — Real Android Acceptance

All runtime cases start as **NOT_TESTED**. Mark PASS / FAIL on device.

Package: `com.anonymous.vidorax`  
Build: use existing Expo/Android workflow — **do not** require APK from this phase agent.

---

## MANUAL A — APP LAUNCH

**Steps:** Cold start → splash → onboarding → app.

**Expected:** Lands on Browser tab with minimal start page. No separate Home tab in bottom nav.

**Status:** NOT_TESTED

---

## MANUAL B — URL

**Steps:** Enter `https://example.com` in omnibox → Go.

**Expected:** WebView opens page. Start page disappears.

**Status:** NOT_TESTED

---

## MANUAL C — SEARCH

**Steps:** Enter a search query (e.g. `funny videos`) → Go.

**Expected:** Existing search behavior (Google search navigation).

**Status:** NOT_TESTED

---

## MANUAL D — PASTE

**Steps:** Copy a valid URL. Tap omnibox. Paste manually. Submit.

**Expected:** Page opens. No automatic clipboard read/navigation on launch.

**Status:** NOT_TESTED

---

## MANUAL E — QUICK ACCESS

**Steps:** Tap each visible shortcut (YouTube, Instagram, TikTok, Facebook, Vimeo, Dailymotion).

**Expected:** Opens in existing Browser WebView path.

**Status:** NOT_TESTED

---

## MANUAL F — TABS

**Steps:** Open several tabs. Switch / close / add.

**Expected:** Existing tab engine behavior (max 8, mount pool unchanged).

**Status:** NOT_TESTED

---

## MANUAL G — BACK / FORWARD

**Steps:** Navigate several pages. Use toolbar back/forward and Android back.

**Expected:** Existing ownership unchanged.

**Status:** NOT_TESTED

---

## MANUAL H — WEBVIEW PERSISTENCE

**Steps:** Open a site. Switch Browser → Downloads → Browser.

**Expected:** Same page/tab remains.

**Status:** NOT_TESTED

---

## MANUAL I — APP LOCK

**Steps:** Enable App Lock. Background/lock. Unlock.

**Expected:** Returns to Browser / private app correctly. No security regression.

**Status:** NOT_TESTED

---

## MANUAL J — THEMES

**Steps:** Check start page + browsing chrome in LIGHT, LOGO, DARK.

**Expected:** Existing theme contracts preserved.

**Status:** NOT_TESTED

---

## MANUAL K — DOWNLOAD REGRESSION

**Steps:** Start an existing supported download. Switch tabs.

**Expected:** Download unaffected by Home/Browser merge.

**Status:** NOT_TESTED

---

## BROWSER START PAGE UX POLISH

### UX A — VISUAL DENSITY

**Expected:** No giant empty gap near top. Brand + Quick Access occupy a balanced upper/middle region.

**Status:** NOT_TESTED

### UX B — 3 × 3 GRID

**Expected:** 9 shortcuts, 3 columns × 3 rows, balanced spacing. No YouTube.

**Status:** NOT_TESTED

### UX C — SHORTCUTS

**Steps:** Tap all 9 (Instagram, TikTok, Facebook, Vimeo, Dailymotion, Reddit, Pinterest, Telegram, X).

**Expected:** Existing Browser navigation path (`loadUrlActiveTab`).

**Status:** NOT_TESTED

### UX D — SMALL DEVICE

**Expected:** Cards fit on narrow Android viewport; no clipping; no horizontal scroll.

**Status:** NOT_TESTED

### UX E — THEMES

**Expected:** Same layout in LIGHT / LOGO / DARK with correct tokens. `#DC3C2C` unchanged for Logo.

**Status:** NOT_TESTED

### UX F — BROWSER TOOLBAR

**Expected:** Compact ~48dp strip; Back / Forward / Home behavior unchanged.

**Status:** NOT_TESTED

### UX G — YOUTUBE

**Expected:** No YouTube promoted shortcut or supported-platform UI. Manual `youtube.com` browse still works as a normal website.

**Status:** NOT_TESTED

### UX H — WEBVIEW REGRESSION

**Steps:** Navigate website → switch app tabs → return.

**Expected:** Same WebView/page state.

**Status:** NOT_TESTED

---

## Bottom navigation checklist

| Tab | Visible | Status |
|-----|---------|--------|
| Browser | Yes (first) | NOT_TESTED |
| Downloads | Yes | NOT_TESTED |
| Library | Yes | NOT_TESTED |
| Settings | Yes | NOT_TESTED |
| Home | No | NOT_TESTED |

---

## Notes

- Static verifier: `npm run verify:unified-browser-phase1`
- Architecture: `docs/ui/UNIFIED-BROWSER-PHASE1-ARCHITECTURE.md`
- APK_NOT_BUILT_BY_REQUEST (phase agent)
