# Performance / Low-RAM Android Acceptance

Static gate: `npm run verify:performance-hardening`

This document does **not** claim FPS, RAM, or device scores from code review. All runtime cases start **NOT_TESTED**. Do not mark passed without a real Android session.

Device: _______________  
RAM: _______________ (target ≈ 4 GB)  
Build: Expo Go / dev client (no APK from this pass)  
Date: _______________  
Tester: _______________

---

## P1 — 20 MINUTE SESSION

Use the app normally for at least 20 minutes. Browse 10+ pages. Switch tabs. Open Downloads, Library, Settings, History, Bookmarks.

Expected: no progressive lag, no dead buttons, no stuck overlays.

Result: **NOT_TESTED**

Notes:

---

## P2 — TAB STRESS

Create up to 8 Browser tabs. Switch repeatedly.

Expected: maximum 2 WebViews mounted, responsive UI, no continuous memory growth from inactive WebViews.

Result: **NOT_TESTED**

Notes:

---

## P3 — DOWNLOAD + BROWSING

Run a large download. While downloading: browse, switch tabs, open Downloads, Library, Settings.

Expected: UI remains interactive. Download continues correctly.

Result: **NOT_TESTED**

Notes:

---

## P4 — MULTIPLE DOWNLOAD UI

Multiple queued/completed/active items. Scroll Downloads repeatedly.

Expected: smooth list, no whole-screen jank on every progress tick, buttons respond.

Result: **NOT_TESTED**

Notes:

---

## P5 — MEDIA DETECTION STRESS

Visit dynamic media-heavy pages.

Expected: automatic detection continues, no event storm freeze, Video available still works.

Result: **NOT_TESTED**

Notes:

---

## P6 — NAVIGATION LOOP

Repeat 20 times: Browser → Downloads → Library → Settings → Browser.

Expected: no increasing lag, no accumulating overlays/listeners, no memory explosion.

Result: **NOT_TESTED**

Notes:

---

## P7 — OVERFLOW / MODAL TEST

Open/close repeatedly: Browser overflow, Video available sheet, quality sheet, other app modals.

Expected: after closing, every underlying button works. No invisible overlay intercepts touches.

Result: **NOT_TESTED**

Notes:

---

## P8 — PAUSE / RESUME UNDER LOAD

While browsing: start download, pause, resume, pause, resume.

Expected: UI responsive, pause/resume correct, no stuck button, no frozen job.

Result: **NOT_TESTED**

Notes:

---

## P9 — BACKGROUND / FOREGROUND

Use app → background → wait → foreground. Repeat.

Expected: no duplicate listeners, no duplicate WebViews, no UI freeze.

Result: **NOT_TESTED**

Notes:

---

## P10 — LOW-RAM DEVICE

Run on an actual ≈ 4 GB RAM Android device if available. Browse, 5–8 tabs, active download, Library, History, theme switching, media detection.

Expected: app remains practically responsive and stable.

Result: **NOT_TESTED**

Notes:

---

## P11 — LONG SESSION

Use the app for 30–60 minutes.

Expected: performance near end of session is not materially worse solely because VidoraX leaked resources or accumulated work.

Result: **NOT_TESTED**

Notes:

---

## P12 — DEAD BUTTON REPRODUCTION

Specifically attempt to reproduce: after using the app for some time, buttons stop responding.

When it previously happened, capture whether:

- JS thread blocked (progress/media/WebView storm)
- overlay intercepted touches (Modal leftover / elevated full-screen CTA)
- global lock remained true
- memory pressure / GC
- event loop flooded

Static diagnosis for this pass (must be confirmed on device):

1. **Primary:** dismissed Android transparent `Modal` (quality sheet at tab root, overflow, tab switcher, action sheet) remaining in the native Dialog hierarchy.
2. **Primary while Video available is showing:** full-screen elevated wrapper over the WebView (fixed by bottom-anchoring the bar).
3. **Amplifier:** JS starvation from progress catalog writes + owner-listener storms + WebView posts + DEV traces, which makes taps feel dead even without an overlay.

Result: **NOT_TESTED**

Notes:

---

## Static gate

- `npx tsc --noEmit`
- `npm run verify:performance-hardening`

APK / Expo export / `expo prebuild`: **not run** (`APK_NOT_BUILT_BY_REQUEST`).
