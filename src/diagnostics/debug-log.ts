/**
 * Debug Logs (#518): an in-memory ring buffer of VidoraX's own diagnostic events, kept only while the user has
 * turned Debug logs on (Download Settings → History & logs). Nothing is written to disk and nothing leaves the
 * device unless the user shares it. `console` is never patched: entries come from the app's own event sources
 * (see `debug-log-sources.ts`).
 *
 * Every message is redacted when it is recorded: URLs become their host, and anything that looks like a token,
 * cookie, signature or query string is dropped. Pure.
 */

import { redactUrls } from '@/downloads/v2/download-history';

export const DEBUG_LOG_CAPACITY = 500;
const MAX_MESSAGE_CHARS = 300;

export type DebugLogEntry = { at: number; source: string; message: string };

const SECRET_PAIR =
  /\b(access_token|refresh_token|id_token|token|cookie|set-cookie|authorization|bearer|signature|sig|session(?:id)?|password|secret|api_?key|x-amz-[a-z-]+|x-goog-[a-z-]+)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi;

/** Pure: a message safe to keep and share. */
export function redactLogMessage(message: string): string {
  let text = redactUrls(String(message));
  text = text.replace(/\b(bearer|basic)\s+[^\s,;]+/gi, '$1 [redacted]');
  text = text.replace(SECRET_PAIR, '$1=[redacted]');
  // A bare query string left over (e.g. "?a=1&b=2") goes too.
  text = text.replace(/\?[^\s]*=[^\s]*/g, '?[redacted]');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text;
}

export type DebugLogBuffer = {
  add: (source: string, message: string, at?: number) => void;
  entries: () => readonly DebugLogEntry[];
  clear: () => void;
};

/** Pure: a bounded buffer; the oldest entries are dropped first. */
export function createDebugLogBuffer(capacity = DEBUG_LOG_CAPACITY): DebugLogBuffer {
  const size = Math.max(1, Math.trunc(capacity));
  let items: DebugLogEntry[] = [];
  return {
    add: (source, message, at = Date.now()) => {
      items.push({ at, source: redactLogMessage(source).slice(0, 40), message: redactLogMessage(message) });
      if (items.length > size) {
        items = items.slice(items.length - size);
      }
    },
    entries: () => items,
    clear: () => {
      items = [];
    },
  };
}

/** Pure: the log as text to share, oldest first. */
export function debugLogToText(entries: readonly DebugLogEntry[], header: string): string {
  const lines = [header, ''];
  for (const entry of entries) {
    const at = Number.isFinite(entry.at) ? new Date(entry.at).toISOString() : '—';
    lines.push(`${at} [${entry.source}] ${entry.message}`);
  }
  return lines.join('\n');
}

/** The app's one buffer — on `globalThis`, so a Fast Refresh keeps the buffer the running listeners write to. */
const BUFFER_KEY = '__vidoraxDebugLogBuffer';
const buffers = globalThis as unknown as Record<string, DebugLogBuffer | undefined>;
export const debugLog: DebugLogBuffer = buffers[BUFFER_KEY] ?? (buffers[BUFFER_KEY] = createDebugLogBuffer());
