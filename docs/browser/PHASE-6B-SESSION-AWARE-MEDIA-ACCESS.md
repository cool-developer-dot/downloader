# Phase 6B — Session-Aware Media Request Context & Authenticated Source Verification

**Status:** code/static complete — ready for manual Android device test  
**Owns:** minimum legitimate ephemeral session context for verifying accessible media  
**Does not own:** download execution / mid-transfer auth refresh / pause-resume auth (Phase 6C)

---

## 1. Audit

### Existing (proven)

| Layer | Finding |
|---|---|
| `MediaRequestContext` | Already carries `headers` / Referer / UA / Cookie / `hasCookies` |
| `VidoraCookieBridge` | Read-only `CookieManager.getCookie(url)` → JS |
| Progressive / HLS workers | Propagate header bag to master / child / segments |
| Pause persistence | Strips Cookie / Authorization |
| Catalog SQLite | Does not store `requestContext` |
| Phase 6A | Website owns login; no session DB |

### Proven gaps fixed

1. **Page→media cookie copy** — builder preferred page URL cookies then attached to media fetches  
2. **No PUBLIC-first** — cookies attached when social/flags said so, without public probe  
3. **No `authMode`** — only booleans  
4. **Verification cache retained full Cookie** for 45s  
5. **Authorization** — correctly not captured; now explicitly denied in allowlist filter  
6. **DEV media diagnostics** could log full signed URLs  

---

## 2. Existing MediaRequestContext

Extended (not replaced) with:

- `authMode`: `PUBLIC` | `SESSION_COOKIE` | `SESSION_PLUS_REFERER` | `AUTH_HEADER` | `AUTH_CONTEXT_UNAVAILABLE` | `UNSUPPORTED`
- Optional scope: `tabId`, `navigationEpoch`, `pageGeneration`, `mediaIdentity`

Secrets remain in `headers.Cookie` **in memory only** for the live verify/handoff object.

---

## 3. Public-first strategy

```
5A owned media
  → build PUBLIC context (no Cookie)
  → verify
  → success → PUBLIC path (Phase 5 behavior)
  → auth-like failure → ONE session CookieManager(mediaUrl) retry
  → success → SESSION_BOUND_ACCESSIBLE
  → fail → SESSION_EXPIRED / AUTH_CONTEXT_UNAVAILABLE
```

Skip public-first when evidence already implies session-bound (TikTok/Instagram page or `requiresCookies`).

---

## 4. Auth-like failure classification

Auth-like: `401`, `403`, `AUTH_RESPONSE`, login/HTML signature.

**Not** auth-like: `404`, `5xx`, `NOT_MEDIA`, init/fragment/segment, DRM, DASH, blob.

---

## 5–6. Cookie acquisition & target scoping

```
CookieManager.getCookie(mediaUrl)  // ONLY
```

Never:

```
getCookie(pageUrl) → attach to media.cdn.com
```

Android CookieManager enforces domain/path/secure for the target URL.

---

## 7. Same-site / CDN policy

Different media host vs page host is allowed. Cookies for the CDN URL come only from CookieManager for that URL. Referer may be the page URL when generation-scoped.

---

## 8–11. Referer / Origin / UA / Accept

| Header | Policy |
|---|---|
| Referer | Current page URL when owned + scoped; ephemeral; never logged |
| Origin | Only when `includeOrigin` explicitly set |
| User-Agent | Owning tab desktop/mobile UA |
| Accept | `*/*` |

---

## 12–13. Authorization & no interception

**No** generic Authorization capture.  
**No** `shouldInterceptRequest` MITM / traffic dump / JS token scrape.  
If Bearer-only access is required → `AUTH_CONTEXT_UNAVAILABLE`.

---

## 14. Request header allowlist

Allowed: Accept, Referer, User-Agent, Cookie, Origin, Range  
Conditional: Authorization (never auto)  
Denied: Proxy-Authorization, Set-Cookie, Host, Sec-WebSocket-*, etc.

---

## 15–17. Authenticated MP4 / WebM / HLS

Same Phase 5B structural verification with session context on retry:

- MP4: progressive / complete standalone  
- WebM: EBML evidence  
- HLS: `#EXTM3U`, master/media, no segment CTA, DRM rejected  

---

## 18. HLS child / segment context contract (for 6C)

Today Phase 1 reuses one header bag for master → child → segments.

**6C must:**

- Prefer re-resolving cookies via CookieManager per target URL on host change  
- Never blindly copy Authorization cross-origin  
- Re-evaluate on redirect host change  

6B does not change worker execution.

---

## 19–21. DRM / blob / DASH

Unsupported as before: DRM encryption, blob/MSE clue-only, DASH without muxer.

---

## 22. Signed private URLs

Full `executableUrl` kept for verification; stable identity ignores volatile query; never log full signed URL; cache strips Cookie but may hold URL ephemerally (45s).

---

## 23–25. Freshness / 401–403 / login HTML

| Class | Meaning |
|---|---|
| PUBLIC | Verified without cookies |
| SESSION_BOUND_ACCESSIBLE | Verified with mediaUrl cookies |
| SESSION_EXPIRED | Session probe still auth-like |
| AUTH_CONTEXT_UNAVAILABLE | No safe cookie/auth context |
| PROTECTED_UNSUPPORTED | DRM / encrypted / other |

Bounded: public + at most one session retry. No loops.

---

## 26–30. Redirects / generation / logout / account switch / tabs

Scope every context to tab + navigationEpoch + pageGeneration + mediaIdentity.  
Stale after navigation / SPA / logout / account switch / tab close / new media.  
Tab close clears verification cache for that tab — **not** global cookies.

---

## 31–33. Auth cache / secret persistence / logging

- Verification cache: **Cookie/Auth stripped** before store  
- Pause headers: already sanitized  
- SQLite catalog: no requestContext  
- Diagnostics: `[SessionMedia]` events; boolean `cookiePresent` only; URLs → host  

---

## 34–36. Network budget / no polling / performance

At most one justified session re-verify per candidate. Reuse TTL + in-flight join. No cookie polling / auth heartbeat.

---

## 37. No backend

No server, proxy, Firebase, Supabase, auth API.

---

## 38. Phase 6C handoff

6C may assume:

1. Access class: PUBLIC / SESSION_BOUND_ACCESSIBLE / AUTH_CONTEXT_UNAVAILABLE / SESSION_EXPIRED / PROTECTED_UNSUPPORTED  
2. Minimum ephemeral context can be built when safe  
3. Secrets not persisted/logged  
4. Authenticated MP4/WebM/HLS verify where architecture supports  
5. Stale context generation/tab scoped  

6C must answer: can that context travel CTA → enqueue → Phase 1 → transfer without leak/persist/bypass?
