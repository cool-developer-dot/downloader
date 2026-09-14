# Phase 3G — Real APK Acceptance Checklist

**Product:** VidoraX (Android)  
**Package:** `com.anonymous.vidorax`  
**Companion:** `PHASE-3G-CODE-REGRESSION-GATE.md` (static gate — passed)

This document is for **manual device testing only**.  
Do **not** mark PASS unless a human verified the behavior on a real APK install.

---

## Artifacts to install

| Variant | Path |
|---|---|
| Debug | `/Users/mac/Downloads/Vidora/mobile/android/app/build/outputs/apk/debug/app-debug.apk` |
| Release | `/Users/mac/Downloads/Vidora/mobile/android/app/build/outputs/apk/release/app-release.apk` |

Suggested: install **Release** for acceptance; use Debug only if logcat is needed.

---

## Status legend

| Status | Meaning |
|---|---|
| NOT_TESTED | Default — not yet exercised on device |
| PASS | Observed correct behavior on device |
| FAIL | Observed incorrect behavior (attach notes) |
| BLOCKED | Could not exercise (environment/setup) |

---

## Checklist

### 1. Browser starts with 1 tab

- [ ] Status: **NOT_TESTED**
- Notes:

### 2. New Tab → count becomes 2

- [ ] Status: **NOT_TESTED**
- Notes: Menu New Tab and/or switcher New Tab

### 3. Create 3 tabs → switch between all

- [ ] Status: **NOT_TESTED**
- Notes: Address/title/content match active tab

### 4. Close middle tab → remaining state correct

- [ ] Status: **NOT_TESTED**
- Notes:

### 5. Close active tab → another tab activates

- [ ] Status: **NOT_TESTED**
- Notes: Neighbor selection deterministic

### 6. Desktop ON in Tab A → one reload → desktop version requested

- [ ] Status: **NOT_TESTED**
- Notes:

### 7. Tab B remains Mobile

- [ ] Status: **NOT_TESTED**
- Notes: Cross-tab Desktop isolation

### 8. Desktop OFF A → mobile restored

- [ ] Status: **NOT_TESTED**
- Notes: Stock mobile UA / layout

### 9. Verified video in A → CTA appears

- [ ] Status: **NOT_TESTED**
- Notes: Accurate metadata; unknowns omitted

### 10. B without media → no CTA

- [ ] Status: **NOT_TESTED**
- Notes:

### 11. Return A → correct CTA

- [ ] Status: **NOT_TESTED**
- Notes: Tab-scoped media/action state

### 12. Tap Download → successful enqueue → CTA disappears immediately

- [ ] Status: **NOT_TESTED**
- Notes: Do **not** wait for COMPLETED; check Downloads for QUEUED/DOWNLOADING

### 13. Same media rediscovered → CTA remains hidden

- [ ] Status: **NOT_TESTED**
- Notes: SPA rescan / signed URL refresh

### 14. New video → CTA appears

- [ ] Status: **NOT_TESTED**
- Notes:

### 15. Downloads → job continues independently

- [ ] Status: **NOT_TESTED**
- Notes: Close source tab mid-download if possible

### 16. Back / Forward / Reload → correct per tab

- [ ] Status: **NOT_TESTED**
- Notes: Also Android hardware Back vs toolbar Back

### 17. Session / login → shared session survives normal tab usage

- [ ] Status: **NOT_TESTED**
- Notes: Shared WebView cookies; **MANUAL_ONLY** proof

### 18. Error page → no stale CTA

- [ ] Status: **NOT_TESTED**
- Notes: Branded error; CTA hidden; Retry/Home on failing tab only

---

## Extra spot checks (optional)

- [ ] Rapid double-tap Download → one job only — **NOT_TESTED**
- [ ] Quality sheet cancel → CTA still available — **NOT_TESTED**
- [ ] Home → no CTA — **NOT_TESTED**
- [ ] Intent/Instagram deep link does not crash / wrong-tab navigate — **NOT_TESTED**

---

## Overall manual acceptance

| Field | Value |
|---|---|
| Tester | |
| Device / Android version | |
| APK variant | |
| Date | |
| Overall | **NOT_TESTED** |

Do not set overall to PASSED until all 18 primary cases are PASS.
