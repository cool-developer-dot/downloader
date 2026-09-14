# Download CTA Persistence Hardening

## 1. Pre-fix CTA lifecycle

Phase 3F:

`NONE → AVAILABLE → HANDOFF_IN_PROGRESS → CONSUMED`

Pipeline:

active video observation → social/general context → content identity → verify → `handoffVerified` → presentation → Download CTA.

## 2. Exact disappearance root cause

Proven combination:

1. **OVER_EAGER_OFFER_INVALIDATION** — `invalidateStaleSocialOffer(nextIdentity)` ran on every `discovery.media` change whenever identity strings differed, including ephemeral CDN path churn and weak ownership noise.
2. **CTA_AVAILABLE_NOT_STICKY** — failed/transient re-verify called `setStatus('idle')`, mapping to NONE and hiding the card even when the same content still had a valid offer.
3. **SOURCE_REFRESH_RESETS_CTA / CONTENT_IDENTITY_INSTABILITY** — candidate id / signed path changes restarted verification even while content identity was unchanged.
4. **PRESENTATION_SELECTOR_REGRESSION** — presentation hid the card whenever `liveIdentity !== offerIdentity`, including weak/transient gaps.

Not a Phase 7 issue. Not fixed with timers.

## 3. Sticky AVAILABLE rule

`shouldRetainAvailableCta` keeps AVAILABLE/HANDOFF while:

- next identity is null (transient gap), or
- next identity equals offer identity, or
- next ownership is only WEAK/null

`shouldStartVerification` skips re-entry when AVAILABLE already covers the same content identity (CDN/candidate churn).

## 4. Same-content source refresh

CDN query/path refresh that keeps content identity:

- does not invalidate offer
- does not restart detecting
- CTA stays visible
- tap path still uses Phase 4B/5B freshness before enqueue

## 5. New-video transition

`shouldInvalidateCurrentMedia` clears A only when B is STRONG/MEDIUM and identities differ.

Then B verifies → new AVAILABLE.

## 6. Social ownership

Social STRONG/MEDIUM correlation owns invalidation. WEAK cannot steal sticky A.

## 7. General ownership

Same sticky invalidation/presentation rules for Phase 5 identities.

## 8. Stale async safety

`shouldAcceptVerificationResult` scopes by tabId, navigationEpoch, generation, content identity.

## 9. Verification TTL

TTL expiry alone does not clear presentation. Sticky AVAILABLE remains; execution may revalidate on tap.

## 10. Quality sheet

Open locks selection (not consume). Cancel → `endQualitySelection` restores AVAILABLE. Consume only after accepted enqueue.

## 11. Consumed behavior

Same content identity stays CONSUMED across CDN refresh. New identity may become AVAILABLE.

## 12. Tab behavior

Per-tab slices; active tab presentation only; inactive stale events rejected by accept helper.

## 13. Memory bounds

Existing `MAX_CONSUMED_PER_TAB`; current + previous social generation; no per-video CTA history store.

## 14. No-polling rule

No setInterval / visibility timeout / DOM poll. Event-driven observers only.

## 15. Manual acceptance

`mobile/docs/testing/DOWNLOAD-CTA-PERSISTENCE-REAL-ANDROID-ACCEPTANCE.md`
