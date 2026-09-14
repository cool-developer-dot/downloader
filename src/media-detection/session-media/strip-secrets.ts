/**
 * Phase 6B — strip secrets from ephemeral MediaRequestContext copies.
 */

import type { MediaRequestContext } from '@/downloads/types/request-context';

import { stripSecretRequestHeaders } from './request-header-policy';

/** Safe for verification cache / diagnostics metadata — never retains Cookie/Auth. */
export function stripRequestContextSecrets(
  context: MediaRequestContext | null | undefined,
): MediaRequestContext | null {
  if (!context) {
    return null;
  }
  return {
    ...context,
    hasCookies: false,
    headers: stripSecretRequestHeaders(context.headers),
  };
}

export function requestContextHasSecretHeaders(
  context: MediaRequestContext | null | undefined,
): boolean {
  if (!context?.headers) {
    return false;
  }
  return Object.keys(context.headers).some((key) => {
    const lower = key.toLowerCase();
    return (
      lower === 'cookie' ||
      lower === 'authorization' ||
      lower === 'set-cookie' ||
      lower === 'proxy-authorization'
    );
  });
}
