/**
 * DEV-only sanitized diagnostics for the automatic media handoff pipeline.
 *
 * These events are the observable contract required by the automatic media
 * detection acceptance:
 *
 *   OBSERVE → CLASSIFY → CORRELATE → VERIFY → VERIFIED + SUPPORTED → AVAILABLE
 *
 * All events are canonical string codes so a single grep of the DEV console
 * on a real Android build can reconstruct the exact stage a page reaches.
 *
 * Never logs cookies, Authorization headers, signed query strings, credentials,
 * or the full URL. Only hostnames, hash prefixes, and boolean/enum evidence.
 */

export type AutomaticHandoffEvent =
  | 'CONTENT_IDENTITY_CHANGED'
  | 'VIDEO_OWNER_OBSERVED'
  | 'MEDIA_CANDIDATE_OBSERVED'
  | 'MEDIA_CANDIDATE_DEDUPED'
  | 'MEDIA_CANDIDATE_CORRELATED'
  | 'MEDIA_VERIFY_AUTO_STARTED'
  | 'MEDIA_VERIFY_JOINED_INFLIGHT'
  | 'MEDIA_VERIFY_SUPPORTED'
  | 'MEDIA_VERIFY_UNSUPPORTED'
  | 'MEDIA_VERIFY_REJECTED'
  | 'MEDIA_VERIFY_STALE_RESULT_IGNORED'
  | 'MEDIA_CTA_AVAILABLE'
  | 'MEDIA_UNSUPPORTED_PRESENTED';

export type AutomaticHandoffPayload = Record<
  string,
  string | number | boolean | null | undefined
>;

const REDACTED_KEYS =
  /cookie|token|authorization|password|session|signature|apikey|apiKey|bearer/i;

const SIGNED_QUERY_HINTS = /(?:^|[?&])(?:token|signature|sig|auth|hash|expires|dm-cdn-tk|sec-tk|hmac)=/i;

function sanitize(payload: AutomaticHandoffPayload): AutomaticHandoffPayload {
  const out: AutomaticHandoffPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (REDACTED_KEYS.test(key)) {
      out[key] = typeof value === 'boolean' ? value : '[redacted]';
      continue;
    }
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value);
        out[key] = parsed.hostname.toLowerCase();
        if (parsed.search.length > 1) {
          out[`${key}QueryPresent`] = true;
          if (SIGNED_QUERY_HINTS.test(parsed.search)) {
            out[`${key}Signed`] = true;
          }
        }
      } catch {
        out[key] = '[invalid-url]';
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Deterministic 8-char hash suffix for identity strings.
 * Safe to include in logs — cannot round-trip to the source identity.
 */
export function hashHandoffIdentity(identity: string | null | undefined): string | null {
  if (!identity) {
    return null;
  }
  let h = 0;
  for (let i = 0; i < identity.length; i += 1) {
    h = ((h << 5) - h + identity.charCodeAt(i)) | 0;
  }
  return `h:${Math.abs(h).toString(16).slice(0, 8)}`;
}

/**
 * Emit a canonical automatic-handoff pipeline event. No-op in production.
 * @param event Canonical stage name from {@link AutomaticHandoffEvent}.
 * @param payload Sanitized evidence — never raw URLs, cookies, or tokens.
 */
export function logAutomaticHandoff(
  event: AutomaticHandoffEvent,
  payload: AutomaticHandoffPayload = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const safe = sanitize(payload);
  // eslint-disable-next-line no-console
  console.log(
    `[VidoraHandoff:${event}]`,
    JSON.stringify({ ts: Date.now(), event, ...safe }),
  );
}
