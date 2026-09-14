/**
 * DEV-only download pipeline diagnostics.
 * Never logs cookie values, tokens, or signed query secrets.
 */

export type DownloadRuntimeStage =
  | 'start'
  | 'url'
  | 'request_context'
  | 'http_response'
  | 'redirect'
  | 'content_type'
  | 'content_length'
  | 'bytes_written'
  | 'signature'
  | 'validation'
  | 'commit'
  | 'failure';

type Payload = Record<string, string | number | boolean | null | undefined>;

function safePayload(payload: Payload): Payload {
  const out: Payload = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (
      (lower.includes('cookie') || lower.includes('token') || lower.includes('sig')) &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logDownloadRuntime(
  stage: DownloadRuntimeStage,
  payload: Payload = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.log(`[DownloadRuntime:${stage}]`, safePayload(payload));
}

export function safeDownloadHostname(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
