/**
 * Safe Browser CTA diagnostics — never log URLs, cookies, tokens, or headers.
 */
export type BrowserCtaDiagnosticEvent =
  | 'available'
  | 'handoff_claimed'
  | 'handoff_duplicate_blocked'
  | 'quality_selection_locked'
  | 'quality_cancelled'
  | 'enqueue_started'
  | 'enqueue_succeeded'
  | 'enqueue_failed'
  | 'consumed'
  | 'rediscovery_suppressed'
  | 'navigation_invalidated'
  | 'tab_closed_cleanup'
  | 'stale_result_ignored'
  | 'handoff_released'
  | 'media_owner_detected'
  | 'media_verify_start'
  | 'media_verify_success'
  | 'media_verify_unsupported'
  | 'media_available'
  | 'media_action_play'
  | 'media_action_download'
  | 'media_handoff_success'
  | 'media_handoff_failure'
  | 'media_cta_consumed'
  | 'consumed_released';

export type BrowserCtaDiagnosticFields = {
  tabId?: string | null;
  /** Page URL; logging reduces it to the hostname only. */
  pageUrl?: string | null;
  fingerprintHash?: string | null;
  state?: string | null;
  handoffGeneration?: number | null;
  result?: string | null;
  /** A reason code (never a URL or message text). */
  reason?: string | null;
};

function hashFingerprint(fingerprint: string | null | undefined): string | null {
  if (!fingerprint) {
    return null;
  }
  // Short non-reversible-ish token for correlation (not cryptographic).
  let h = 0;
  for (let i = 0; i < fingerprint.length; i += 1) {
    h = (h * 31 + fingerprint.charCodeAt(i)) | 0;
  }
  return `fp_${(h >>> 0).toString(16)}`;
}

/** Host-only correlation token — never path/query/signed params. */
function safeNavigationHost(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

export function logBrowserCta(
  event: BrowserCtaDiagnosticEvent,
  fields: BrowserCtaDiagnosticFields = {},
): void {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return;
  }
  const safe: Record<string, string | number | null | undefined> = {
    event,
    tabId: fields.tabId ?? undefined,
    pageHost: safeNavigationHost(fields.pageUrl) ?? undefined,
    fingerprintHash: fields.fingerprintHash ?? undefined,
    state: fields.state ?? undefined,
    handoffGeneration: fields.handoffGeneration ?? undefined,
    result: fields.result ?? undefined,
    reason: fields.reason ?? undefined,
  };
  // eslint-disable-next-line no-console
  console.log('[BrowserCTA]', safe);
}

export function fingerprintDiagHash(
  fingerprint: string | null | undefined,
): string | null {
  return hashFingerprint(fingerprint);
}
