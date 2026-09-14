/**
 * Sanitized structured diagnostics for Day 4 Phase 2 hardening.
 * Never log tokens, cookies, signed URLs, or absolute device paths.
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
]);

function sanitize(fields?: Fields): Fields {
  if (!fields) {
    return {};
  }
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (BLOCKED.has(k)) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function hardeningLog(
  event: string,
  fields?: Fields,
  level: Level = 'info',
): void {
  if (!__DEV__ && level === 'info') {
    return;
  }
  const payload = { scope: 'hardening', event, ...sanitize(fields) };
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
