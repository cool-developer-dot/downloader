/**
 * P2 Sources — pure helpers for the three new ways a download gets its bytes:
 * - #304 FTP: `ftp://` / `ftps://` links go straight to the engine (the WebView cannot open them, and must not);
 * - #347 mirrors: other links to the same file, added in Download details or on a Batch Add line (`main | mirror`);
 * - #446 multi-network: the "use Wi-Fi and mobile data together" setting, never with "Wi-Fi only".
 * The engine checks everything again (a mirror must prove it is the same file; an FTP file must be a video).
 */

import { isPrivateOrLocalHostname } from '@/media-detection/utils/url';

/** Mirrors one download may have (the engine keeps at most this many). */
export const MAX_MIRRORS = 4;

const FTP_LINK = /^ftps?:\/\/[^\s/?#]+\/\S+$/i;

/** An `ftp://` or `ftps://` link to a file (a path after the host). */
export function isFtpLink(raw: string | null | undefined): boolean {
  const text = raw?.trim() ?? '';
  return FTP_LINK.test(text);
}

type FtpParts = { scheme: 'ftp' | 'ftps'; host: string; port: string; path: string; hasCredentials: boolean };

/** Parses an FTP link without `URL` (React Native's has no ftp support): host, port, decoded path. */
export function parseFtpLink(raw: string | null | undefined): FtpParts | null {
  const text = raw?.trim() ?? '';
  const match = /^(ftps?):\/\/(?:([^@/?#]*)@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d{1,5}))?(\/[^?#]*)$/i.exec(text);
  if (!match) {
    return null;
  }
  const path = safeDecode(match[5]!.split(';')[0]!).replace(/^\//, '');
  if (!path || path.endsWith('/')) {
    return null;
  }
  return {
    scheme: match[1]!.toLowerCase() as 'ftp' | 'ftps',
    host: match[3]!.toLowerCase().replace(/^\[|\]$/g, ''),
    port: match[4] ?? '',
    path,
    hasCredentials: match[2] != null && match[2].length > 0,
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The link as it may be shown or stored: no user name, no password. */
export function ftpLinkWithoutCredentials(raw: string): string {
  return raw.trim().replace(/^(ftps?:\/\/)[^@/?#]*@/i, '$1');
}

/** A title for an FTP file: its name without the extension. */
export function ftpLinkTitle(raw: string): string {
  const parts = parseFtpLink(raw);
  if (!parts) {
    return 'FTP file';
  }
  const name = parts.path.split('/').pop() ?? parts.path;
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, '');
  return stem || name || parts.host;
}

export type FtpLinkVerdict = 'ok' | 'private' | 'invalid';

/** The app's rule for an FTP link: a file on a public host (the same private-network guard as every other link). */
export function classifyFtpLink(raw: string): FtpLinkVerdict {
  const parts = parseFtpLink(raw);
  if (!parts) {
    return 'invalid';
  }
  return isPrivateOrLocalHostname(parts.host) ? 'private' : 'ok';
}

export type MirrorInput =
  | { ok: true; url: string }
  | { ok: false; reason: 'invalid' | 'same' | 'duplicate' | 'limit' | 'private' };

/** Pure: a mirror typed or pasted for a download whose link is `mainUrl` and which already has `existing`. */
export function checkMirrorInput(text: string, mainUrl: string | null, existing: readonly string[]): MirrorInput {
  const url = text.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return { ok: false, reason: 'invalid' };
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return { ok: false, reason: 'private' };
  }
  if (mainUrl && url === mainUrl.trim()) {
    return { ok: false, reason: 'same' };
  }
  if (existing.some((mirror) => mirror === url)) {
    return { ok: false, reason: 'duplicate' };
  }
  if (existing.length >= MAX_MIRRORS) {
    return { ok: false, reason: 'limit' };
  }
  return { ok: true, url };
}

export type BatchLine = { url: string; mirrors: string[] };

/**
 * Pure: Batch Add text → one entry per line. A line `link | mirror | mirror` is one download with its mirrors (the
 * links after the first `|`); any other line is today's: every link in it is its own download (`extract`).
 */
export function batchLinesWithMirrors(text: string, extract: (line: string) => string[], max: number): BatchLine[] {
  const out: BatchLine[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (out.length >= max) {
      break;
    }
    if (line.includes('|')) {
      const [first, ...rest] = line.split('|');
      const url = extract(first ?? '')[0];
      if (!url) {
        continue;
      }
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      const mirrors = rest.flatMap((part) => extract(part).slice(0, 1)).filter((m) => m !== url);
      out.push({ url, mirrors: [...new Set(mirrors)].slice(0, MAX_MIRRORS) });
      continue;
    }
    for (const url of extract(line)) {
      if (out.length >= max) {
        break;
      }
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push({ url, mirrors: [] });
    }
  }
  return out;
}

/** The engine's value of "use Wi-Fi and mobile data together": never while "Wi-Fi only" is on. */
export function multiNetworkForEngine(multiNetwork: boolean | null | undefined, wifiOnly: boolean): boolean {
  return multiNetwork === true && !wifiOnly;
}
