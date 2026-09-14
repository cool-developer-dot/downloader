/**
 * DEV-only diagnostics for TikTok/Instagram CDN transfers.
 * Never logs cookie values, signed query params, or full URLs.
 */

import { detectSocialCdnKind } from './source-capability';
import { safeDownloadHostname } from './download-runtime-diagnostics.service';

type Stage =
  | 'start'
  | 'candidate'
  | 'request_context'
  | 'request'
  | 'redirect'
  | 'response'
  | 'range'
  | 'bytes'
  | 'signature'
  | 'validation'
  | 'retry'
  | 'commit'
  | 'failure';

type Payload = Record<string, string | number | boolean | null | undefined>;

function safePayload(payload: Payload): Payload {
  const out: Payload = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (
      (lower.includes('cookie') ||
        lower.includes('token') ||
        lower.includes('sig') ||
        lower.includes('url')) &&
      typeof value === 'string' &&
      value.length > 0 &&
      lower !== 'hostname'
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logSocialDownload(
  stage: Stage,
  sourceUrl: string | null | undefined,
  payload: Payload = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const platform = sourceUrl ? detectSocialCdnKind(sourceUrl) : null;
  if (!platform && stage !== 'start' && stage !== 'failure') {
    return;
  }
  console.log(
    `[SocialDownload:${stage}]`,
    safePayload({
      platform: platform ?? payload.platform ?? null,
      hostname: safeDownloadHostname(sourceUrl ?? null),
      ...payload,
    }),
  );
}

export function logSocialDownloadResponse(
  sourceUrl: string,
  response: Response,
  extras?: Payload,
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  if (!detectSocialCdnKind(sourceUrl)) {
    return;
  }
  const contentLength = response.headers.get('Content-Length');
  logSocialDownload('response', sourceUrl, {
    status: response.status,
    contentType: response.headers.get('Content-Type')?.split(';')[0] ?? null,
    contentLength: contentLength && /^\d+$/.test(contentLength)
      ? Number(contentLength)
      : null,
    contentRange: response.headers.get('Content-Range') ?? null,
    acceptRanges: response.headers.get('Accept-Ranges') ?? null,
    finalHostname: safeDownloadHostname(response.url),
    ...extras,
  });
}
