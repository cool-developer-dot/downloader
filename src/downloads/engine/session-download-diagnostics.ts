/**
 * Phase 6C — DEV-only session download diagnostics. Never logs secrets.
 */

type DiagFields = Record<string, string | number | boolean | null | undefined>;

export type SessionDownloadDiagEvent =
  | 'execution_context_created'
  | 'execution_context_missing'
  | 'target_context_resolved'
  | 'cookie_present'
  | 'auth_retry_started'
  | 'auth_retry_exhausted'
  | 'session_changed'
  | 'session_expired'
  | 'context_destroyed'
  | 'hls_target_context_resolved'
  | 'stale_handoff_ignored';

const BLOCKED = /cookie|authorization|token|password|otp|signed|secret|header/i;

function sanitize(fields: DiagFields): DiagFields {
  const out: DiagFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (BLOCKED.test(key) && typeof value !== 'boolean' && key !== 'cookiePresent') {
      continue;
    }
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
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

export function logSessionDownload(
  event: SessionDownloadDiagEvent,
  fields: DiagFields = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[SessionDownload]', event, sanitize(fields));
}
