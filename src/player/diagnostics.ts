/**
 * Sanitized player diagnostics. Never log paths, URLs, tokens, or stacks.
 * Info-level is development-gated (matches library diagnostics).
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
  'uri',
  'path',
  'absolutePath',
  'stack',
  'nativeStack',
  'message',
]);

export type PlayerDiagnosticEvent =
  | 'player.resolve_started'
  | 'player.ready'
  | 'player.first_frame'
  | 'player.surface_revealed'
  | 'player.play'
  | 'player.pause'
  | 'player.seek'
  | 'player.background_pause'
  | 'player.pip_start'
  | 'player.pip_stop'
  | 'player.fullscreen_enter'
  | 'player.fullscreen_exit'
  | 'player.error'
  | 'player.retry'
  | 'player.completed'
  | 'player.disposed';

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

export function playerLog(
  event: PlayerDiagnosticEvent,
  fields?: Fields,
  level: Level = 'info',
): void {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!isDev && level === 'info') {
    return;
  }
  const payload = { scope: 'player', event, ...sanitize(fields) };
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
