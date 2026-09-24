/**
 * Download CTA persistence — sticky AVAILABLE for current content identity.
 *
 * Presentation is tied to content identity + verified offer, not the latest
 * network/candidate event. No timers. No polling.
 */

import type { BrowserMediaActionStatus } from './browser-media-action.types';
import { toBrowserMediaCtaState } from './browser-media-action.types';

export type OwnershipConfidence = 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECTED' | null;

export type CtaRetainInput = {
  status: BrowserMediaActionStatus;
  offerContentIdentity: string | null | undefined;
  nextContentIdentity: string | null | undefined;
  nextOwnershipConfidence?: OwnershipConfidence;
};

export type InvalidateCurrentMediaInput = {
  priorContentIdentity: string | null | undefined;
  nextContentIdentity: string | null | undefined;
  nextOwnershipConfidence: OwnershipConfidence;
  /** True when selection/handoff must not be interrupted. */
  handoffOrSelectionLocked?: boolean;
};

export type AcceptVerificationResultInput = {
  resultTabId: string;
  activeTabId: string | null;
  resultNavigationEpoch: number;
  currentNavigationEpoch: number;
  resultContentIdentity: string | null | undefined;
  currentContentIdentity: string | null | undefined;
  resultGeneration: number;
  currentGeneration: number;
};

export type StartVerificationInput = {
  status: BrowserMediaActionStatus;
  offerContentIdentity: string | null | undefined;
  nextContentIdentity: string | null | undefined;
  verifiedCandidateId: string | null | undefined;
  nextCandidateId: string | null | undefined;
  selectionLocked?: boolean;
};

export function isSameContentIdentity(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return a.trim() === b.trim();
}

function isStrongOwner(confidence: OwnershipConfidence): boolean {
  return confidence === 'STRONG' || confidence === 'MEDIUM';
}

/**
 * Keep AVAILABLE visible while the same content remains current.
 * Transient verify failures / candidate churn must not clear it.
 */
export function shouldRetainAvailableCta(input: CtaRetainInput): boolean {
  const cta = toBrowserMediaCtaState(input.status);
  if (cta !== 'AVAILABLE' && cta !== 'HANDOFF_IN_PROGRESS') {
    return false;
  }
  if (!input.offerContentIdentity) {
    // Fingerprint-only offers: retain while status is AVAILABLE unless a strong
    // new identity arrives (handled by shouldInvalidateCurrentMedia).
    return cta === 'AVAILABLE';
  }
  if (!input.nextContentIdentity) {
    // Transient ownership gap — retain sticky AVAILABLE.
    return true;
  }
  if (isSameContentIdentity(input.offerContentIdentity, input.nextContentIdentity)) {
    return true;
  }
  // Different identity but not yet a strong owner — retain until B is strong.
  if (!isStrongOwner(input.nextOwnershipConfidence ?? null)) {
    return true;
  }
  return false;
}

/**
 * Clear Video A presentation only when Video B is a strong new owner.
 * WEAK / null / missing next identity must not wipe a sticky AVAILABLE offer.
 */
export function shouldInvalidateCurrentMedia(
  input: InvalidateCurrentMediaInput,
): boolean {
  if (input.handoffOrSelectionLocked) {
    return false;
  }
  if (!input.nextContentIdentity) {
    return false;
  }
  if (
    input.priorContentIdentity &&
    isSameContentIdentity(input.priorContentIdentity, input.nextContentIdentity)
  ) {
    return false;
  }
  // No live offer identity yet — allow first-time invalidation only with strong owner.
  if (!isStrongOwner(input.nextOwnershipConfidence)) {
    return false;
  }
  // Strong new identity (or first strong identity while offer had none).
  if (!input.priorContentIdentity) {
    return true;
  }
  return !isSameContentIdentity(
    input.priorContentIdentity,
    input.nextContentIdentity,
  );
}

/**
 * Skip starting a new verification when AVAILABLE already covers this content.
 * Candidate id / CDN URL churn must not restart detecting → idle flicker.
 */
export function shouldStartVerification(input: StartVerificationInput): boolean {
  if (input.selectionLocked || input.status === 'preparing') {
    return false;
  }
  if (
    input.verifiedCandidateId &&
    input.nextCandidateId &&
    input.verifiedCandidateId === input.nextCandidateId
  ) {
    return false;
  }
  const cta = toBrowserMediaCtaState(input.status);
  if (cta === 'AVAILABLE' || cta === 'HANDOFF_IN_PROGRESS') {
    if (
      input.offerContentIdentity &&
      input.nextContentIdentity &&
      isSameContentIdentity(input.offerContentIdentity, input.nextContentIdentity)
    ) {
      return false;
    }
    // Same AVAILABLE without identity change signal — do not re-enter detecting.
    if (
      cta === 'AVAILABLE' &&
      input.offerContentIdentity &&
      !input.nextContentIdentity
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Stale async verification must not apply over a different current media/tab.
 */
export function shouldAcceptVerificationResult(
  input: AcceptVerificationResultInput,
): boolean {
  if (!input.activeTabId || input.resultTabId !== input.activeTabId) {
    return false;
  }
  if (input.resultNavigationEpoch !== input.currentNavigationEpoch) {
    return false;
  }
  if (input.resultGeneration !== input.currentGeneration) {
    return false;
  }
  if (
    input.resultContentIdentity &&
    input.currentContentIdentity &&
    !isSameContentIdentity(
      input.resultContentIdentity,
      input.currentContentIdentity,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Presentation: hide sticky offer only when a strong live owner differs.
 */
export function shouldHideStickyOfferForLiveIdentity(input: {
  offerContentIdentity: string | null | undefined;
  liveContentIdentity: string | null | undefined;
  liveOwnershipConfidence: OwnershipConfidence;
}): boolean {
  if (!input.offerContentIdentity || !input.liveContentIdentity) {
    return false;
  }
  if (isSameContentIdentity(input.offerContentIdentity, input.liveContentIdentity)) {
    return false;
  }
  return isStrongOwner(input.liveOwnershipConfidence);
}

export type VerifyRerunBudget = { key: string; count: number };

/**
 * Whether a verification the page overtook (cancelled, or a newer trigger arrived meanwhile) may look at the page
 * again. At most `max` consecutive re-runs for the same media, owner and page; anything new resets the budget.
 */
export function takeVerifyRerun(
  budget: VerifyRerunBudget,
  key: string,
  max: number,
): { allowed: boolean; budget: VerifyRerunBudget } {
  if (budget.key !== key) {
    return { allowed: max > 0, budget: { key, count: max > 0 ? 1 : 0 } };
  }
  if (budget.count >= max) {
    return { allowed: false, budget };
  }
  return { allowed: true, budget: { key, count: budget.count + 1 } };
}

/** Legitimate clear reasons (documentation / diagnostics). */
export const LEGITIMATE_CTA_CLEAR_REASONS = [
  'CONTENT_CHANGED',
  'NAVIGATION_CHANGED',
  'TAB_CHANGED',
  'OFFER_EXPIRED_AND_NO_VALID_REFRESH',
  'SOURCE_PROVEN_INVALID',
  'DRM_PROTECTED',
  'DOWNLOAD_CONSUMED',
  'FILE_HANDOFF_STARTED_OR_SUCCEEDED',
  'MANUAL_PAGE_LEAVE',
] as const;

export type LegitimateCtaClearReason =
  (typeof LEGITIMATE_CTA_CLEAR_REASONS)[number];
