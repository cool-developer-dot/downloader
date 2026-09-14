# Phase 4C — Social Download Integration

**Status:** code/static complete — ready for real Android acceptance  
**Owns:** end-to-end identity/handoff/refresh contract from Phase 4A/4B → Phase 3 CTA → Phase 1  
**Does not own:** social ownership (4A), source verification policy (4B), CTA UI redesign, Phase 1 transfer core, DRM bypass, backend

---

## Audit summary

| Question | Finding |
|---|---|
| Pre-start freshness | Yes — `runPreDownloadGate` + bounded refresh before `create` |
| Manual retry refresh | Yes — `resolveRetryEnqueueInput({ forceRefresh })` via provider |
| Resume refresh | Yes — stale URL → provider → restart/continue per Phase 1 |
| Mid-transfer 401/403 | Worker fails `AUTH_ERROR`, wipes partial; `tryRefreshExpiredDownload` one-shot refresh + re-enqueue from **byte 0** |
| Worker source-provider callback | **Added** — narrow registry; no UI import |
| Multi-range / HLS mid-transfer social refresh | Not expanded — HLS uses existing worker; progressive auth refresh restarts |
| Signed URL expires mid-file | Refresh available only after settle; **no blind append** of fresh URL onto partial |
| Narrow hook | `social-source-refresh.provider.ts` + `register-phase1-source-refresh.ts` |

### Mid-transfer refresh decision

**`SMALL_MID_TRANSFER_REFRESH_CONTRACT_REQUIRED`**

Implemented as the smallest safe contract:

- Typed provider outcomes: `FRESH` / `NO_SOURCE` / `STALE_CONTEXT` / `UNSUPPORTED`
- Same `contentIdentity` + `variantIdentity` when Phase 4B context is live
- Falls back to `refreshMediaFromPage` when tab context is unavailable but `pageUrl` remains
- Phase 1 remains authoritative for Range / identity / restart
- After AUTH wipe, refresh **restarts from 0** (never assumes same Reel ⇒ same bytes)
- Closed tab ⇒ `STALE_CONTEXT` / `NO_SOURCE` ⇒ existing retry/failure path (no WebView resurrection)

---

## End-to-end architecture

```
TikTok / Instagram page
        ↓
Phase 4A SocialPageContext + contentIdentity
        ↓
correlated candidates (STRONG/MEDIUM)
        ↓
Phase 4B VerifiedSocialMediaOffer + variants
        ↓
handoffVerified(contentIdentity, variantIdentity, full executable URL)
        ↓
Phase 3E CTA AVAILABLE (only if actionable verified variant)
        ↓
Phase 3F claimForHandoff / quality lock
        ↓
pre-handoff gate (+ bounded refresh if stale)
        ↓
enqueueBrowserMediaDownload → downloadsStore.create → downloadEngine.enqueue
        ↓
session meta (ephemeral requestContext + socialIdentity)
        ↓
scheduler → TransferWorker / HLS worker
        ↓
pause / resume / retry / AUTH refresh via provider
        ↓
FINALIZING → file validation → COMPLETED
```

---

## Identity propagation

| Layer | Identity |
|---|---|
| Browser offer | `tabId` + `navigationEpoch` + `socialContextGeneration` + `contentIdentity` + `variantIdentity` |
| CTA consume key | media fingerprint **and** `content:{tabId}:{contentIdentity}` |
| Phase 1 session | ephemeral `socialIdentity` (no signed query / cookies persisted) |
| Execution | full signed URL in `MediaRequestContext` / worker request only |

Content identity is **not** proof that refreshed bytes may append.

---

## CTA lifecycle

`NONE → AVAILABLE → HANDOFF_IN_PROGRESS → CONSUMED` on successful Phase 1 enqueue.

Consumed remains for:

- same-media rediscovery (DOM/XHR/fetch/Performance/native)
- signed URL / CDN path refresh for same content identity
- later WAITING_FOR_WIFI / FAILED / CANCELLED / PAUSED

New content identity → new AVAILABLE.

---

## Source freshness

1. **4B** — actionable?  
2. **Pre-handoff** — still fresh enough to enqueue? (gate + provider)  
3. **Phase 1** — safe transfer / resume / finalize?

Failed pre-handoff refresh → no job; handoff released to AVAILABLE or NONE.

---

## Pause / resume / retry

- Pause: Phase 1 stops work; CTA stays CONSUMED  
- Resume: may refresh via provider; Range/identity validation decides continue vs restart  
- Manual/auto retry: same provider; AUTH refresh bounded by `refreshAttempted` + Phase 4B `MAX_REFRESH_ATTEMPTS=2`

---

## Range / integrity

Unchanged Phase 1 rules:

- HTTP 206 + matching Content-Range required to append  
- HTTP 200 with partial ⇒ restart / fail — never append  
- Incompatible etag/length ⇒ `SOURCE_CHANGED`  
- HTML/JSON rejected in 4B and again at finalize

---

## HLS

Supported non-DRM HLS still uses Phase 1 HLS worker. No new HLS architecture in 4C. Mid-transfer social refresh for HLS manifests remains a known limitation unless existing HLS refresh already covers it.

---

## Security / performance

- No full signed URL / cookie / Auth logging  
- No backend / proxy / social API / FFmpeg  
- No 1s polling / setInterval refresh storms in Phase 4 paths  
- Provider has no React / BrowserScreen dependency  

---

## Known limitations

1. Mid-transfer AUTH expiry still **restarts from byte 0** after wipe (safe; not mid-byte URL swap).  
2. Fresh-source lookup needing live WebView fails safely when tab closed.  
3. Real Instagram/TikTok device playability is **NOT** claimed here.  

---

## Manual acceptance

See `mobile/docs/testing/PHASE-4-TIER1-SOCIAL-REAL-ANDROID-ACCEPTANCE.md` (all cases `NOT_TESTED` until human device pass).

## Verifier

```bash
cd mobile
npm run verify:phase4c-social-download-integration
```
