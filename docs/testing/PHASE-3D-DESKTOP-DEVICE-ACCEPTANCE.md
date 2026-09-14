# Phase 3D — Desktop Site Device Acceptance

**Date:** 2026-09-06  
**Device:** Android emulator `Pixel_8` (`emulator-5554`, `sdk_gphone64_arm64`)  
**Package:** `com.anonymous.vidorax`  
**APK under test (runtime):** release `app-release.apk` (embedded JS bundle)  
**Automation:** Maestro flow `docs/testing/maestro/phase3d-desktop-handoff.yaml`  
**Evidence dir:** `docs/testing/phase3d-evidence/`

## Environment notes

- Debug APK requires Metro (`Unable to load script` without bundler). Release APK used for standalone UI acceptance.
- `[BrowserDesktop]` diagnostics are `__DEV__`-gated → **not available** on release APK logcat.
- `adb shell input text` does not reliably type into RN address bar on this emulator; Home Quick Access handoff used instead.

## Fix applied during acceptance

**NAVIGATION / TAB_ISOLATION:** Home → Browser Quick Access handoff could consume `pendingNavigationService` before the active tab WebView controller registered, calling noop `loadUrl` and silently dropping the URL.

- Files: `BrowserScreen.tsx` (peek + wait for `tabControllerRegistry.getActive`), `useBrowserHome.ts` (prefer mounted controller)
- Regression: `verify:browser-desktop-site` assertion for deferred consume

## Runtime matrix

| Test ID | Action | Expected | Actual | Status | Evidence |
|--------|--------|----------|--------|--------|----------|
| T1 | Open YouTube via Home Quick Access, Desktop OFF | Mobile page loads; menu Desktop OFF | `m.youtube.com` / YouTube mobile chrome; menu OFF | **PASS** | `H01-youtube.png`, `H01-menu-off.png` |
| T2 | Toggle Desktop ON (Switch a11y) | One controlled transition; menu ON; desktop request | Toggle applied; prior run showed ON + `?app=desktop`; this run menu screenshot timing ambiguous vs page still `m.youtube.com` briefly | **PASS** (with note) | `H02-menu-desktop-on.png`, `H02-page-desktop.png`; earlier run `step-016-assertCondition-Open_browser_menu.png` showed toggle ON |
| T3 | Toggle Desktop OFF | One controlled transition; menu OFF | Menu OFF; URL retained desktop query remnant `...?app=desktop` while toggle OFF | **PASS** | `H03-menu-desktop-off.png` |
| T4 | Tab A YouTube toggled; New Tab B Instagram | B Desktop OFF independent | Tab badge 2; Instagram menu Desktop OFF | **PASS** | `H04-tabB-menu-should-be-off.png`, `H05-switcher.png` |
| T5 | Open tab switcher with 2 tabs | Switcher lists tabs; no crash | `Tabs 2/8`; YouTube + Instagram listed | **PASS** | `H05-switcher.png` |
| T6 | Menu checkmark isolation | Active tab menu reflects that tab | A had Desktop exercises; B Instagram OFF | **PASS** | `H01-menu-off.png`, `H04-tabB-menu-should-be-off.png` |
| T7 | Mid-load Desktop toggle | Deferred single reload | Not deliberately exercised on slow load | **NOT_TESTED** | — |
| T8 | Rapid ON/OFF | Final mode stable; no storm | Not exercised as dedicated rapid sequence | **NOT_TESTED** | — |
| T9 | Switch during Desktop reload | No cross-tab chrome leak | Not exercised | **NOT_TESTED** | — |
| T10 | Close during Desktop reload | Safe abort | Not exercised | **NOT_TESTED** | — |
| T11 | Evict Desktop tab (3+ tabs) | Restore with Desktop UA before load | Only 2 tabs created; eviction not forced | **NOT_TESTED** | — |
| T12 | Evict Mobile tab | Restore mobile UA before load | Not exercised | **NOT_TESTED** | — |
| T13 | Session after Desktop toggle | Cookies not cleared by app | No safe test account | **BLOCKED** | — |
| T14 | Error isolation | Per-tab BrowserFailure | Not exercised | **NOT_TESTED** | — |
| T15 | TikTok Desktop OFF | No auto Desktop flip | TikTok URL load; menu Desktop OFF | **PASS** (menu) | `H15-tiktok.png`, `H15-menu.png` |
| T15b | TikTok content vs URL | Content matches active URL | Screenshot showed Instagram content while URL `www.tiktok.com` (possible race or mount mismatch) | **FAIL** (investigate) | `H15-tiktok.png` |
| T16 | TikTok explicit Desktop ON | One user-owned reload; menu ON | Toggle tapped; menu still OFF in capture (loading) | **FAIL** / inconclusive | `H16-tiktok-desktop-menu.png` |
| T17 | Instagram | Functional; Desktop OFF default | Instagram loaded; Desktop OFF | **PASS** | `H04-tabB-menu-should-be-off.png` |
| T18 | Media CTA cross-tab | No CTA leak | Not exercised | **NOT_TESTED** | — |
| T19 | Mounted WebViews ≤2 | Pool bound | 2 tabs open; switcher `2/8`; no third WebView observed | **PASS** (partial) | `H05-switcher.png` |
| T20 | React lifecycle warnings | No unmounted update warnings | Release build; no redbox during exercised path | **PASS** (partial) | Maestro completed through T16 without crash |

## Automated gates (re-run after fix)

- `tsc --noEmit` — PASS  
- `verify:browser-desktop-site` — 30/30 PASS  
- Phase 3A/3B/3C + Phase 2 browser suites — PASS  
- Phase 1 suites — PASS  
- `expo export --platform android` — PASS  
- `assembleRelease` — PASS (2026-09-06 22:04)  
- `assembleDebug` — artifact present (debug still Metro-dependent)

## Finalization decision

Mandatory critical runtime gates are **not all PASS**. Several required cases remain **NOT_TESTED**, TikTok content/URL mismatch is a **FAIL** requiring investigation, and Desktop diagnostics could not be captured on release.

**Status: `PHASE_3D_RUNTIME_BLOCKED`**

Do not claim PRODUCTION READY.
