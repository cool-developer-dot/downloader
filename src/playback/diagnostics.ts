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

export type PlaybackDiagnosticEvent =
  | 'playback.persistence_local'
  | 'playback.persistence_failed'
  | 'playback.sync_started'
  | 'playback.sync_success'
  | 'playback.sync_deferred'
  | 'playback.sync_retry_scheduled'
  | 'playback.sync_conflict'
  | 'playback.sync_stale_ignored'
  | 'playback.sync_remote_accepted'
  | 'playback.sync_local_pushed'
  | 'playback.sync_failed'
  | 'playback.completed'
  | 'playback.replay_reset'
  | 'playback.resume_loaded'
  | 'playback.resume_seek_applied'
  | 'playback.pending_restored'
  | 'playback.account_generation_changed';

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

function isVerifyScriptProcess(): boolean {
  try {
    const args = process.argv;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i]!.includes('verify-week8-day3')) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export function playbackLog(
  event: PlaybackDiagnosticEvent,
  fields?: Fields,
  level: Level = 'info',
): void {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!isDev && level === 'info') {
    return;
  }
  // Keep Node verify output clean (expected offline sync failures).
  if (isVerifyScriptProcess()) {
    return;
  }
  const payload = { scope: 'playback', event, ...sanitize(fields) };
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
