# Phase 5C — End-to-End General Website Media Download Integration

**Status:** code/static complete — ready for real Android acceptance  
**Owns:** integration reliability from 5A/5B → CTA → Phase 1 → completed media  
**Does not own:** 5A ownership ranking, 5B source verification redesign, CTA redesign, Phase 1 rewrite

---

## Audit findings

### End-to-end pipeline (before 5C fixes)

```
Observers → 5A ownership → 5B VerifiedGeneralMediaOffer
  → handoffVerified (contentIdentity/variantIdentity)
  → CTA AVAILABLE
  → single: claimForHandoff → enqueueBrowserMediaDownload → store.create
     multi: beginQualitySelection → quality sheet → create
  → scheduler → progressive / HLS worker → finalize → catalog → player
```

### Root integration risks found

1. Quality sheet did not freeze `pageGeneration` / `navigationEpoch` — SPA confirm could apply stale offer  
2. General handoff stuffed identities into `socialSourceIdentity` with null social generation — wrong refresh shape  
3. General pre-handoff checked fingerprint consume but not content-identity consume (wasted verify only; `setVerified` still blocked)

### Already correct

- 5A→5B→CTA wiring for general pages  
- Consume-on-enqueue; WAITING_FOR_WIFI / FAILED / CANCELLED do not resurrect CTA  
- Fingerprint strips signed query  
- requestContext plumbing to Phase 1  
- WebM progressive + HLS `.m3u8` worker routing  
- Segment / DRM rejection in 5A/5B  
- Tab isolation; no Phase 5 polling  

---

## Final Phase 5C architecture

Phase 5C is an **integration reliability layer**, not a new detector.

Fixes applied:

| Fix | Behavior |
|---|---|
| Quality freeze | `beginQualitySelection` stores navigationEpoch + pageGeneration/socialGeneration + identities |
| Stale quality confirm | `useQualitySelection` no-ops + unlocks when freeze ≠ current generation |
| Social refresh identity | Only attached when `resolveSocialPlatform` is set |
| Content-identity consume | General path mirrors social check before handoff |

---

## Identity propagation

| Layer | Identity |
|---|---|
| 5A | `mediaIdentity` / `pageGeneration` |
| 5B | `resourceIdentity` / `executableUrl` / variants |
| CTA | fingerprint (query-stripped) + contentIdentity + variantIdentity |
| Phase 1 | `downloadId` + requestContext (+ social refresh identity only if social) |

PAGE MEDIA ≠ VARIANT ≠ EXECUTION URL ≠ DOWNLOAD JOB ID

---

## CTA availability / lifecycle

AVAILABLE only when 5A owns media **and** 5B yields ≥1 actionable variant.

Lifecycle preserved: NONE → AVAILABLE → HANDOFF_IN_PROGRESS → CONSUMED (enqueue boundary).

Double-tap: existing `claimForHandoff` atomic lock only.

---

## Quality sheet

Single actionable → direct handoff. Multiple → existing sheet.  
Cancel → AVAILABLE. Confirm with stale SPA generation → no-op.

---

## Progressive / WebM / HLS

- Progressive MP4 → Phase 1 progressive worker  
- WebM → Phase 1 progressive (EBML + SAFE_EXTENSIONS)  
- HLS top-level `.m3u8` → Phase 1 HLS worker  
- Segments never independent CTAs/jobs  
- Unsupported DRM → no CTA  

---

## Pause / resume / Wi-Fi / cancel / fail

Owned by Phase 1. CTA remains CONSUMED after successful enqueue.  
HTTP 200 on resume never blindly appended (Phase 1 contract).

---

## Source freshness

Pre-handoff gate allowed. Social refresh provider remains social-only.  
No Phase 5 parallel refresh service.

---

## Tab / SPA / recycled player

- Tab isolation preserved  
- Tab close after enqueue: download continues; late UI no-op  
- SPA generation freeze blocks stale quality confirm  
- Recycled player bumps 5A `pageGeneration` → new media identity  

---

## Performance / security / no-backend

No `setInterval` / polling in Phase 5 path.  
No cookies/Authorization/signed URL logging.  
No backend / FFmpeg / DRM bypass.

---

## Network request budget

5B verifies once; CTA uses offer. Pre-handoff gate may re-check freshness (allowed). Full duplicate 5B re-run is not performed.

---

## Known limitations

1. General mediaIdentity is path-based (CDN path rotation looks like new media)  
2. General pages have no mid-transfer social-style refresh provider  
3. HLS URLs without `.m3u8` path markers may mis-route (edge)  
4. Playability must be confirmed on real Android — COMPLETED ≠ proven correct content  

---

## Manual acceptance

See `mobile/docs/testing/PHASE-5-GENERAL-MEDIA-REAL-ANDROID-ACCEPTANCE.md` (all NOT_TESTED until device run).

## Verifier

```bash
cd mobile
npm run verify:phase5c-general-download-integration
```
