# Phase 5B — General Media Source Verification, Ranking, MP4/WebM & Standard HLS Reliability

**Status:** code/static complete — ready for manual Android device test  
**Owns:** which source/variant for already-selected 5A media is real, supported, and actionable  
**Does not own:** ownership ranking (5A), CTA redesign, Phase 1 worker rewrite, muxing, DRM bypass

---

## Audit findings (pre-implementation)

### Pre-5B verification architecture

```
5A ownership → DetectedMedia candidates
  Social CTA → buildVerifiedSocialMediaOffer (4B hardened)
  General CTA → bare verifyMediaCandidate (MIME/HEAD only)  ← gap
```

### Answers

| # | Finding |
|---|---|
| 1 | **Yes** — generalize 4B primitives; don’t fork a second detector |
| 2 | Social-specific: content identity, platform offer mapping, social refresh provider |
| 3 | `classifyMp4Container` / `sniffMediaSignature` with `requireStandaloneMp4` |
| 4 | EBML `1A 45 DF A3` → webm; Phase 1 progressive accepts WebM |
| 5 | `.m3u8` / mpegurl MIME / `#EXTM3U` via `parseHlsManifest` |
| 6 | Master (`EXT-X-STREAM-INF`) vs media (`EXT-X-TARGETDURATION`) distinguished |
| 7 | Segments rejected in FP filter, 5A, and 4B verify |
| 8 | DOM DRM flags + `#EXT-X-KEY METHOD≠NONE` |
| 9 | Prefer Content-Range total; ignore tiny probe Content-Length |
| 10 | Evidence-only `INCLUDED` / `VIDEO_ONLY` / `AUDIO_ONLY` / `UNKNOWN` |
| 11 | Width/height → label; never URL keywords |
| 12 | Expiry heuristics + 45s verification TTL + max 2 social refreshes |
| 13 | `MediaRequestContext` cookies/Referer/UA in memory |
| 14 | Probe storm risk if verifying all candidates — must cap WEAK→1 / else→6 |
| 15 | Prefer combined A/V, then height, then id — not latest/largest alone |

### Root source risks (general CTA before 5B)

1. MIME/`video/mp4` alone accepted without standalone structure proof  
2. Init segments / media fragments could slip through  
3. No HLS master → multi-quality expand on general path  
4. No ownership-confidence probe budget  
5. 1080p VIDEO_ONLY could beat 720p INCLUDED via legacy path  

---

## Final Phase 5B architecture

```
5A CurrentGeneralMediaContext + CorrelatedGeneralMediaCandidateSet
        ↓
bounded verification (reuse 4B progressive + HLS expand)
        ↓
transport/container classification
        ↓
actionability (audio/DRM/DASH gates)
        ↓
variant metadata + dedupe + ranking
        ↓
VerifiedGeneralMediaOffer → existing quality sheet / Phase 1
```

**Modules**

| Module | Role |
|---|---|
| `general-source/types.ts` | Offer / variant / scope types |
| `general-source/hls-evidence.ts` | HLS audio/quality/size helpers |
| `general-source/general-source-reliability.service.ts` | Offer builder |
| `general-source/general-source-diagnostics.ts` | `[GeneralSource]` safe logs |
| CTA wiring | `useBrowserMediaAction` generalScope → `buildVerifiedGeneralMediaOffer` |

Reuses: `verifySocialSourceCandidate`, `sniffMediaSignature`, `parseHlsManifest` / `fetchManifestText`, identity/quality/audio/variant-policy, verification-session cache+join.

---

## Verified general media offer

```ts
VerifiedGeneralMediaOffer {
  mediaIdentity
  tabId
  navigationEpoch
  pageGeneration
  variants: VerifiedGeneralMediaVariant[]
  preferredVariantId?
  verifiedAt
}
```

## Variant model

Includes: variantId, resourceIdentity, executableUrl, transport, container, mime, dims, bitrate, qualityLabel, sizeBytes, audioState, evidence, requestContext, verifiedAt, sourceGeneration.

---

## HTTP verification

Bounded HEAD/Range via existing candidate verifier + signature probe.  
200 alone insufficient — MIME + structure required.

## MIME policy

Evidence, not truth. HTML/JSON rejected. `octet-stream` + valid MP4 structure may accept.

## MP4 / fMP4 / init / fragment

Preserve Phase 4 hardening via `requireStandaloneMp4`:

| Kind | CTA |
|---|---|
| PROGRESSIVE_OR_COMPLETE | actionable |
| FRAGMENTED_COMPLETE | actionable |
| INIT_SEGMENT | reject |
| MEDIA_FRAGMENT | reject |
| UNKNOWN | reject |

## WebM policy

EBML signature required. Filename `.webm` alone insufficient. Phase 1 progressive supports WebM.

## HLS master / media / segments

- Master: expand `#EXT-X-STREAM-INF` into variants under same media identity  
- Media playlist: single HLS variant for Phase 1 HLS worker  
- `.ts` / `.m4s` never CTA variants  
- Bounded manifest fetch (`fetchManifestText` + max bytes)

## HLS audio groups

CODECS evidence only. Separate AUDIO group without proven mux → VIDEO_ONLY / UNKNOWN. No muxer.

## HLS encryption / DRM

`#EXT-X-KEY` with METHOD≠NONE → `DRM_UNSUPPORTED`. No decryption.

## DASH limitation

Separate A/V DASH → `DASH_UNSUPPORTED`. No FFmpeg. Fragments not CTA.

## Audio evidence

INCLUDED / VIDEO_ONLY / AUDIO_ONLY / UNKNOWN — never inferred from extension alone.

## Quality evidence

Width/height / HLS RESOLUTION only. Unknown → omit. No filename “1080” invent.

## File size / Content-Range

Progressive: credible Content-Length or Content-Range total (`bytes 0-0/N` → N).  
Probe `Content-Length: 1` is not size. HLS size omitted.

## Media / variant / execution identity

- Media identity: 5A  
- Variant identity: media + stable path + transport + dims/bitrate  
- Execution URL: full signed URL preserved  

## Signed URL normalization

Volatile query changes do not create duplicate variants. Execution retains full query.

## Dedupe

Same resourceIdentity → one variant (fresher wins metadata merge). Distinct qualities kept.

## Ranking / preferred variant

1. 5A ownership already fixed the media set  
2. downloadable only  
3. INCLUDED > UNKNOWN > VIDEO_ONLY  
4. higher height  
5. deterministic variantId  

**Example:** 720p INCLUDED beats 1080p VIDEO_ONLY for normal Download Video.

## 5A ownership authority

`ownershipConfidence === 'REJECTED'` → fail immediately (`WEAK_OWNERSHIP`). Ranking cannot resurrect.

## Source freshness / cache / budget

- Verification TTL 45s, in-flight join, max 48 entries  
- Scoped by tab + epoch + pageGeneration + mediaIdentity + stable path  
- WEAK → verify ≤1 candidate; else ≤6  
- No continuous resolver polling  

## Stale generation / tab isolation

Scope checks pageGeneration + tab; closed-tab clears verification cache (existing).

## Performance / no-polling

Event-driven CTA verify only. No `setInterval` in general-source.

## Security / no-backend

No cookies/Authorization/signed URLs in logs. No backend/proxy/FFmpeg/DRM bypass.

---

## Manual acceptance plan

| # | Scenario | Expected | Status |
|---|---|---|---|
| 1 | Simple direct MP4 | Progressive verified CTA | NOT_TESTED |
| 2 | Direct WebM | EBML-verified progressive | NOT_TESTED |
| 3 | HLS media playlist | Single HLS variant → Phase 1 | NOT_TESTED |
| 4 | HLS master 3 qualities | One offer, 3 variants in sheet | NOT_TESTED |
| 5 | Page with MP4 + HLS | Variants under same media; one CTA | NOT_TESTED |
| 6 | HLS with segment traffic | Segments not listed as variants | NOT_TESTED |
| 7 | Unsupported encrypted/DRM | No false downloadable offer | NOT_TESTED |
| 8 | Signed query source | Identity stable; execution keeps query | NOT_TESTED |
| 9 | Unknown-size media | Size omitted; still downloadable | NOT_TESTED |
| 10 | Video-only adaptive | Not preferred over combined; may be unsupported | NOT_TESTED |

---

## Phase 5C handoff

5B outputs `VerifiedGeneralMediaOffer` for general pages.  
5C (if any) should focus on UX polish / multi-source presentation — **not** reopening ownership or inventing muxers.

## Verifier

```bash
cd mobile
npm run verify:phase5b-general-source-reliability
```
