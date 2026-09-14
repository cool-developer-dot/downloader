/**
 * Persistent Download CTA shell presentation — wraps Phase 3 lifecycle.
 * Does not replace NONE / AVAILABLE / HANDOFF_IN_PROGRESS / CONSUMED.
 */

import { toBrowserMediaCtaState } from './browser-media-action.types';
import type { BrowserMediaActionState } from './browser-media-action.types';
import {
  isSameContentIdentity,
  type OwnershipConfidence,
} from './cta-persistence';

export type CtaShellPresentationState =
  | 'HIDDEN'
  | 'TRACKING_CURRENT_VIDEO'
  | 'READY'
  | 'HANDOFF_IN_PROGRESS'
  | 'CONSUMED_CURRENT_CONTENT'
  | 'UNSUPPORTED_CURRENT_CONTENT';

function isStrongOwner(confidence: OwnershipConfidence): boolean {
  return confidence === 'STRONG' || confidence === 'MEDIUM';
}

export function shouldTreatAsCurrentVideoOwner(input: {
  liveContentIdentity: string | null | undefined;
  liveOwnershipConfidence: OwnershipConfidence;
}): boolean {
  return Boolean(input.liveContentIdentity) && isStrongOwner(input.liveOwnershipConfidence);
}

export function shouldReplaceCurrentOwner(input: {
  priorContentIdentity: string | null | undefined;
  nextContentIdentity: string | null | undefined;
  nextOwnershipConfidence: OwnershipConfidence;
}): boolean {
  if (!input.nextContentIdentity || !isStrongOwner(input.nextOwnershipConfidence)) {
    return false;
  }
  if (!input.priorContentIdentity) {
    return true;
  }
  return !isSameContentIdentity(input.priorContentIdentity, input.nextContentIdentity);
}

export function shouldKeepCtaShellMounted(input: {
  shellState: CtaShellPresentationState;
}): boolean {
  return (
    input.shellState === 'TRACKING_CURRENT_VIDEO' ||
    input.shellState === 'READY' ||
    input.shellState === 'HANDOFF_IN_PROGRESS' ||
    input.shellState === 'UNSUPPORTED_CURRENT_CONTENT'
  );
}

/**
 * Phase 2: the user-facing bar is only actionable when a verified source exists
 * (READY) or a single-flight handoff is already in progress.
 * TRACKING / UNSUPPORTED must not present Download-ready UI.
 */
export function isActionableCtaShell(shellState: CtaShellPresentationState): boolean {
  return shellState === 'READY' || shellState === 'HANDOFF_IN_PROGRESS';
}

export function resolveCtaShellPresentation(input: {
  isHome: boolean;
  hasBrowserError: boolean;
  overlayBlocking: boolean;
  actionState: BrowserMediaActionState;
  liveContentIdentity: string | null | undefined;
  liveOwnershipConfidence: OwnershipConfidence;
  hasVerifiedOffer: boolean;
  /** Authoritative consume-set match for the live owner (not raw CDN URL). */
  liveIdentityConsumed?: boolean;
}): CtaShellPresentationState {
  if (input.isHome || input.hasBrowserError || input.overlayBlocking) {
    return 'HIDDEN';
  }

  const cta = toBrowserMediaCtaState(input.actionState.status);
  const liveStrong = shouldTreatAsCurrentVideoOwner({
    liveContentIdentity: input.liveContentIdentity,
    liveOwnershipConfidence: input.liveOwnershipConfidence,
  });

  if (input.liveIdentityConsumed) {
    return 'CONSUMED_CURRENT_CONTENT';
  }

  if (cta === 'CONSUMED') {
    if (liveStrong && !input.actionState.contentIdentity) {
      return 'CONSUMED_CURRENT_CONTENT';
    }
    if (
      liveStrong &&
      input.actionState.contentIdentity &&
      input.liveContentIdentity &&
      !isSameContentIdentity(input.actionState.contentIdentity, input.liveContentIdentity)
    ) {
      return 'TRACKING_CURRENT_VIDEO';
    }
    if (
      liveStrong &&
      input.actionState.contentIdentity &&
      isSameContentIdentity(input.actionState.contentIdentity, input.liveContentIdentity)
    ) {
      return 'CONSUMED_CURRENT_CONTENT';
    }
    if (!liveStrong && input.actionState.contentIdentity) {
      return 'CONSUMED_CURRENT_CONTENT';
    }
  }

  if (cta === 'HANDOFF_IN_PROGRESS') {
    return 'HANDOFF_IN_PROGRESS';
  }

  if (cta === 'AVAILABLE' && input.hasVerifiedOffer) {
    return 'READY';
  }

  if (input.actionState.status === 'failed' && liveStrong && !input.hasVerifiedOffer) {
    return 'UNSUPPORTED_CURRENT_CONTENT';
  }

  if (liveStrong) {
    return 'TRACKING_CURRENT_VIDEO';
  }

  if (cta === 'AVAILABLE' && input.hasVerifiedOffer) {
    return 'READY';
  }

  return 'HIDDEN';
}
