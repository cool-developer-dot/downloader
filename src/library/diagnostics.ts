/**
 * Sanitized library diagnostics. Never log device paths or source URLs.
 * Info-level is development-gated, matching download hardening logs.
 */

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

const BLOCKED = new Set([
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'sourceUrl',
  'localUri',
  'path',
  'absolutePath',
  'thumbnailUrl',
  'thumbnailUri',
]);

function sanitize(fields?: Fields): Fields {
  if (!fields) {
    return {};
  }
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (BLOCKED.has(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function libraryLog(
  event:
    | 'library.load'
    | 'library.reconcile'
    | 'library.file_missing'
    | 'library.invalid_record'
    | 'library.remote_refresh_failed'
    | 'library.completion_sync'
    | 'library.removal_sync',
  fields?: Fields,
  level: Level = 'info',
): void {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!isDev && level === 'info') {
    return;
  }
  const payload = { scope: 'library', event, ...sanitize(fields) };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}
