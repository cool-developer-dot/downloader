/**
 * Phase 6B — decide when media is already known session-bound (RN-free).
 */

import { describePlatformPage } from '../platform';

/** Whether social/platform evidence already implies session-bound media. */
export function evidenceImpliesSessionBound(input: {
  pageUrl?: string | null;
  requiresCookies?: boolean;
}): boolean {
  if (input.requiresCookies) {
    return true;
  }
  const page = input.pageUrl?.trim();
  if (!page) {
    return false;
  }
  const kind = describePlatformPage(page).kind;
  return kind === 'tiktok' || kind === 'instagram';
}

/**
 * Public-first decision: skip public probe when evidence already proves session-bound.
 */
export function shouldAttemptPublicFirst(input: {
  pageUrl?: string | null;
  requiresCookies?: boolean;
}): boolean {
  return !evidenceImpliesSessionBound(input);
}
