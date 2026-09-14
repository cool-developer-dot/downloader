/**
 * DEV-only structured media pipeline diagnostics.
 * Never logs cookie values, auth tokens, or session content.
 */

export type MediaDiagnosticStage =
  | 'input'
  | 'page_url_resolved'
  | 'page_url_loop'
  | 'page_load'
  | 'media_candidate'
  | 'candidate_verified'
  | 'candidate_rejected'
  | 'download_request'
  | 'download_result'
  | 'expired_url'
  | 're_resolve';

export type MediaDiagnosticPayload = Record<
  string,
  string | number | boolean | null | undefined
>;

const REDACTED_KEYS = /cookie|token|auth|password|session/i;

function sanitizePayload(payload: MediaDiagnosticPayload): MediaDiagnosticPayload {
  const out: MediaDiagnosticPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (REDACTED_KEYS.test(key)) {
      out[key] = typeof value === 'boolean' ? value : '[redacted]';
      continue;
    }
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value);
        out[key] = parsed.hostname;
        if (parsed.search.length > 1) {
          out[`${key}QueryPresent`] = true;
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

export function logMediaDiagnostic(
  stage: MediaDiagnosticStage,
  payload: MediaDiagnosticPayload = {},
): void {
  if (!__DEV__) {
    return;
  }

  const safe = sanitizePayload(payload);
  // eslint-disable-next-line no-console
  console.log(
    `[VidoraMedia:${stage}]`,
    JSON.stringify({
      ts: Date.now(),
      stage,
      ...safe,
    }),
  );
}

export function traceMediaPipeline(
  stages: Array<{ stage: MediaDiagnosticStage; payload?: MediaDiagnosticPayload }>,
): void {
  if (!__DEV__) {
    return;
  }
  for (const entry of stages) {
    logMediaDiagnostic(entry.stage, entry.payload);
  }
}
