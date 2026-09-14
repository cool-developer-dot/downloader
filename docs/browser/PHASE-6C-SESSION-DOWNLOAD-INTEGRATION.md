# Phase 6C — Session Download Integration

**Status:** code gate complete — ready for real Android acceptance  
**Platform:** Android only  
**Does not claim:** Phase 6 finalized, production-ready, or all logged-in sites supported

---

## 1. Audit (pre-6C)

Proven gaps in the live codebase:

| Gap | Risk |
|-----|------|
| HLS reused one `buildDownloadHeaders` bag for master/child/segments | Cross-host Cookie leakage |
| Workers never called CookieManager per target | Stale verification Cookie reused |
| `clearDownloadSessionMeta` unused on terminal | Secrets could linger in RAM |
| Process restart REENQUEUE with `requestContext: null` | Session-bound transfer without auth |
| Live CookieManager refresh without coherence | Account B cookies on Account A job |
| CTA/quality held raw Cookie in memory state | Long-lived UI secret retention |

Already solid: pause header sanitize, catalog without requestContext, Phase 6B public-first + strip-secrets, social Phase 4 refresh isolation.

---

## 2–5. End-to-end architecture

```
Website login (WebView CookieManager)
  → 5A ownership → 5B verify → 6B access class
  → PUBLIC | SESSION_BOUND_ACCESSIBLE
  → CTA / quality (secrets stripped from UI state)
  → claimForHandoff → CONSUMED on enqueue accept
  → Phase 1 downloadId
  → PUBLIC: existing Phase 1 path
  → SESSION_BOUND: ephemeral DownloadSessionMeta (in-memory)
  → resolveEphemeralHeadersForTarget(downloadId, targetUrl)
  → CookieManager.getCookie(targetUrl) only
  → progressive / HLS transfer
  → Phase 1 finalization
  → clearDownloadSessionMeta on COMPLETED|FAILED|CANCELLED
```

---

## 6–8. Public vs session-bound / identity / CTA

- **Public:** no ephemeral auth registry required; empty resolve → existing headers path.
- **Session-bound:** `accessMode=SESSION_BOUND_ACCESSIBLE`, `cookieStrategy=COOKIE_MANAGER_PER_TARGET`.
- Identity on meta (non-secret): tabId, navigationEpoch, pageGeneration, mediaIdentity.
- CTA CONSUMED on successful enqueue (Phase 3 lifecycle unchanged).

---

## 9–12. Quality / ephemeral model / persistence

- Quality/CTA stores **sanitized** requestContext (no Cookie/Authorization).
- Ephemeral registry: `download-session-meta.ts` Map keyed by downloadId (cap 64).
- Persistable: Phase 1 record + non-secret `requiresEphemeralSession` boolean.
- **Never persist:** Cookie, Authorization, OTP, password, raw requestContext secrets.

---

## 13–16. Persistence reviews

- Download record: no Cookie/Auth/requestContext.
- Cookie: only via CookieManager at request time; stripped from meta/UI.
- Authorization: never captured (6B policy preserved).
- Private signed URL: may remain as `sourceUrl` for Phase 1 identity; no secret logging; no fake general resolver — expiry → fail safely (social refresh remains Phase 4 only).

---

## 17–24. Progressive auth

- Initial/resume: `resolveEphemeralHeadersForTarget` with coherence check.
- Pause: `sanitizePauseHeaders` drops Cookie/Auth.
- Resume: rebuild headers from CookieManager; Range/206 append rules unchanged; HTTP 200 never appends.
- 401/403: at most one `tryBoundedAuthContextRetry`; then `SESSION_EXPIRED` (never auto-retry).
- Signed URL expiry: no general invent-resolver; social path unchanged.

---

## 25–37. Authenticated HLS

- Master / child / segment each call `resolveEphemeralHeadersForTarget` for **that URL**.
- Parent Cookie never copied to unrelated CDN hosts.
- Redirects: session-bound playlist fetch uses `redirect: 'manual'` + `resolveRedirectHeaders`.
- Referer/UA from ephemeral meta (page/tab); Origin only if already policy-allowed.
- Authorization unavailable → AUTH_CONTEXT_UNAVAILABLE path (no bearer interception).
- HLS 401/403: bounded auth retry once per budget; then SESSION_EXPIRED.
- Logout: no cookie restore; next request may fail.
- Account switch: session coherence fingerprint mismatch → SESSION_CHANGED.
- DRM / EXT-X-KEY ≠ NONE: still rejected; `.ts`/`.m4s` not standalone CTA.

---

## 38–49. Coherence / logout / tabs / process death / Wi-Fi / cleanup

- Coherence: FNV fingerprint of page cookie material at handoff; compared before re-resolution.
- Logout during download: in-flight may finish or later 401/403 — no re-login.
- Multi-tab: shared CookieManager (website-normal); isolated media/CTA/downloadId.
- Cross-site: CookieManager(targetUrl) only.
- Tab close after enqueue: does not cancel Phase 1; late CTA callbacks no-op.
- Process death: ephemeral meta gone; `requiresEphemeralSession` → SESSION_CONTEXT_LOST; no infinite scheduler retry.
- WAITING_FOR_WIFI: no Cookie in persisted state.
- Cancel/Failed/Completed: `clearDownloadSessionMeta`.

---

## 50–56. Errors / retries / policies

| Code | User-facing gist |
|------|------------------|
| SESSION_EXPIRED | Session expired — open website and try again |
| SESSION_CONTEXT_LOST | Needs active website session — retry |
| SESSION_CHANGED | Account changed — try again |
| AUTH_CONTEXT_UNAVAILABLE | Protected media cannot be downloaded |

Blob/MSE/DASH/DRM policies unchanged. Phase 1 integrity validation remains authoritative.

---

## 57–66. Regressions / redaction / performance / no-backend

- Phase 4 social refresh preserved (identity + signed URL refresh).
- Phase 5 public path unchanged.
- `[SessionDownload]` diagnostics: booleans/categories/hosts only.
- No cookie/auth polling; resolve only at network execution.
- No backend, session DB, FFmpeg, DRM bypass, MITM.

---

## 67–68. Known limitations

- Session-bound downloads cannot auto-resume after process death when ephemeral context is gone (by design).
- Sites using Blob/MSE-only, DRM, or proprietary encrypted protocols remain unsupported.
- Telegram/WhatsApp/Snapchat Web are best-effort examples — not Phase 6 acceptance dependencies.

---

## Verifier

```bash
cd mobile
npm run verify:phase6c-session-download-integration
```

## Acceptance

See `mobile/docs/testing/PHASE-6-SESSION-MEDIA-REAL-ANDROID-ACCEPTANCE.md` — all items `NOT_TESTED` until human device runs.
