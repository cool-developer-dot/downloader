/**
 * Support submission capability gating.
 *
 * Modes:
 *   - Configured production support email → 'email'
 *   - Otherwise → 'unavailable'
 *
 * There is no VidoraX ticket/API submission path in the local-only product.
 */

import { legalConfig } from '@/legal';

export type SupportSubmissionMode = 'email' | 'unavailable';

/**
 * Returns the active submission mode for this build.
 */
export function getSupportSubmissionMode(): SupportSubmissionMode {
  const email = legalConfig.contact.supportEmail?.trim() ?? '';
  if (email.length > 0) {
    return 'email';
  }
  return 'unavailable';
}

/**
 * True when any submission path is available.
 * Use this to gate send actions without branching on the mode.
 */
export function canSubmitSupportReport(): boolean {
  return getSupportSubmissionMode() !== 'unavailable';
}

/**
 * Returns the configured support email, or null if not set.
 * Prefer the support-specific mailbox; fall back to privacy if that is the
 * only configured address (matches existing legalConfig semantics).
 */
export function getSupportEmail(): string | null {
  const support = legalConfig.contact.supportEmail?.trim() ?? '';
  if (support.length > 0) {
    return support;
  }
  const privacy = legalConfig.contact.privacyEmail?.trim() ?? '';
  return privacy.length > 0 ? privacy : null;
}
