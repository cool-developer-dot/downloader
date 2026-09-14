# Phase 4B — Social Source Reliability

**Status:** code/static complete — ready for manual Android device test  
**Owns:** source verification, variant identity/grouping, audio/quality evidence, signed-URL stability, bounded refresh  
**Does not own:** which Reel/video is current (Phase 4A), CTA redesign, Phase 1 transfer, muxing/FFmpeg, backend

---

## Audit findings (pre-implementation)

| Area | Finding |
|---|---|
| Phase 4A output | `CorrelatedCandidateGroup` + `SocialPageContext` (content id, generation, ownership) |
| Verification | `verifyMediaCandidate` = redirects + HEAD/Range MIME; did **not** reject HTML/JSON MIME hard enough at CTA path |
| Probe | HEAD first; Range `bytes=0-0` fallback; 5s timeout; cache 60s |
| CTA AVAILABLE | Could appear before `runPreDownloadGate` |
| Stale verify | In-flight verify could finish after Reel swipe — **no contextGeneration guard** |
| Refresh | `refreshMediaFromPage` used **legacy** `pickBestCorrelatedMedia` |
| Fingerprint | Host+path only (signed query stripped) — correct for identity |
| Audio | Presentation already evidence-based; MP4 ≠ Audio Included |
| Phase 1 refresh | Enqueue/resume side only; max one refresh attempt; no worker→browser callback |

---

## Architecture

```
Phase 4A content identity + correlated candidates
        ↓
buildVerifiedSocialMediaOffer (4B)
  - ownership-scoped verify only
  - HTML/JSON/segment/blob reject
  - bounded signature when MIME generic
  - variant identity (stable) vs executable URL (full)
  - audio/quality/size evidence
  - preferred combined variant
        ↓
existing handoffVerified → Phase 3 CTA → Phase 1
```

### Modules (`src/media-detection/social-source/`)

| File | Role |
|---|---|
| `types.ts` | Offer / variant / rejection / freshness types |
| `resource-identity.ts` | Stable path identity vs full executable URL |
| `audio-evidence.ts` | INCLUDED / VIDEO_ONLY / AUDIO_ONLY / UNKNOWN |
| `quality-evidence.ts` | Height→label; credible size only |
| `variant-policy.ts` | Prefer combined; dedupe by resource identity |
| `verification-session.ts` | In-flight join + ephemeral cache |
| `social-source-reliability.service.ts` | Verify + build offer |
| `social-source-provider.ts` | Bounded `getFreshExecutableSocialSource` |

---

## Content vs resource vs execution

- **Content:** `instagram:instagram_reel:ABC` (Phase 4A)
- **Resource / variant:** host+path + transport + dims (ignores `?sig=`)
- **Execution:** full URL **with** query — never strip for download

---

## Verification policy

- HTTP 200 alone is insufficient
- Reject: `text/html`, JSON, segments, blob-only, DRM
- Accept: verified media MIME; `octet-stream` + bounded MP4/WebM signature
- Range-ignoring servers: bounded body read (`TRANSFER_TIMEOUTS.boundedProbeMaxBytes`)
- WEAK ownership: at most one candidate verified (no probe storm)

---

## Audio / quality / size

| Field | Rule |
|---|---|
| Audio Included | Only with `audioCodec` evidence on muxed rep |
| VIDEO_ONLY | Separate A/V or explicit videoOnly — **not** normal Download Video (no muxer) |
| UNKNOWN | Omit label |
| Quality | Short-side height ladder; omit if unknown |
| Size | Positive Content-Length (>1); omit 0/NaN/range-1 |

Preferred default: combined/UNKNOWN progressive over higher VIDEO_ONLY.

---

## Freshness & refresh

- `getFreshExecutableSocialSource` — max 2 attempts per tab/content/variant
- Same content+variant identity; new executable URL
- `refreshMediaFromPage` now prefers Phase 4A `selectCurrentSocialMedia`
- Consumed fingerprint (query-stripped) prevents CTA resurrection on resign

---

## Race / tab safety

- Capture `tabId` + `navigationEpoch` + `socialContextGeneration` before await
- `isSocialScopeCurrent` — stale Reel A result no-ops
- Tab close clears social context + verification cache + refresh budget

---

## Known limitations

1. No FFmpeg — VIDEO_ONLY adaptive cannot become combined download
2. Mime-probe Range `0-0` may yield Content-Length 1 (size omitted)
3. Phase 1 worker still cannot mid-transfer call browser for fresh CDN URL
4. Bounded signature only when MIME is missing/generic
5. Final IG/TT download success not claimed by 4B alone

---

## Manual acceptance

See section 75 of the Phase 4B final report (Instagram progressive, signed refresh, TikTok, multi-quality, audio, expiry, cross-tab). **Do not mark PASS without device test.**

---

## Verifier

```bash
cd mobile
npm run verify:phase4b-social-source-reliability
```
