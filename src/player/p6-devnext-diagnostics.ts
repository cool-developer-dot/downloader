/**
 * P6 fix investigation (Device videos: Up next / ⏮ restart the same video instead of switching). Temporary,
 * development builds only: every line is tagged `[P6-DEVNEXT]` so the repro's lines can be filtered out of logcat
 * (`adb logcat | grep P6-DEVNEXT`). Release builds log nothing (`__DEV__` is false there).
 *
 * Like `diagnostics.ts`, no full URI, path or stack is logged: a source is reduced to its last path segment (a
 * MediaStore `_ID` for a device video), and a caller to its function names.
 *
 * Remove this file and its calls in `PlayerScreen.tsx` once the cause is fixed.
 */

export const P6_DEVNEXT_TAG = '[P6-DEVNEXT]';

/** How many queue ids a line shows (the whole length is logged too). */
export const P6_DEVNEXT_QUEUE_HEAD = 20;

type Sink = (...args: unknown[]) => void;

function devBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/** Logs one tagged line in a development build; returns whether it logged. */
export function p6DevNextLog(event: string, data: Record<string, unknown>, sink: Sink = console.log): boolean {
  if (!devBuild()) {
    return false;
  }
  let body: string;
  try {
    body = JSON.stringify(data);
  } catch {
    body = '{"unserializable":true}';
  }
  sink(P6_DEVNEXT_TAG, event, body);
  return true;
}

/** The queue as one line shows it: its length, the first ids, and where the target sits in it (-1: not in it). */
export function p6QueueSummary(
  queue: readonly string[],
  targetId: string | null,
): { length: number; head: string[]; targetIndex: number } {
  return {
    length: queue.length,
    head: queue.slice(0, P6_DEVNEXT_QUEUE_HEAD),
    targetIndex: targetId == null ? -1 : queue.indexOf(targetId),
  };
}

/** `content://media/external/video/media/1234` → `1234`: enough to tell two device videos apart, no full URI. */
export function p6UriTail(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string' || uri.length === 0) {
    return null;
  }
  const clean = uri.split(/[?#]/)[0] ?? '';
  const parts = clean.split('/').filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;
}

/** The function names of a stack (no file paths, no positions): who asked for a session change. */
export function p6CallerNames(stack: string | undefined, max = 8): string[] {
  if (typeof stack !== 'string') {
    return [];
  }
  const names: string[] = [];
  for (const line of stack.split('\n')) {
    const match = /^\s*at\s+([^\s(]+)\s*\(/.exec(line) ?? /^\s*([A-Za-z_$][\w$.]*)@/.exec(line);
    const name = match?.[1];
    if (name && name !== 'Error' && name !== 'anonymous') {
      names.push(name);
    }
    if (names.length >= max) {
      break;
    }
  }
  return names;
}
