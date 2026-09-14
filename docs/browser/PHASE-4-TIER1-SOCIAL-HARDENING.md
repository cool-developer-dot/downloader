# Phase 4 Tier-1 Social Hardening

**Status:** code/static complete — ready for manual Android acceptance  
**Trigger:** Real Instagram Reel failure (~348 KB download → `The downloaded file was not a valid video.`)  
**Scope:** Instagram + TikTok source-validity hardening (not a new feature phase)

---

## Known Instagram failure (DcmMB5FAKt6)

Observed:

- Media detected → CTA → Phase 1 job created  
- ~348.3 KB transferred  
- Final validation failed with invalid video message  
- Other Reels still succeed  

### Root cause classification

**`BAD_SOURCE_SELECTED`**

Proven mechanism (code evidence, not shortcode-specific):

1. Instagram served an fMP4 **subresource** (init segment and/or media fragment) with MIME `video/mp4`.
2. Phase 4B treated `video/mp4` as sufficient — **skipped structural classification** when MIME looked valid.
3. `sniffMediaSignature` historically treated **`ftyp` alone as ok**, which is true for init segments too.
4. Tiny-body filter only rejected ≤4 KB, so ~348 KB init/fragment passed.
5. Phase 1 downloaded the entire small resource.
6. Final/signature path correctly refused non-standalone structure (especially **moof-first fragments** without playable standalone layout) → user-facing invalid video.

Production fix is **generic**: never shortcode-gate `DcmMB5FAKt6`.

---

## What was fixed

| Area | Change |
|---|---|
| ISO BMFF classify | New `mp4-box-classify.ts` — INIT_SEGMENT / MEDIA_FRAGMENT / PROGRESSIVE_OR_COMPLETE / FRAGMENTED_COMPLETE |
| Phase 4B | Always bounded structural probe for `video/*` social candidates; reject init/fragment |
| Phase 1 finalize | `requireStandaloneMp4: true`; scan entire file when ≤1 MiB |
| MIME probe | Prefer **Content-Range total**; ignore tiny 206 Content-Length slices |
| Size evidence | Ignore probe lengths ≤4096 as full size |
| Valid fMP4 | `ftyp+moof+mdat` remains actionable (not blind moof reject) |

---

## Source classification model

- **PROGRESSIVE_OR_COMPLETE** — ftyp + mdat (or ftyp+moov with large total, mdat later)  
- **FRAGMENTED_COMPLETE** — ftyp + moof + mdat (standalone fMP4)  
- **INIT_SEGMENT** — ftyp + moov, no mdat, small/complete resource  
- **MEDIA_FRAGMENT** — moof without initialization / moof-first  
- **UNKNOWN** — insufficient evidence → not normal Download Video for social  

---

## Intentionally NOT changed

- Phase 4A ownership model  
- Phase 3 CTA lifecycle  
- Mid-transfer AUTH wipe + restart-from-0  
- No FFmpeg / muxer / backend  
- No DRM bypass  

---

## TikTok re-audit

Same structural rules apply. Preferred variant policy still prefers **INCLUDED** combined over silent higher **VIDEO_ONLY**. Preload/neighbor remains 4A REJECTED. Signed query ≠ new content identity.

---

## Manual acceptance

See `docs/testing/PHASE-4-TIER1-SOCIAL-REAL-ANDROID-ACCEPTANCE.md` — includes mandatory **DcmMB5FAKt6** case marked `NOT_TESTED` until human device pass.

## Verifier

```bash
npm run verify:phase4-tier1-social-hardening
```
