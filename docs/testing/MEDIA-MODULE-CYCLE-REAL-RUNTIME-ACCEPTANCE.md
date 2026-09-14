# Media Module Require-Cycle — Real Runtime Acceptance

Status of all cases below: **NOT_TESTED**

Static/code verification removed the request-context ↔ browserStore ↔ social-source require cycle. Metro console behavior must still be confirmed on a running app.

## A. Metro launch

1. Start Metro / Expo for VidoraX mobile.
2. Cold-launch the Android app.

Expected:

- No Metro `Require cycle` warnings involving:
  - `request-context.service`
  - `session-media`
  - `browserStore` / `browser/stores`
  - `social-source`

## B. Instagram social path

3. Open Instagram in the in-app browser.
4. Navigate to a post with downloadable media.
5. Confirm media detection / CTA still appears.

Expected: Phase 4 social correlation + CTA unchanged.

## C. TikTok social path

6. Open TikTok.
7. Detect media.
8. Open quality / download CTA.

Expected: social source verification + download handoff still works.

## D. Authenticated / session website

9. Open a site that requires cookies for media.
10. Trigger analyze/download.

Expected: Phase 6 session-bound request context still attaches Cookie for media URL only; public media still works without cookies.

## E. Quality selection

11. Open quality sheet from CTA.
12. Select a quality and start download.

Expected: request context builders still succeed; no undefined import crashes.

## F. Phase 1 social source refresh

13. If a social CDN URL expires / refresh is triggered during download.

Expected: `ensurePhase1SocialSourceRefreshRegistered` path still refreshes executable URL.

## G. Desktop mode UA

14. Toggle Desktop Site on a tab.
15. Detect / download media from that tab.

Expected: session request context still prefers the tab desktop UA (via snapshot accessor binding).

---

**APK_NOT_BUILT_BY_REQUEST** — device validation is manual after a normal local rebuild when ready.
