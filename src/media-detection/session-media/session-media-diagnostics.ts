/**
 * Phase 6B — DEV-only session-media diagnostics. Never logs secret values.
 */

export type SessionMediaDiagEvent =
  | 'public_verify_attempt'
  | 'public_verify_success'
  | 'public_verify_auth_required'
  | 'session_context_available'
  | 'session_context_unavailable'
  | 'cookie_present'
  | 'referer_applied'
  | 'origin_applied'
  | 'authorization_unavailable'
  | 'session_verify_success'
  | 'session_verify_failed'
  | 'session_expired'
  | 'protected_media_rejected'
  | 'stale_context_ignored';

type DiagFields = Record<string, string | number | boolean | null | undefined>;

const BLOCKED =
  /cookie|authorization|token|password|otp|set-cookie|signed|secret/i;

function sanitize(fields: DiagFields): DiagFields {
  const out: DiagFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (BLOCKED.test(key) && typeof value !== 'boolean') {
      continue;
    }
    if (typeof value === 'string' && value.startsWith('http')) {
      try {
        out[key] = new URL(value).hostname;
      } catch {
        out[key] = '[invalid-url]';
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logSessionMedia(
  event: SessionMediaDiagEvent,
  fields: DiagFields = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[SessionMedia]', event, sanitize(fields));
}
